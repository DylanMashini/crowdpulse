terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.29"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.6"
    }
  }

  # The bucket name carries the AWS account id, so it is given at init time:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "triagecam/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "triagecam"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment. The token is never a Terraform variable,
# so it is never written to the state or to a plan.
provider "cloudflare" {}
