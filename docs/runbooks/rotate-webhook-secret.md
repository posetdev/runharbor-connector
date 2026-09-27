# Runbook: rotate the webhook secret

The webhook secret is the only secret that crosses the SaaS/Connector boundary (see [`docs/design/01-architecture.md`](../design/01-architecture.md) §2.3). Rotate it if it may have leaked, as part of routine credential hygiene, or if GitHub itself forces a change.

## 1. Generate a new secret on GitHub

In the GitHub App's settings page (Settings → your App → General), set a new webhook secret. GitHub uses this value going forward for `X-Hub-Signature-256` on every subsequent delivery.

## 2. Update it in the SaaS

In the RunHarbor console, use the deployment's "update secret" action. This calls the `api` Lambda, which re-encrypts the new secret with the SaaS's KMS key and overwrites `binding.webhookSecretCiphertext` on the `BINDING#<bindingKey>` item (see [`docs/design/04-data-model.md`](../design/04-data-model.md) §2). This is a SaaS-side operation only — the Connector's Terraform and DynamoDB state are untouched, because the webhook secret never lived there in the first place.

## 3. Verify

Trigger a test webhook delivery (GitHub's App settings page has a "Redeliver" / test ping option, or push [`examples/hello-world.yml`](../../examples/hello-world.yml)) and confirm it's accepted — no `INVALID_SIGNATURE` in the `webhook` Lambda's logs, and a new `delivery` item with `outcome: "accepted"` (or `"duplicate"` for a redelivery).

## Notes

- There is a short window between generating the new secret on GitHub and confirming the console update where deliveries could fail signature verification if GitHub applies the new secret before the SaaS has it stored. If you see a burst of `INVALID_SIGNATURE` failures right after rotation, confirm the console update actually completed before investigating further.
- The webhook secret is never written to logs, error responses, or `DELIVERY` records at any point in this flow — if you need to confirm rotation happened, check `updatedAt`/version metadata on the `BINDING` item, not the secret value itself.
- This is unrelated to the GitHub App private key (which lives only in your Connector's SSM parameter and isn't part of this flow) or the enrollment token (single-use, consumed at initial activation).
