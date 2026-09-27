resource "aws_scheduler_schedule_group" "operations" {
  name = "${var.name_prefix}-operations"

  tags = local.tags
}

resource "aws_cloudwatch_event_rule" "orphan_sweep" {
  count               = var.orphan_sweep_enabled ? 1 : 0
  name                = "${var.name_prefix}-orphan-sweep"
  description         = "Hourly fallback cleanup for runner instances without a ready operation."
  schedule_expression = "rate(1 hour)"

  tags = local.tags
}

resource "aws_cloudwatch_event_target" "orphan_sweep" {
  count     = var.orphan_sweep_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.orphan_sweep[0].name
  target_id = "timeout"
  arn       = aws_lambda_function.timeout.arn
  input     = jsonencode({ mode = "sweep" })
}

resource "aws_lambda_permission" "orphan_sweep" {
  count         = var.orphan_sweep_enabled ? 1 : 0
  statement_id  = "AllowOrphanSweepInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.timeout.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.orphan_sweep[0].arn
}
