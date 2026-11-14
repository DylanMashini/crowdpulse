# A VPC of its own: two public subnets for the load balancer and the task, two private ones
# for the database. There is no NAT gateway: the task has a public address for its outbound
# calls (ECR, Secrets Manager, Expo, Resend) and accepts connections only from the load balancer.

resource "aws_vpc" "this" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = local.name }
}

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(aws_vpc.this.cidr_block, 8, count.index)

  tags = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(aws_vpc.this.cidr_block, 8, 10 + count.index)

  tags = { Name = "${local.name}-private-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count = length(local.azs)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The private subnets keep the VPC's main route table, which has no route out.

# --- security groups ----------------------------------------------------------------------------

# Cloudflare publishes the addresses its proxy connects from. No token needed.
data "http" "cloudflare_ips" {
  url = "https://api.cloudflare.com/client/v4/ips"

  request_headers = {
    Accept = "application/json"
  }

  lifecycle {
    postcondition {
      condition     = self.status_code == 200 && try(length(jsondecode(self.response_body).result.ipv4_cidrs) > 0, false)
      error_message = "Could not read Cloudflare's address ranges."
    }
  }
}

locals {
  cloudflare_ipv4 = toset(jsondecode(data.http.cloudflare_ips.response_body).result.ipv4_cidrs)

  # Stage 1: nobody but the operator, on port 80. Stage 2: Cloudflare on 443 (and on 80, which
  # only redirects), plus the operator on 443 while the list is not empty.
  alb_ingress = merge(
    { for cidr in var.operator_cidrs : "operator-${local.domain_live ? 443 : 80}-${cidr}" => { cidr = cidr, port = local.domain_live ? 443 : 80, description = "Operator, direct" } },
    local.domain_live ? { for cidr in local.cloudflare_ipv4 : "cloudflare-443-${cidr}" => { cidr = cidr, port = 443, description = "Cloudflare proxy" } } : {},
    local.domain_live ? { for cidr in local.cloudflare_ipv4 : "cloudflare-80-${cidr}" => { cidr = cidr, port = 80, description = "Cloudflare proxy, redirected to HTTPS" } } : {},
  )
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Load balancer of ${local.name}"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each = local.alb_ingress

  security_group_id = aws_security_group.alb.id
  description       = each.value.description
  cidr_ipv4         = each.value.cidr
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "alb_to_task" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the web task"
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = local.container_port
  to_port                      = local.container_port
}

resource "aws_security_group" "task" {
  name        = "${local.name}-task"
  description = "Web task of ${local.name}"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-task" }
}

resource "aws_vpc_security_group_ingress_rule" "task_from_alb" {
  security_group_id            = aws_security_group.task.id
  description                  = "From the load balancer"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.container_port
  to_port                      = local.container_port
}

resource "aws_vpc_security_group_egress_rule" "task_out" {
  security_group_id = aws_security_group.task.id
  description       = "Image pulls, secrets, logs, the database, Expo push and Resend"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "Database of ${local.name}"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_task" {
  security_group_id            = aws_security_group.db.id
  description                  = "Postgres from the web task"
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
