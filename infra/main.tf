# Triage Cam in production: one Fargate task behind a load balancer, Postgres on RDS, the
# domain on Cloudflare. docs/DEPLOY.md explains the shape and how to operate it.

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

data "cloudflare_zone" "this" {
  zone_id = var.cloudflare_zone_id
}

locals {
  name = "triagecam-${var.environment}"

  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  # Stage 2 once the Cloudflare zone is active, unless the variable says otherwise.
  domain_live = var.domain_live != null ? var.domain_live : data.cloudflare_zone.this.status == "active"

  www_domain = "www.${var.domain}"

  # What the app believes its own address is: verification links, and whether cookies are Secure.
  app_url = local.domain_live ? "https://${var.domain}" : "http://${aws_lb.this.dns_name}"

  # Proxies of ours in front of the task: Cloudflare and the load balancer, or the load balancer alone.
  trusted_proxy_hops = local.domain_live ? 2 : 1

  container_name = "web"
  container_port = 3000
}
