resource "aws_cloudwatch_log_group" "start" {
  name              = "/aws/lambda/${local.function_name.start}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "runner" {
  name              = "/aws/lambda/${local.function_name.runner}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "setup" {
  name              = "/aws/lambda/${local.function_name.setup}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "timeout" {
  name              = "/aws/lambda/${local.function_name.timeout}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "start" {
  function_name = local.function_name.start
  role          = aws_iam_role.lambda_start.arn
  handler       = "index.handler"
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  timeout       = 60
  memory_size   = 512

  filename         = "${local.lambda_artifact_dir}/start.zip"
  source_code_hash = filebase64sha256("${local.lambda_artifact_dir}/start.zip")

  environment {
    variables = {
      RUNHARBOR_CONFIG = jsonencode(local.connector_config_start)
    }
  }

  depends_on = [aws_cloudwatch_log_group.start]
  tags       = local.tags
}

resource "aws_lambda_function" "runner" {
  function_name = local.function_name.runner
  role          = aws_iam_role.lambda_runner.arn
  handler       = "index.handler"
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  timeout       = 15
  memory_size   = 256

  filename         = "${local.lambda_artifact_dir}/runner.zip"
  source_code_hash = filebase64sha256("${local.lambda_artifact_dir}/runner.zip")

  environment {
    variables = {
      RUNHARBOR_CONFIG = jsonencode(local.connector_config_runner)
    }
  }

  depends_on = [aws_cloudwatch_log_group.runner]
  tags       = local.tags
}

resource "aws_lambda_function" "setup" {
  function_name = local.function_name.setup
  role          = aws_iam_role.lambda_setup.arn
  handler       = "index.handler"
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 256

  filename         = "${local.lambda_artifact_dir}/setup.zip"
  source_code_hash = filebase64sha256("${local.lambda_artifact_dir}/setup.zip")

  environment {
    variables = {
      RUNHARBOR_CONFIG = jsonencode(local.connector_config_setup)
    }
  }

  depends_on = [aws_cloudwatch_log_group.setup]
  tags       = local.tags
}

resource "aws_lambda_function" "timeout" {
  function_name = local.function_name.timeout
  role          = aws_iam_role.lambda_timeout.arn
  handler       = "index.handler"
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  timeout       = 60
  memory_size   = 256

  filename         = "${local.lambda_artifact_dir}/timeout.zip"
  source_code_hash = filebase64sha256("${local.lambda_artifact_dir}/timeout.zip")

  environment {
    variables = {
      RUNHARBOR_CONFIG = jsonencode(local.connector_config_timeout)
    }
  }

  depends_on = [aws_cloudwatch_log_group.timeout]
  tags       = local.tags
}

resource "aws_lambda_function_url" "start" {
  function_name      = aws_lambda_function.start.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "start_invoke" {
  statement_id           = "AllowPublicInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.start.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# Lambda Function URLs created through the API need a second permission for
# the underlying invocation. Limit it to URL traffic so the public statement
# cannot be used through Lambda's direct Invoke API.
resource "aws_lambda_permission" "start_invoke_via_url" {
  statement_id             = "AllowPublicInvokeViaUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.start.function_name
  principal                = "*"
  invoked_via_function_url = true
}

resource "aws_lambda_function_url" "runner" {
  function_name      = aws_lambda_function.runner.function_name
  authorization_type = "AWS_IAM"
}

resource "aws_lambda_permission" "runner_invoke" {
  statement_id           = "AllowRunnerRoleInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.runner.function_name
  principal              = aws_iam_role.runner.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_function_url" "setup" {
  function_name      = aws_lambda_function.setup.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "setup_invoke" {
  statement_id           = "AllowPublicInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.setup.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "setup_invoke_via_url" {
  statement_id             = "AllowPublicInvokeViaUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.setup.function_name
  principal                = "*"
  invoked_via_function_url = true
}
