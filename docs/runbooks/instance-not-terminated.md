# Runbook: an instance didn't terminate

Symptom: an EC2 runner instance is still running well past its job (or past its selected image's `max_duration_minutes`), and you're paying for idle time.

RunHarbor never has the SaaS or the Connector actively call `TerminateInstances` for a healthy run — the instance shuts itself down (`poweroff`) once its runner exits, and `InstanceInitiatedShutdownBehavior=terminate` turns that into a real termination. There are two independent backstops if that doesn't happen; check both.

## 1. Does the operation have a timeout schedule?

`GetItem OP#<operationId>` on the Connector table. Every operation gets a fixed `timeoutAt` (set once, at creation, from the selected image's `max_duration_minutes` plus a fixed bootstrap budget) and a `scheduleName` (`rh-<opId prefix>`).

- **`scheduleName` is present.** Check `aws scheduler get-schedule --group-name <schedule group> --name <scheduleName>` (or the console). If it exists and its `at()` time has passed without the `timeout` Lambda having run, check the `timeout` function's CloudWatch logs and its IAM role — it needs `ec2:TerminateInstances` conditioned on `ec2:ResourceTag/runharbor:deployment-id` matching this deployment, and `ec2:DescribeInstances`.
- **`scheduleName` is empty.** Schedule creation failed at `start` time (this is logged but deliberately non-fatal, so it doesn't block getting to `ready`). This instance is relying entirely on the hourly orphan sweep below.

## 2. Did the hourly orphan sweep run?

The `timeout` Lambda also runs on an `aws_cloudwatch_event_rule` (`rate(1 hour)`) with input `{"mode":"sweep"}`, controlled by the `orphan_sweep_enabled` Terraform variable (default `true`). It finds EC2 instances tagged `runharbor:managed=true` for this deployment that are older than expected and have no `ready`/non-terminal `OP#` record, and terminates them.

- Confirm the rule is enabled: `terraform -chdir=infra/roots/connector output` doesn't show this directly — check the EventBridge console/CLI for the rule, or confirm `orphan_sweep_enabled = true` in `terraform.tfvars`.
- Check the `timeout` Lambda's logs for the most recent `sweep` invocation and whether it saw the instance in question. If the instance was launched very recently (within the sweep's grace window) it's expected not to be swept yet — wait for the next hourly run before escalating.

## 3. Manual intervention

If both backstops missed it (should be rare — file this as a bug if it happens with a valid `scheduleName` and `orphan_sweep_enabled = true`), you can terminate the instance directly from the AWS console or CLI using your own credentials; RunHarbor's runner instance role itself cannot do this (`AGENTS.md` — no `ec2:TerminateInstances` on the runner role is intentional, not a bug).

After terminating, check whether the `OP#` record needs a manual `failed`/`orphan_cleanup` update so it doesn't confuse the next `GET gsi1` scan — the next hourly sweep will reconcile this on its own if you'd rather not touch DynamoDB by hand.
