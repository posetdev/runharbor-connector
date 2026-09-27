# RunHarbor Connector

This repository deploys the RunHarbor Connector into your own AWS account: a small Lambda + Terraform installation that runs your GitHub Actions jobs on EC2 runners you control. You keep the GitHub App credentials; the hosted RunHarbor control plane only ever sees signed job traffic.

Create your deployment repository from this template, then follow the install manual. Nothing here talks to AWS until you run the deploy workflow yourself.

## Install

The full walkthrough is [`docs/customer-install.md`](docs/customer-install.md). The short version:

1. **Create the deploy role** in your AWS account with [`infra/bootstrap/github-oidc-deploy-role.yaml`](infra/bootstrap/github-oidc-deploy-role.yaml). It trusts only this repository plus the `production` environment. AWS authentication is GitHub Actions OIDC — do not create AWS access keys, and do not paste an enrollment token into GitHub secrets.
2. **Configure the `production` environment** in this repository with the values listed in [`docs/customer-install.md`](docs/customer-install.md) (`AWS_REGION`, `AWS_ROLE_ARN`, `VPC_ID`, `SUBNET_ID`, `AMI_ID`, `TF_STATE_BUCKET`, `RUNHARBOR_DEPLOYMENT_ID`, and the optional ones).
3. **Run** [`.github/workflows/deploy-connector.yml`](.github/workflows/deploy-connector.yml). It fetches the scoped deployment configuration from RunHarbor, packages the Lambdas, and runs `terraform plan` / `apply` in one job.
4. **Click the continuation link** printed in the job summary and create + install the GitHub App on your organization.
5. **Smoke-test** by pushing [`examples/hello-world.yml`](examples/hello-world.yml) to a repository the App is installed on.

Prefer a laptop over GitHub Actions? `node cli/runharbor.mjs init` and `node cli/runharbor.mjs setup` do the same steps from your machine.

## Upgrades

You control when the Connector upgrades. See [`docs/runbooks/upgrade-connector.md`](docs/runbooks/upgrade-connector.md), then run [`.github/workflows/upgrade-connector.yml`](.github/workflows/upgrade-connector.yml).

## Day-two operations

- [`docs/runbooks/job-not-started.md`](docs/runbooks/job-not-started.md) — a job stays queued and no runner picks it up.
- [`docs/runbooks/instance-not-terminated.md`](docs/runbooks/instance-not-terminated.md) — a runner instance is still running after the job.
- [`docs/runbooks/rotate-webhook-secret.md`](docs/runbooks/rotate-webhook-secret.md) — rotate the webhook secret.

## Layout

| Path | What it is |
| --- | --- |
| `.github/workflows/` | Deploy and upgrade workflows (manual dispatch only). |
| `bootstrap/` | The reviewed runner bootstrap scripts the EC2 user-data embeds. |
| `cli/` | Local CLI (`init`, `setup`, `status`). |
| `docs/` | Install manual, setup UI description, operational runbooks. |
| `examples/` | A minimal workflow to prove a runner accepts jobs. |
| `infra/bootstrap/` | CloudFormation template for the one-time deploy role. |
| `infra/modules/connector/` | Terraform module that owns the Connector. |
| `infra/roots/connector/` | Terraform root you apply (state backend is yours). |
| `packages/contracts/` | Wire contract definitions shared by the Lambdas. |
| `scripts/` | Build and deploy helpers the workflows call. |
| `src/` | Lambda sources. |

`TEMPLATE_SOURCE.json` records the source commit and version this tree was generated from.

## Security properties

- The GitHub App private key, installation token, and JIT configuration never leave your AWS account (they live in SSM Parameter Store / DynamoDB inside your account).
- There are no static AWS credentials in this repository; the workflow assumes a role through GitHub OIDC.
- Caller-controlled AMI ids, user-data, shell commands, download URLs, IAM roles, network configuration, and callback URLs are not accepted by the runtime interfaces.
