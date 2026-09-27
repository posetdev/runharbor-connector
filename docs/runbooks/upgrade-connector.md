# Runbook: upgrade the Connector

RunHarbor does not push updates to your Connector. You control when it upgrades, and it upgrades the same way you first deployed it: pull, then `apply` (re-run [`.github/workflows/deploy-connector.yml`](../../.github/workflows/deploy-connector.yml) if you deployed with GitHub Actions).

## Steps

```sh
git pull
npm ci
node cli/runharbor.mjs status   # confirm the deployment is currently healthy before changing anything
```

Review `git log` / the release notes for the versions between your current commit and the new one — in particular, watch for changes under `infra/modules/connector/` (new variables, changed IAM policy shape) or `packages/contracts/` (a bumped `apiVersion` on any wire contract means the SaaS and Connector must agree on the new shape; check [`docs/design/03-contracts-v1.md`](../design/03-contracts-v1.md) for the current contract versions).

```sh
terraform -chdir=infra/roots/connector plan
```

Read the plan. Expect Lambda code updates (new zip hash) and, occasionally, new resources; you should not see Terraform wanting to replace the DynamoDB table, the SSM parameter, or anything that would lose state — if it does, stop and investigate before applying.

```sh
terraform -chdir=infra/roots/connector apply
```

## What upgrading does not do

- It does not touch GitHub App registration or installation — those were a one-time step in `runharbor setup` and aren't repeated.
- It does not re-run activation with the SaaS — your `deploymentId` and existing `DEPLOYMENT` record are untouched.
- It does not migrate old operation records. In-flight operations (`OP#` items not yet in a terminal state) at the moment of `apply` should be allowed to finish naturally before or shortly after the upgrade; the design has no explicit backward-compatibility path for in-flight state across incompatible versions (see [`docs/design/01-architecture.md`](../design/01-architecture.md) design principle 0 — no migration scripts, no compatibility branches).

## If something looks wrong after upgrading

Roll back by checking out the previous commit and re-running `terraform apply` from that state — the Connector module has no persistent-data migrations to reverse, only infrastructure to reconcile back. Confirm with `node cli/runharbor.mjs status` and a test run of [`examples/hello-world.yml`](../../examples/hello-world.yml).
