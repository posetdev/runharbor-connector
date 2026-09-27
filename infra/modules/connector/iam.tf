# EC2 instance role for runner instances: may only invoke the runner Lambda's
# Function URL, and only when the credentials come from an EC2 instance profile.
resource "aws_iam_role" "runner" {
  name = "${var.name_prefix}-runner"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowEc2Assume"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "runner" {
  name = "${var.name_prefix}-runner"
  role = aws_iam_role.runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeRunnerFunctionUrl"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunctionUrl"]
        Resource = aws_lambda_function.runner.arn
        Condition = {
          Null = { "ec2:SourceInstanceARN" = "false" }
        }
      },
      # Function URLs created from October 2025 on authorise the URL layer and
      # the invoke separately: the caller needs lambda:InvokeFunction as well.
      # Granting only the first yields a 403 whose body is `Forbidden`, with
      # the function never invoked and its log group empty — no signal names
      # the missing action. Lambda appends this second statement to a
      # NONE-auth URL's resource policy automatically but not to an AWS_IAM
      # one, so it has to be written here.
      {
        Sid      = "InvokeRunnerFunctionUrlViaUrl"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.runner.arn
        Condition = {
          Null = { "ec2:SourceInstanceARN" = "false" }
          Bool = { "lambda:InvokedViaFunctionUrl" = "true" }
        }
      },
    ]
  })
}

resource "aws_iam_instance_profile" "runner" {
  name = "${var.name_prefix}-runner"
  role = aws_iam_role.runner.name

  tags = local.tags
}

# start Lambda execution role.
resource "aws_iam_role" "lambda_start" {
  name               = "${var.name_prefix}-start"
  assume_role_policy = local.lambda_assume_role_policy
  tags               = local.tags
}

resource "aws_iam_role_policy" "lambda_start" {
  name = "${var.name_prefix}-start"
  role = aws_iam_role.lambda_start.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TableAccess"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = [aws_dynamodb_table.state.arn, "${aws_dynamodb_table.state.arn}/index/*"]
      },
      {
        Sid      = "ReadAppCredentials"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.github_app.arn
      },
      {
        Sid      = "RunInstances"
        Effect   = "Allow"
        Action   = ["ec2:RunInstances"]
        Resource = ["arn:aws:ec2:*:*:instance/*"]
        Condition = {
          StringEquals = {
            "ec2:MetadataHttpTokens"           = "required"
            "aws:RequestTag/runharbor:managed" = "true"
          }
          "ForAnyValue:StringEquals" = {
            "ec2:InstanceType" = var.allowed_instance_types
          }
        }
      },
      {
        Sid    = "RunInstancesDependencies"
        Effect = "Allow"
        Action = ["ec2:RunInstances"]
        Resource = concat(
          [
            "arn:aws:ec2:*:*:network-interface/*",
            "arn:aws:ec2:*:*:volume/*",
            "arn:aws:ec2:*:*:security-group/${aws_security_group.runner.id}",
          ],
          # Only the subnets this module created. A wildcard would let a bug
          # in the start Lambda launch into some other VPC in the account.
          [for subnet in aws_subnet.runner : "arn:aws:ec2:*:*:subnet/${subnet.id}"],
          [for ami_id in local.image_ami_ids : "arn:aws:ec2:*:*:image/${ami_id}"],
        )
      },
      {
        # A Spot RunInstances needs AWSServiceRoleForEC2Spot to exist, and in an
        # account that has never launched Spot it does not -- the launch is
        # refused before any instance exists, which reads as a capacity problem
        # and is not one. Creating it is idempotent, so this is safe to leave in
        # place; the resource ARN plus the service-name condition mean this role
        # can create that one AWS-managed role and nothing else, and cannot
        # attach it to anything. Terraform does not own the role instead because
        # it is account-global and long-lived: an account that already uses Spot
        # (this one has had it since 2019) would fail the very first apply.
        Sid      = "CreateSpotServiceLinkedRole"
        Effect   = "Allow"
        Action   = ["iam:CreateServiceLinkedRole"]
        Resource = "arn:aws:iam::*:role/aws-service-role/spot.amazonaws.com/AWSServiceRoleForEC2Spot"
        Condition = {
          StringEquals = { "iam:AWSServiceName" = "spot.amazonaws.com" }
        }
      },
      {
        Sid      = "TagOnLaunch"
        Effect   = "Allow"
        Action   = ["ec2:CreateTags"]
        Resource = "arn:aws:ec2:*:*:*"
        Condition = {
          StringEquals = { "ec2:CreateAction" = "RunInstances" }
        }
      },
      {
        Sid      = "DescribeInstances"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      {
        Sid      = "PassRunnerRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = aws_iam_role.runner.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "ec2.amazonaws.com" }
        }
      },
      {
        Sid      = "PassSchedulerRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = aws_iam_role.scheduler.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" }
        }
      },
      {
        Sid      = "CreateOperationSchedule"
        Effect   = "Allow"
        Action   = ["scheduler:CreateSchedule"]
        Resource = "arn:aws:scheduler:*:*:schedule/${aws_scheduler_schedule_group.operations.name}/*"
      },
      {
        Sid      = "WriteLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.start.arn}:*"
      },
    ]
  })
}

# runner Lambda execution role.
resource "aws_iam_role" "lambda_runner" {
  name               = "${var.name_prefix}-runner-fn"
  assume_role_policy = local.lambda_assume_role_policy
  tags               = local.tags
}

resource "aws_iam_role_policy" "lambda_runner" {
  name = "${var.name_prefix}-runner-fn"
  role = aws_iam_role.lambda_runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TableAccess"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.state.arn
      },
      {
        Sid      = "DescribeInstances"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      {
        Sid      = "WriteLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.runner.arn}:*"
      },
    ]
  })
}

# setup Lambda execution role.
resource "aws_iam_role" "lambda_setup" {
  name               = "${var.name_prefix}-setup"
  assume_role_policy = local.lambda_assume_role_policy
  tags               = local.tags
}

resource "aws_iam_role_policy" "lambda_setup" {
  name = "${var.name_prefix}-setup"
  role = aws_iam_role.lambda_setup.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TableAccess"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.state.arn
      },
      {
        Sid      = "ManageAppCredentials"
        Effect   = "Allow"
        Action   = ["ssm:PutParameter", "ssm:GetParameter"]
        Resource = aws_ssm_parameter.github_app.arn
      },
      {
        Sid      = "WriteLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.setup.arn}:*"
      },
    ]
  })
}

# timeout Lambda execution role.
resource "aws_iam_role" "lambda_timeout" {
  name               = "${var.name_prefix}-timeout"
  assume_role_policy = local.lambda_assume_role_policy
  tags               = local.tags
}

resource "aws_iam_role_policy" "lambda_timeout" {
  name = "${var.name_prefix}-timeout"
  role = aws_iam_role.lambda_timeout.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TableAccess"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = [aws_dynamodb_table.state.arn, "${aws_dynamodb_table.state.arn}/index/*"]
      },
      {
        Sid      = "DescribeInstances"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      {
        Sid      = "TerminateOrphans"
        Effect   = "Allow"
        Action   = ["ec2:TerminateInstances"]
        Resource = "arn:aws:ec2:*:*:instance/*"
        Condition = {
          StringEquals = { "ec2:ResourceTag/runharbor:deployment-id" = var.deployment_id }
        }
      },
      {
        Sid      = "DeleteOperationSchedule"
        Effect   = "Allow"
        Action   = ["scheduler:DeleteSchedule"]
        Resource = "arn:aws:scheduler:*:*:schedule/${aws_scheduler_schedule_group.operations.name}/*"
      },
      {
        Sid      = "WriteLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.timeout.arn}:*"
      },
    ]
  })
}

# EventBridge Scheduler role used by the start Lambda to invoke timeout via one-time schedules.
resource "aws_iam_role" "scheduler" {
  name = "${var.name_prefix}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSchedulerAssume"
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # CreateSchedule runs an assume-role precheck that carries no
      # aws:SourceArn context, so any ArnLike aws:SourceArn condition here
      # fails it with `ValidationException: The execution role you provide
      # must allow AWS EventBridge Scheduler to assume the role.` — including
      # the schedule-group ARN form the AWS docs suggest. aws:SourceAccount is
      # supplied on that precheck and still blocks the cross-account confused
      # deputy, which is the threat this condition exists to stop.
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "scheduler_invoke_timeout" {
  name = "${var.name_prefix}-scheduler-invoke-timeout"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "InvokeTimeout"
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.timeout.arn
    }]
  })
}
