# Postgres. Private subnets, reachable only from the web task, with a standby in the second zone.

resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "this" {
  identifier = local.name

  engine                     = "postgres"
  engine_version             = var.db_engine_version
  auto_minor_version_upgrade = true
  instance_class             = var.db_instance_class
  multi_az                   = var.db_multi_az

  storage_type          = "gp3"
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_encrypted     = true

  db_name  = "triagecam"
  username = "triagecam"
  # RDS makes the password and keeps it in Secrets Manager. It never passes through Terraform.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "08:00-08:30"
  # Wednesday 04:00 US Eastern. Minor version upgrades happen here and restart the database,
  # which also replaces the web task (its health check needs the database).
  maintenance_window        = "wed:09:00-wed:09:30"
  apply_immediately         = var.db_apply_immediately
  copy_tags_to_snapshot     = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-final"

  performance_insights_enabled = true
}

# See the variable: rotation is switched off unless asked for.
resource "aws_secretsmanager_secret_rotation" "db" {
  count = var.db_password_rotation_enabled ? 0 : 1

  secret_id        = aws_db_instance.this.master_user_secret[0].secret_arn
  rotation_enabled = false
}
