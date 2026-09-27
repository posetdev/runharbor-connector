# Runbook: a job didn't start

Symptom: a `workflow_job` stays `queued` in GitHub and no runner ever picks it up.

Trace the job's path in order — SaaS webhook receipt → SaaS dispatch → Connector operation — and stop at the first place it deviates from the happy path. Wire shapes referenced below are defined in [`docs/design/03-contracts-v1.md`](../design/03-contracts-v1.md); record shapes in [`docs/design/04-data-model.md`](../design/04-data-model.md).

## 1. Did the webhook arrive and get accepted?

On the SaaS side, find the `job` record: `BINDING#<bindingKey>` / `JOB#<repositoryId>#<jobId>#<runAttempt>`.

- **No `job` record at all.** GitHub either never sent the webhook (check the App's "Recent Deliveries" page) or the webhook Lambda rejected it before writing anything. Check `delivery` (`BINDING#<bindingKey>` / `DELIVERY#<deliveryId>`) for `outcome: "rejected"` and the CloudWatch logs of the `webhook` Lambda for the error code. A missing `rh-` label is intentionally `204 ignored`; multiple runner labels are `AMBIGUOUS_RUNNER_LABEL`; one runner label no AWS shape can cover is `UNSATISFIABLE_RUNNER_LABEL`.
- **No `job` record, no `delivery` record, and no application log line at all.** The request was rejected between signature verification and the first write — the one window that leaves nothing behind on our side — so GitHub's delivery log is the only evidence. Open the App's "Recent Deliveries" and read the response code: `400` means the headers or body failed contract validation (`X-GitHub-Event`/`X-GitHub-Delivery` missing or not matching `deliveryIdSchema`, an unparsable body, or a bare integer wider than `Number.MAX_SAFE_INTEGER`); `401` is a signature mismatch; `404` means the `bindingKey` in the URL matches no active `BINDING`. Note that a `400` here is indistinguishable from a healthy deployment by inspection of our own tables and logs — that is why this bullet exists.
- **`job.state = "queued"` but stuck.** The webhook wrote the record but the SQS `SendMessage` failed. Look for `delivery.outcome = "enqueue_failed"` and the SaaS `webhook` Lambda's 500s. GitHub does not automatically retry a webhook on a 500; you'll need the console's re-delivery action (or GitHub's own "Redeliver" button on the App's delivery log).

## 2. Did dispatch reach the Connector?

If `job.state = "enqueued"`, the message is sitting in (or moved through) SQS. Check the `jobs` queue and its DLQ.

- **Message in the DLQ.** It failed `maxReceiveCount` (6) times. Check the `dispatch` Lambda's CloudWatch logs for the last error. A `401 UNAUTHENTICATED` / `401 INVALID_SIGNATURE` from the Connector means the command envelope failed root-signed key discovery or Ed25519 verification (unsigned/forged keyset, wrong keyset-root pin, retired keyId, or a signature that does not match). A `422 JOB_NOT_ELIGIBLE` means the Connector asked GitHub and the job wasn't actually queued (already picked up, cancelled, or the label didn't match on the Connector's own admission check) — this is terminal, not a bug.
- **`job.state = "dispatched"` with `connectorState` present.** Dispatch succeeded; move to step 3 using the `operationId` recorded on the `job` item.

## 3. What does the Connector's operation say?

On the Connector side, `GetItem OP#<operationId>` (or, if you don't have the id, `Query gsi1 gsi1pk="OP"` sorted by `gsi1sk` to find the most recent one).

| `state` | Meaning | What to check |
|---|---|---|
| `accepted` | Admission passed, instance not launched yet | If `updatedAt` is more than ~90 seconds old, the `start` Lambda invocation that should have advanced it died mid-flight; the next SQS redelivery will resume from here. If nothing is redelivering (already in the DLQ), redrive the DLQ message. |
| `launched` | `RunInstances` succeeded, JIT not generated yet | Check the `start` Lambda's logs around the GitHub API call used to generate JIT config; rate limiting or a revoked installation are the usual causes. |
| `ready` | JIT config was written; waiting for the instance to claim it | Check the EC2 instance's system log / bootstrap output for its `GET /jit/readiness` polling. If the instance never launched a bootstrap script, check the selected image's AMI and user-data, and the security group's outbound rules. The bootstrap prints only `secure JIT claim failed` and then powers the instance off, so read the `runner` Lambda's log group for the `runner_error` line naming the refusal. |
| `ready` with `jitClaimedAt` set, and the runner is `online` and idle | The claim worked; the runner simply cannot be scheduled | `GET /repos/{owner}/{repo}/actions/runners` and compare that runner's `labels` against the job's `runs-on`. A JIT runner carries **exactly** the labels it registered with — GitHub adds none of `self-hosted`/`Linux`/`X64` the way `config.sh` does — and a job is only scheduled onto a runner carrying *every* label it asks for. |
| `done` / `failed` | Terminal | `failed` carries `terminalReason` (`timeout`, `launch_failed`, `jit_failed`, `admission_failed`, `orphan_cleanup`) — that's your root cause directly. |

`start`'s own CloudWatch log group has one structured line per attempt; none of it echoes secrets, so it's safe to paste into a ticket.

## 4. Nothing above shows the job at all

If you can't find a `job` item on the SaaS side or an `OP#` item on the Connector side for a job you know GitHub queued, the deployment or binding configuration itself is likely wrong (installation id mismatch, repository not in the deployment's list, or the Connector's `deployment_id` doesn't match what the SaaS has on file). Re-check activation status with `node cli/runharbor.mjs status` and compare against the SaaS console's deployment page.
