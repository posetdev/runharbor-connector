output "start_function_url" {
  description = "Function URL for the SaaS dispatch Lambda to call POST /."
  value       = aws_lambda_function_url.start.function_url
}

output "runner_function_url" {
  description = "Function URL runner instances use for JIT readiness/claim."
  value       = aws_lambda_function_url.runner.function_url
}

output "setup_url" {
  description = "Function URL for the customer setup CLI/browser flow."
  value       = aws_lambda_function_url.setup.function_url
}

output "table_name" {
  description = "Name of the Connector DynamoDB state table."
  value       = aws_dynamodb_table.state.name
}

output "github_app_parameter_name" {
  description = "SSM parameter name holding the GitHub App credentials."
  value       = aws_ssm_parameter.github_app.name
}
