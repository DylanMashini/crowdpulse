# The load balancer. Stage 1 serves the app on port 80 of its own name; stage 2 serves it on
# 443 with the domain's certificate and turns port 80 into a redirect.

resource "aws_lb" "this" {
  name               = local.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # The readings stream (SSE) and the live view (MJPEG) are responses that never end. Both send
  # something at least every 15 seconds; this leaves a wide margin.
  idle_timeout               = 300
  drop_invalid_header_fields = true
  enable_deletion_protection = true
}

# Two target groups for blue/green deploys: ECS registers the new task in whichever is idle,
# moves the listener rule over to it, and drains the other.
resource "aws_lb_target_group" "web" {
  for_each = toset(["blue", "green"])

  name        = "${local.name}-${each.key}"
  vpc_id      = aws_vpc.this.id
  target_type = "ip"
  protocol    = "HTTP"
  port        = local.container_port

  # Streams never finish by themselves, so there is nothing to wait a long time for.
  deregistration_delay = 30

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = local.domain_live ? [] : [1]

    content {
      type = "fixed-response"

      fixed_response {
        content_type = "text/plain"
        message_body = "Not found"
        status_code  = "404"
      }
    }
  }

  dynamic "default_action" {
    for_each = local.domain_live ? [1] : []

    content {
      type = "redirect"

      redirect {
        protocol    = "HTTPS"
        port        = "443"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count = local.domain_live ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this[0].certificate_arn

  # Only requests for the two names of the certificate get further than this.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

# The rule ECS moves between the two target groups. It lives on the port 80 listener in stage 1
# and is replaced by one on the 443 listener in stage 2.
resource "aws_lb_listener_rule" "web" {
  listener_arn = local.domain_live ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  priority     = 100

  dynamic "condition" {
    for_each = local.domain_live ? [1] : []

    content {
      host_header {
        values = [var.domain]
      }
    }
  }

  dynamic "condition" {
    for_each = local.domain_live ? [] : [1]

    content {
      path_pattern {
        values = ["/*"]
      }
    }
  }

  action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.web["blue"].arn
        weight = 100
      }

      target_group {
        arn    = aws_lb_target_group.web["green"].arn
        weight = 0
      }
    }
  }

  lifecycle {
    # ECS rewrites the weights on every deploy.
    ignore_changes        = [action]
    create_before_destroy = true
  }
}

resource "aws_lb_listener_rule" "www" {
  count = local.domain_live ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  condition {
    host_header {
      values = [local.www_domain]
    }
  }

  action {
    type = "redirect"

    redirect {
      host        = var.domain
      status_code = "HTTP_301"
    }
  }
}

# Lets ECS move the listener rule and register targets during a blue/green deploy.
resource "aws_iam_role" "ecs_load_balancer" {
  name = "${local.name}-ecs-load-balancer"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_load_balancer" {
  role       = aws_iam_role.ecs_load_balancer.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonECSInfrastructureRolePolicyForLoadBalancers"
}
