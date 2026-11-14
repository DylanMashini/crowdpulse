# Deploys from GitHub Actions without stored AWS keys: the workflow presents GitHub's OIDC
# token and AWS exchanges it for short-lived credentials of the role below, but only for runs
# of this repository on the refs listed in var.github_deploy_refs.

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn

  account_arn_prefix = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}"
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-github-deploy"
  description          = "Assumed by the GitHub Actions deploy workflow"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [for ref in var.github_deploy_refs : "${var.github_oidc_subject_prefix}:ref:${ref}"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PushImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
        Resource = aws_ecr_repository.web.arn
      },
      {
        Sid      = "ReadTemplatePointer"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = aws_ssm_parameter.task_definition_template.arn
      },
      {
        # These two cannot be limited to one family: IAM does not support it.
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
        Resource = "*"
      },
      {
        Sid       = "PassTaskRoles"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.task_execution.arn, aws_iam_role.task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Sid       = "RunMigration"
        Effect    = "Allow"
        Action    = "ecs:RunTask"
        Resource  = "${local.account_arn_prefix}:task-definition/${aws_ecs_task_definition.web.family}:*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.this.arn } }
      },
      {
        Sid       = "WatchMigration"
        Effect    = "Allow"
        Action    = "ecs:DescribeTasks"
        Resource  = "${local.account_arn_prefix}:task/${aws_ecs_cluster.this.name}/*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.this.arn } }
      },
      {
        Sid      = "ReadMigrationLog"
        Effect   = "Allow"
        Action   = "logs:GetLogEvents"
        Resource = "${aws_cloudwatch_log_group.web.arn}:log-stream:*"
      },
      {
        Sid      = "DeployService"
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices", "ecs:UpdateService", "ecs:ListServiceDeployments"]
        Resource = aws_ecs_service.web.arn
      },
      {
        Sid    = "WatchDeployment"
        Effect = "Allow"
        Action = "ecs:DescribeServiceDeployments"
        # ECS authorises this call against the service the deployment belongs to, not against
        # the deployment that is named in the request: with the deployment ARN alone the call
        # is refused. The service reference lists both resource types, so both are allowed.
        Resource = [
          aws_ecs_service.web.arn,
          "${local.account_arn_prefix}:service-deployment/${aws_ecs_cluster.this.name}/${aws_ecs_service.web.name}/*",
        ]
      },
    ]
  })
}
