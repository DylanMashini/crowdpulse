output "stage" {
  description = "Which stage the stack is in."
  value       = local.domain_live ? "2: served on https://${var.domain} through Cloudflare" : "1: served on the load balancer's own name over HTTP, to operator_cidrs only"
}

output "app_url" {
  description = "The address the app is told it has."
  value       = local.app_url
}

output "load_balancer_dns_name" {
  value = aws_lb.this.dns_name
}

output "cloudflare_zone_status" {
  description = "\"pending\" until the registrar points the domain at Cloudflare's nameservers."
  value       = data.cloudflare_zone.this.status
}

output "cloudflare_name_servers" {
  description = "The nameservers to set at the registrar."
  value       = data.cloudflare_zone.this.name_servers
}

output "ecr_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.this.name
}

output "ecs_service" {
  value = aws_ecs_service.web.name
}

output "deploy_role_arn" {
  description = "GitHub Actions secret AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}

output "app_secret_name" {
  description = "The Secrets Manager secret to fill in with the app's keys."
  value       = aws_secretsmanager_secret.app.name
}

output "log_group" {
  value = aws_cloudwatch_log_group.web.name
}
