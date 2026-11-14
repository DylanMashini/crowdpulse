# The app's own secrets: one Secrets Manager secret holding a JSON object, one key per variable.
#
# Terraform creates the secret and its first version, in which every value is empty. The app
# treats an empty variable as not set, so it starts and runs without them. The owner fills in
# the real values in Secrets Manager (docs/DEPLOY.md) and redeploys; they never pass through
# Terraform, a plan or the state, and Terraform does not write to the secret again unless
# secret_string_wo_version below is raised.

locals {
  app_secret_keys = ["RESEND_API_KEY", "RESEND_FROM", "EMAIL_FROM", "EXPO_ACCESS_TOKEN"]
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  description             = "Triage Cam app secrets: ${join(", ", local.app_secret_keys)}. Empty values mean not set."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id                = aws_secretsmanager_secret.app.id
  secret_string_wo         = jsonencode({ for key in local.app_secret_keys : key => "" })
  secret_string_wo_version = 1
}
