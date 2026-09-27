data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# A block device mapping matches the root volume *by device name*, and that name
# belongs to the image rather than to its architecture: Ubuntu noble reports
# /dev/sda1 on both amd64 and arm64, Amazon Linux 2023 reports /dev/xvda on both.
# Getting it wrong raises no error — EC2 attaches a spare volume and leaves the
# real root at the AMI's own size, so root_volume_gib silently stops applying.
# Read it off the AMI instead of adding one more field for a human to get wrong.
# Filtering by image-id alone (no `owners`) is deliberate: ids are unique across
# owners, and pinning owners would reject any AMI not published by the vendors
# we happened to list. An id the account cannot see fails at plan time.
data "aws_ami" "image" {
  for_each = var.images

  filter {
    name = "image-id"
    # nonsensitive() is deliberate: a public AMI id is not a secret, but the
    # provider marks every SSM parameter value sensitive, and Terraform then
    # treats expressions built from it — this data source's results, and with
    # them RUNHARBOR_CONFIG — as sensitive too. The parameter is the nomination,
    # the AMI is the lookup; only ids cross this line.
    values = [nonsensitive(data.aws_ssm_parameter.ubuntu_ami[each.key].value)]
  }
}

# The host is one distribution: Canonical's Ubuntu 24.04 LTS, for both x64 and
# arm64, the same image family GitHub's ubuntu-latest runners use. There is no
# customer AMI any more, so the id is resolved at deploy time from Canonical's
# public SSM parameter for the architecture — a parameter AWS exposes precisely
# so the current AMI of a given Ubuntu release does not have to be copied by
# hand into every deployment.
#
# Path shape, from Canonical's Ubuntu on AWS guide "Find images"
# (https://documentation.ubuntu.com/aws/en/latest/aws-how-to/instances/find-ubuntu-images/):
#   /aws/service/canonical/ubuntu/{product}/{release}/stable/{serial}/{arch}/hvm/{vol}/ami-id
# where product=server, release=24.04, serial=current, arch=amd64|arm64 and
# vol=ebs-gp3 (the root store Canonical publishes for releases >= 23.10; the
# ebs-gp2 variant of this path does not exist for 24.04). Those parameters are
# AWS Systems Manager public parameters, which is why they are readable in any
# account (https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-public-parameters.html).
# Verified against ap-southeast-2 on 2026-09-28: both architectures resolve,
# both report /dev/sda1 as the root device, and only the ebs-gp3 root store is
# published (the ebs-gp2 variant of this path does not exist). What is resolved
# is written into Terraform state and into each Lambda's RUNHARBOR_CONFIG, so
# one deployment runs one image id from first boot to its last runner; the next
# deploy is free to resolve whatever Canonical publishes by then.
data "aws_ssm_parameter" "ubuntu_ami" {
  for_each = var.images

  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/${local.ubuntu_ssm_architecture[each.key]}/hvm/ebs-gp3/ami-id"
}

locals {
  tags = {
    "runharbor:managed"       = "true"
    "runharbor:deployment-id" = var.deployment_id
  }

  # The runner label's architecture name (x64) and the SSM parameter's
  # architecture name (amd64) are two vocabularies for the same machine.
  ubuntu_ssm_architecture = {
    x64   = "amd64"
    arm64 = "arm64"
  }

  function_name = {
    start   = "${var.name_prefix}-start"
    runner  = "${var.name_prefix}-runner"
    setup   = "${var.name_prefix}-setup"
    timeout = "${var.name_prefix}-timeout"
  }

  lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowLambdaAssume"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  # One ARN per resolved image id: if two architectures ever resolved to the
  # same id, that id is still permitted exactly once. `distinct` keeps the IAM
  # policy a list of what is actually launchable rather than of what was asked
  # for.
  image_ami_ids = distinct([for arch, _ in var.images : data.aws_ami.image[arch].id])

  # amiId is the AMI data source's id rather than the SSM parameter's value:
  # the same image id, but read through the image the deployment will launch
  # rather than through the parameter that nominated it.
  merged_images = {
    for arch, image in var.images : arch => {
      amiId          = data.aws_ami.image[arch].id
      rootVolumeGiB  = image.root_volume_gib
      rootDeviceName = data.aws_ami.image[arch].root_device_name
      maxDurationMs  = image.max_duration_minutes * 60 * 1000
    }
  }

  # Lambda function ARNs are fully determined by account, region and function
  # name, so it is constructed here instead of via `aws_lambda_function.timeout.arn`
  # to avoid a dependency cycle when it is embedded in timeout's own RUNHARBOR_CONFIG.
  timeout_function_arn = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${local.function_name.timeout}"

  # Fields common to every Lambda's RUNHARBOR_CONFIG. Function URLs are assigned
  # by AWS and are not known until the function+URL pair exists, so they are
  # layered on per-function below rather than included here.
  connector_config_base = merge({
    schema                 = 1
    deploymentId           = var.deployment_id
    tenantId               = var.tenant_id
    awsAccountId           = data.aws_caller_identity.current.account_id
    awsRegion              = data.aws_region.current.region
    tableName              = aws_dynamodb_table.state.name
    githubAppParameterName = aws_ssm_parameter.github_app.name
    saasPublicKey          = var.saas_public_key
    giteeWorkflow          = var.gitee_workflow
    saasOrigin             = var.saas_origin
    webhookUrl             = var.webhook_url
    githubAppOrganization  = var.github_app_organization
    installerPublicKey     = var.installer_public_key
    runnerRoleArn          = aws_iam_role.runner.arn
    timeoutFunctionArn     = local.timeout_function_arn
    schedulerRoleArn       = aws_iam_role.scheduler.arn
    scheduleGroupName      = aws_scheduler_schedule_group.operations.name
    subnetIds              = [for az in local.runner_availability_zones : aws_subnet.runner[az].id]
    securityGroupId        = aws_security_group.runner.id
    instanceProfileArn     = aws_iam_instance_profile.runner.arn
    allowedInstanceTypes   = var.allowed_instance_types
    purchaseMode           = var.purchase_mode
    images                 = local.merged_images
  })

  connector_config_start = merge(local.connector_config_base, {
    runnerClaimUrl = aws_lambda_function_url.runner.function_url
  })

  # A Lambda can never reference its own not-yet-created Function URL without a
  # dependency cycle, so the `runner` function's own RUNHARBOR_CONFIG omits
  # `runnerClaimUrl` entirely (it is optional in the schema). The runner never
  # launches an instance, so it never needs the URL — but it does build an EC2
  # adapter to read instances with, so that adapter has to accept the field
  # being absent and refuse only a launch. Demanding it any earlier turned every
  # runner request into a silent 500 and stranded the bootstrap at the claim.
  connector_config_runner = local.connector_config_base

  connector_config_setup = merge(local.connector_config_base, {
    runnerClaimUrl   = aws_lambda_function_url.runner.function_url
    startFunctionUrl = aws_lambda_function_url.start.function_url
  })

  connector_config_timeout = merge(local.connector_config_base, {
    runnerClaimUrl = aws_lambda_function_url.runner.function_url
  })
}
