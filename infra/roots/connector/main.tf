terraform {
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

module "connector" {
  source = "../../modules/connector"

  name_prefix             = var.name_prefix
  deployment_id           = var.deployment_id
  tenant_id               = var.tenant_id
  saas_public_key         = var.saas_public_key
  gitee_workflow          = var.gitee_workflow
  saas_origin             = var.saas_origin
  webhook_url             = var.webhook_url
  github_app_organization = var.github_app_organization
  installer_public_key    = var.installer_public_key
  images                  = var.images
  allowed_instance_types  = var.allowed_instance_types
  purchase_mode           = var.purchase_mode
  log_retention_days      = var.log_retention_days
  orphan_sweep_enabled    = var.orphan_sweep_enabled
  lambda_artifact_dir     = var.lambda_artifact_dir
}
