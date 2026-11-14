# The domain: Cloudflare DNS records that point it at the load balancer, and the certificate
# the load balancer presents to Cloudflare.
#
# Everything here is created in stage 1, while the zone is still "pending" at Cloudflare. The
# records resolve, and the certificate can be validated, only once the registrar points the
# domain at Cloudflare's nameservers; nothing below waits for that except the one resource
# that is only created in stage 2.

# Proxied, so visitors reach Cloudflare and Cloudflare reaches the load balancer. A CNAME at
# the apex is allowed here: Cloudflare flattens it.
resource "cloudflare_dns_record" "apex" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "CNAME"
  content = aws_lb.this.dns_name
  proxied = true
  ttl     = 1
  comment = "Triage Cam load balancer (Terraform)"
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.cloudflare_zone_id
  name    = local.www_domain
  type    = "CNAME"
  content = aws_lb.this.dns_name
  proxied = true
  ttl     = 1
  comment = "Redirected to the apex by the load balancer (Terraform)"
}

resource "aws_acm_certificate" "this" {
  domain_name               = var.domain
  subject_alternative_names = [local.www_domain]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  acm_validation = {
    for option in aws_acm_certificate.this.domain_validation_options : option.domain_name => option
  }
}

# One validation record per name. Keyed by the names, which are known before the certificate
# exists. Not proxied: ACM has to see the CNAME itself.
resource "cloudflare_dns_record" "acm_validation" {
  for_each = toset([var.domain, local.www_domain])

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(local.acm_validation[each.key].resource_record_name, ".")
  type    = local.acm_validation[each.key].resource_record_type
  content = trimsuffix(local.acm_validation[each.key].resource_record_value, ".")
  proxied = false
  ttl     = 60
  comment = "ACM validation for ${each.key} (Terraform)"
}

# Stage 2 only: waits until ACM has seen the records and issued the certificate.
resource "aws_acm_certificate_validation" "this" {
  count = local.domain_live ? 1 : 0

  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in cloudflare_dns_record.acm_validation : record.name]

  timeouts {
    create = "45m"
  }
}

# --- origin check ---------------------------------------------------------------------------
# The load balancer's security group admits Cloudflare's addresses, and every Cloudflare
# customer sends from those. With var.origin_header_check, Cloudflare adds a header holding a
# secret to each request of this zone on its way to the origin, and the listener rule that
# forwards to the app (alb.tf) requires it, so traffic sent through anyone else's zone or
# Worker gets the listener's 404.
#
# The secret is made here and exists only in the state (an encrypted, private bucket), at
# Cloudflare and in the listener rule: it is not a variable and is never typed by anyone.
# To change it: terraform apply -replace='random_password.origin_header[0]'. Cloudflare and
# the load balancer are updated one after the other, so expect a few seconds of 404s.

locals {
  origin_header_check = var.origin_header_check && local.domain_live
  origin_header_name  = "x-origin-verify"
}

resource "random_password" "origin_header" {
  count = local.origin_header_check ? 1 : 0

  length  = 48
  special = false
}

# The zone's one ruleset for this phase ("Modify request header" rules in the dashboard). If
# rules were added there by hand, Cloudflare refuses a second ruleset: import the existing one.
resource "cloudflare_ruleset" "origin_header" {
  count = local.origin_header_check ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  name        = "Triage Cam origin header (Terraform)"
  description = "Adds the header the load balancer requires to every request sent to the origin."
  kind        = "zone"
  phase       = "http_request_late_transform"

  rules = [{
    ref         = "origin_header"
    description = "Add the origin header"
    expression  = "true"
    action      = "rewrite"
    enabled     = true

    action_parameters = {
      headers = {
        (local.origin_header_name) = {
          operation = "set"
          value     = random_password.origin_header[0].result
        }
      }
    }
  }]
}
