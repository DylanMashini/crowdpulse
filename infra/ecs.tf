# The web app: one Fargate task. The app keeps the live view, the event stream, the rate
# limits and its timers in memory, so the service never runs more than one task behind the
# load balancer, except for the minute or two of a deploy.

resource "aws_ecr_repository" "web" {
  name = "${local.name}-web"
  # A tag is a git commit and never moves, so a task definition always means the same image.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name

  # Three rules, because one rule over "any" image counts every manifest: an image built with
  # Docker's attestations is an index plus two untagged manifests, and used three of the slots.
  # ECR never expires a manifest that an index still refers to, so rule 1 only removes what is
  # left behind once its index has gone. A rule with a lower number wins: the bootstrap image,
  # which the task definition template names, is matched by rule 2 and so is out of rule 3's reach.
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Untagged manifests go after a day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the bootstrap image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["bootstrap"]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Keep the 20 newest release images (tagged with a commit hash)"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}/web"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "this" {
  name = local.name
}

# What ECS itself needs to start the task: pull the image, write logs, read the secrets.
resource "aws_iam_role" "task_execution" {
  name = "${local.name}-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = [aws_secretsmanager_secret.app.arn, aws_db_instance.this.master_user_secret[0].secret_arn]
    }]
  })
}

# What the app's own code may do in AWS: nothing. It calls no AWS API.
resource "aws_iam_role" "task" {
  name = "${local.name}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

# The template of the task. The deploy workflow copies it, puts the new image in, and registers
# the copy as the revision the service runs, so a change made here reaches the service with
# the next deploy (docs/DEPLOY.md).
resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = local.container_name
    image     = "${aws_ecr_repository.web.repository_url}:${var.bootstrap_image_tag}"
    essential = true

    portMappings = [{ containerPort = local.container_port, hostPort = local.container_port, protocol = "tcp" }]

    environment = [
      { name = "APP_URL", value = local.app_url },
      { name = "DB_HOST", value = aws_db_instance.this.address },
      { name = "DB_NAME", value = aws_db_instance.this.db_name },
      { name = "DB_PORT", value = tostring(aws_db_instance.this.port) },
      { name = "DB_USER", value = aws_db_instance.this.username },
      { name = "TRUSTED_PROXY_HOPS", value = tostring(local.trusted_proxy_hops) },
    ]

    # The container's entry point builds DATABASE_URL from the DB_* variables.
    secrets = concat(
      [{ name = "DB_PASSWORD", valueFrom = "${aws_db_instance.this.master_user_secret[0].secret_arn}:password::" }],
      [for key in local.app_secret_keys : { name = key, valueFrom = "${aws_secretsmanager_secret.app.arn}:${key}::" }],
    )

    # Next.js finishes open requests on SIGTERM; the streams are cut when this runs out.
    stopTimeout = 30

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }

    mountPoints    = []
    volumesFrom    = []
    systemControls = []
  }])
}

# Where the deploy workflow finds the template.
resource "aws_ssm_parameter" "task_definition_template" {
  name        = "/${local.name}/deploy/task-definition-template"
  description = "ARN of the task definition revision that Terraform manages. The deploy workflow copies it with the new image."
  type        = "String"
  value       = aws_ecs_task_definition.web.arn
}

resource "aws_ecs_service" "web" {
  name            = "${local.name}-web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  launch_type     = "FARGATE"

  # One task, always. During a deploy a second one starts beside it and takes over.
  desired_count                      = 1
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 90

  # Blue/green, run by ECS itself: the new task comes up in the idle target group, is health
  # checked there, the listener rule moves all traffic to it at once, and the old task is
  # stopped after the bake time. A new task that never becomes healthy is rolled back.
  deployment_configuration {
    strategy             = "BLUE_GREEN"
    bake_time_in_minutes = var.bake_time_minutes
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web["blue"].arn
    container_name   = local.container_name
    container_port   = local.container_port

    advanced_configuration {
      alternate_target_group_arn = aws_lb_target_group.web["green"].arn
      production_listener_rule   = aws_lb_listener_rule.web.arn
      role_arn                   = aws_iam_role.ecs_load_balancer.arn
    }
  }

  lifecycle {
    # The deploy workflow registers a new revision for every image and points the service at it.
    ignore_changes = [task_definition]
  }

  depends_on = [
    aws_iam_role_policy_attachment.ecs_load_balancer,
    aws_iam_role_policy_attachment.task_execution,
    aws_iam_role_policy.task_execution_secrets,
  ]
}
