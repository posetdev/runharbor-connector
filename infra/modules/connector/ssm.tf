resource "aws_ssm_parameter" "github_app" {
  name  = "/runharbor/${var.name_prefix}/github-app"
  type  = "SecureString"
  tier  = "Standard"
  value = jsonencode({})

  lifecycle {
    ignore_changes = [value]
  }

  tags = local.tags
}
