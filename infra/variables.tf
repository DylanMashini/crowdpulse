variable "region" {
  description = "AWS region everything runs in."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Name of this environment. Part of every resource name."
  type        = string
  default     = "prod"
}

# --- domain -----------------------------------------------------------------------------------

variable "domain" {
  description = "Apex domain the app is served on. `www.` redirects to it."
  type        = string
  default     = "crowdpulse.care"
}

variable "cloudflare_zone_id" {
  description = "Id of the Cloudflare zone for `domain`. Set it in terraform.tfvars or TF_VAR_cloudflare_zone_id."
  type        = string
}

variable "domain_live" {
  description = <<-EOT
    Whether the domain is served through Cloudflare over HTTPS (stage 2) or the stack is only
    reachable on the load balancer's own name over HTTP (stage 1). Leave null to follow the
    Cloudflare zone: stage 2 as soon as the zone's status is "active", which it becomes once
    the registrar points the domain at Cloudflare's nameservers. See docs/DEPLOY.md.
  EOT
  type        = bool
  default     = null
}

variable "operator_cidrs" {
  description = <<-EOT
    Addresses that may reach the load balancer directly, for testing: port 80 in stage 1, port
    443 in stage 2. In stage 1 these are the only addresses that can reach the app at all.
    Empty the list once the domain is live, so that only Cloudflare can reach the origin.
  EOT
  type        = list(string)
  default     = []
}

# --- sizes --------------------------------------------------------------------------------------

variable "task_cpu" {
  description = "CPU units of the web task (1024 is one vCPU). Sized far above need for the demo; 1024 is plenty."
  type        = number
  default     = 4096
}

variable "task_memory" {
  description = "Memory of the web task in MiB. Must be a size Fargate offers for `task_cpu`."
  type        = number
  default     = 16384
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.m7g.large"
}

variable "db_allocated_storage" {
  description = "RDS storage in GiB (gp3). Grows by itself up to `db_max_allocated_storage`."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Ceiling for RDS storage autoscaling, in GiB."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Keep a standby database in a second availability zone."
  type        = bool
  default     = true
}

variable "db_engine_version" {
  description = "Postgres version. The major version matches local development (17); AWS chooses and upgrades the minor."
  type        = string
  default     = "17"
}

variable "db_backup_retention_days" {
  description = "Days of automated RDS backups to keep."
  type        = number
  default     = 7
}

variable "db_password_rotation_enabled" {
  description = <<-EOT
    Let Secrets Manager rotate the database password every seven days. Off by default: the
    running task was started with the password and cannot open new connections after a
    rotation until it is replaced (the health check then fails and ECS replaces it, which is a
    minute or two of errors at a time nobody chose).
  EOT
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Days to keep the app's CloudWatch logs."
  type        = number
  default     = 30
}

# --- deploys ------------------------------------------------------------------------------------

variable "bake_time_minutes" {
  description = <<-EOT
    Minutes the old task is kept after a blue/green deploy has moved traffic to the new one, so a
    bad deploy can go back at once. The old task's timers keep running for this long, so keep it short.
  EOT
  type        = number
  default     = 1
}

variable "bootstrap_image_tag" {
  description = <<-EOT
    Tag of the image the service is created with, pushed by hand once (docs/DEPLOY.md). Every
    later image is deployed by the GitHub Actions workflow, which Terraform does not undo.
  EOT
  type        = string
  default     = "bootstrap"
}

variable "github_oidc_subject_prefix" {
  description = <<-EOT
    How GitHub names the repository in the OIDC tokens of its workflow runs: the start of the
    token's `sub` claim, up to but not including ":ref:...". Ask GitHub for it:
      gh api repos/<owner>/<repository>/actions/oidc/customization/sub -q .sub_claim_prefix
    It is "repo:<owner>/<repository>" for a repository on the classic format, and carries the
    numeric owner and repository ids ("repo:<owner>@<id>/<repository>@<id>") on the immutable
    format, which survives a rename.
  EOT
  type        = string

  validation {
    condition     = startswith(var.github_oidc_subject_prefix, "repo:") && !strcontains(var.github_oidc_subject_prefix, "*")
    error_message = "Must start with \"repo:\" and name exactly one repository (no wildcards)."
  }
}

variable "github_deploy_refs" {
  description = "Git refs of the repository whose workflow runs may deploy."
  type        = list(string)
  default     = ["refs/heads/main"]
}

variable "create_github_oidc_provider" {
  description = "Create the IAM OIDC provider for GitHub Actions. Set false if the account already has one."
  type        = bool
  default     = true
}
