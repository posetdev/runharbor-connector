# Customer install guide

This is the detailed version of the README install. The default path is: create a repository from this template, bootstrap one IAM role in your AWS account, and run the **Deploy Connector** GitHub Action. The local CLI (`node cli/runharbor.mjs init` / `setup`) remains supported if you prefer to apply from a laptop. Read [`docs/design/06-infrastructure-and-delivery.md`](design/06-infrastructure-and-delivery.md) §4 if you want the design rationale behind each step.

Do not create AWS access keys. Do not store the enrollment token as a GitHub secret. The Action fetches scoped configuration from SaaS with a GitHub OIDC token (audience `runharbor-saas:onboarding`) and never prints that response.

## GitHub Actions path

### Prerequisites

- An AWS account you control. The Action will create IAM roles, Lambda functions, a DynamoDB table, an SSM parameter, an EventBridge Scheduler schedule group, a dedicated VPC with one public subnet per Availability Zone, an internet gateway, a route table, a security group, and an EventBridge rule — you only create the GitHub OIDC provider (once per account) and the deploy role below. That VPC is not connected to any other network in the account. The Connector does not create a NAT Gateway.
- No AMI to choose. RunHarbor hosts every runner on the same Canonical Ubuntu 24.04 LTS image (x86_64 and arm64), resolved at apply time from Canonical's public SSM parameters, with a pinned Docker install at first boot so `container:` and `services:` work. Windows is a later milestone. See [Runner host and containers](#runner-host-and-containers).
- An existing customer-owned S3 bucket for Terraform state (versioning on, public access blocked). The bootstrap template does not create this bucket.
- A GitHub user or organization where you're allowed to create a GitHub App (that happens after apply, in the browser).

### 1. Create the repository and the `production` environment

Create a repository from this template. In the new repository: **Settings → Environments → New environment** named `production`. Add required reviewers and restrict deployment branches to the repository default branch. The deploy workflow's OIDC subject is `repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:production`; a wildcard subject is rejected by the bootstrap template.

### 2. Register the GitHub OIDC provider (once per AWS account)

If the account does not already have `token.actions.githubusercontent.com`:

```sh
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" "1c5860f26b52d9e2239d7307f40f589f5b6048a3"
```

The CloudFormation template creates **only** the deploy role. It does not create the account-wide OIDC provider.

### 3. Create the deploy role

Template: [`infra/bootstrap/github-oidc-deploy-role.yaml`](../infra/bootstrap/github-oidc-deploy-role.yaml). Terraform's AWS provider needs `logs:DescribeLogGroups` and `ssm:DescribeParameters` to discover existing log groups and parameter metadata during plan/apply. AWS does not support resource-level authorization for those two actions, so the template grants each in its own statement with `Resource: "*"`. Create, delete, get, and put stay scoped to `/aws/lambda/rh-*` log groups and `/runharbor/*` parameters. The provider also reads a Lambda's code-signing configuration after creation; that read is limited to `rh-*` functions. Before Terraform can delete a `rh-*` schedule group, it may delete the schedules inside it; that permission is scoped to `arn:aws:scheduler:REGION:ACCOUNT:schedule/rh-*/*`.

Command path:

```sh
OWNER=<github-owner>
REPO=<github-repo>
OWNER_ID=$(gh api "users/${OWNER}" --jq .id)
REPO_ID=$(gh api "repos/${OWNER}/${REPO}" --jq .id)

aws cloudformation create-stack \
  --stack-name runharbor-gha-deployer \
  --template-body file://infra/bootstrap/github-oidc-deploy-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=GitHubOwner,ParameterValue="${OWNER}" \
    ParameterKey=GitHubOwnerId,ParameterValue="${OWNER_ID}" \
    ParameterKey=GitHubRepository,ParameterValue="${REPO}" \
    ParameterKey=GitHubRepositoryId,ParameterValue="${REPO_ID}" \
    ParameterKey=GitHubEnvironment,ParameterValue=production \
    ParameterKey=TerraformStateBucketName,ParameterValue=<state-bucket>
```

Console path: AWS CloudFormation → **Create stack** → **With new resources** → **Upload a template file** → choose `infra/bootstrap/github-oidc-deploy-role.yaml` → fill the same parameters. There is no public template URL to paste, and no callback URL field.

Record the `DeployRoleArn` output.

### 4. Set repository variables

**Settings → Secrets and variables → Actions → Variables** (not secrets):

| Variable | Required | Meaning |
|---|---|---|
| `AWS_ROLE_ARN` | yes | Deploy role ARN from the stack output |
| `AWS_REGION` | yes | Region for the Connector |
| `AWS_ACCOUNT_ID` | no | 12-digit account id; the workflow aborts on mismatch when set |
| `PURCHASE_MODE` | no | `spot` (default) or `on-demand` |
| `ALLOWED_INSTANCE_TYPES` | no | Comma-separated list; must include `c7g.xlarge` and `c7i.large` |
| `TF_STATE_BUCKET` | yes | Customer S3 bucket for Terraform state |
| `TF_STATE_KEY` | no | State object key; default `runharbor/connector.tfstate` |
| `RUNHARBOR_DEPLOYMENT_ID` | yes | `dep_…` from the SaaS console |

Region, allowed instance types and purchase mode stay in these repository variables. The Connector builds its own VPC at apply time, isolated from the rest of the account. SaaS supplies only the deployment identifiers, webhook URL, SaaS origin, bootstrap public key, and enrollment token — over OIDC, never as a GitHub secret.

### 5. Create the SaaS deployment

In the RunHarbor console, create a deployment bound to this repository's `owner/name`. SaaS stores that full name and compares it with the GitHub OIDC repository claim when the Action later calls `POST /api/v1/onboarding/deployments/{deploymentId}/configuration`. Copy the deployment id into `RUNHARBOR_DEPLOYMENT_ID`.

### 6. Run Deploy Connector

**Actions → Deploy Connector → Run workflow** on the default branch. After environment approval the single `deploy` job:

1. Requests a GitHub OIDC token with audience `runharbor-saas:onboarding` from `ACTIONS_ID_TOKEN_REQUEST_URL`.
2. POSTs it to SaaS using `RUNHARBOR_DEPLOYMENT_ID` and writes `.runharbor/deployment.json` without printing the body.
3. Packages the four Lambda zips.
4. Runs `terraform plan` and `terraform apply` in the same job so the plan file cannot cross runners.
5. Mints a 30-minute single-use Connector setup capability (actions-mode exchange), publishes the Function URL origin plus that capability to SaaS with a **separate** GitHub OIDC token (audience `runharbor-saas:onboarding`), and writes only `https://runharbor.poset.dev/deployments/<id>/setup/activate` to the job summary and stdout. Local CLI exchange stays 120 seconds. There is no workflow input for a callback URL.

If the console activate step says the setup handoff expired, re-run the workflow for a fresh publish. The activate path itself does not change.

### 7. Verify

Push [`examples/hello-world.yml`](../examples/hello-world.yml) to a repository the App is installed on (`runs-on: [self-hosted, rh-x64-2vcpu-4gib]`).

## Runner host and containers

Every job runs on the same host: Canonical's official **Ubuntu 24.04 LTS**, the image GitHub calls `ubuntu-latest`, on x86_64 and arm64 alike. You do not supply an AMI; at apply time Terraform resolves the current 24.04 LTS image per architecture from Canonical's public SSM parameters and keeps that resolution in state. At first boot the host installs a **pinned** Docker CE from Docker's own apt archive (a fixed signing-key fingerprint and fixed package versions) and puts the runner user in the `docker` group, so `container:` and `services:` work out of the box. Check `docker --version` in a job if you want to see which pinned version a runner carries.

- **Other distributions**: run those steps in a `container:` image rather than on the host. There is exactly one host OS.
- **arm64**: on an arm64 runner the container image must publish an arm64 variant (or a multi-arch manifest). An x86_64-only image will not start there.
- **Inside a container**: steps run as **root**, and there is no `sudo` — the image you bring is the environment you get.

## Local CLI path

Use this path when you want to apply from a laptop instead of GitHub Actions. Tool paths assume a standard `PATH`.

### Prerequisites

- Terraform `>= 1.10`, `hashicorp/aws ~> 6.0`, and Node.js `>= 24`, as above. You do not choose an AMI, a VPC or a subnet; apply creates them.
- A `deployment.json` downloaded from the SaaS console.

### Step 1 — create a deployment in the SaaS console

In the RunHarbor console, create a deployment, select the GitHub Organization that will own the App, and give it an optional display name. Download the resulting `deployment.json` (wire shape `runharbor.deployment.v2`, see [`docs/design/03-contracts-v1.md`](design/03-contracts-v1.md) §C5). It contains the SaaS-verified organization identity as well as the deployment bootstrap fields.

| Field | Meaning |
|---|---|
| `tenantId` | Your RunHarbor organization (tenant) id |
| `deploymentId` | This deployment's id (`dep_...`) |
| `bindingKey` | Opaque webhook routing key |
| `webhookUrl` | The exact URL GitHub should call — copy it verbatim, never reconstruct it |
| `saasOrigin` | The SaaS HTTPS origin |
| `saasPublicKey` | Pinned SaaS keyset-root Ed25519 public key (base64 SPKI). It verifies the detached signature on `/.well-known/runharbor-command-keys.v1.json`; rotating command keys do not require a Terraform reapply |
| `enrollmentToken` | One-time, 24-hour bearer token used once, during activation (step 5) |
| `enrollmentExpiresAt` | Epoch-ms expiry of the enrollment token |

You do not choose an AWS region here — that's decided by your own Terraform in step 2, and reported back to the SaaS during activation.

### Step 2 — prepare locally

```sh
git clone https://github.com/<your-fork>/runharbor.git
cd runharbor
npm ci
node cli/runharbor.mjs init \
  --config deployment.json \
  --region ap-southeast-2
```

Required flag: `--config`. Optional: `--region` (falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`; the command errors out rather than guessing a default region), `--purchase-mode` (`spot` or `on-demand`), `--allowed-instance-types` (comma-separated; must include `c7g.xlarge` and `c7i.large`). There is no AMI flag: the host image is resolved at apply time from Canonical's public SSM parameter for Ubuntu 24.04 LTS.

`runharbor init` then:

- Generates an Ed25519 keypair into `.runharbor/installer.key` (mode `0600`) — this is what proves you, not a GitHub credential, are driving `runharbor setup` in step 4.
- Writes the enrollment token from `deployment.json` into `.runharbor/enrollment.token` (mode `0600`).
- Writes `infra/roots/connector/terraform.tfvars`.
- Writes `infra/roots/connector/backend.hcl.example` as a placeholder for your own Terraform backend configuration.

`.runharbor/` and `*.tfvars` (other than `*.example.tfvars` files) are gitignored — never commit them.

### `terraform.tfvars` field reference

`runharbor init` writes these for you; the table is here so you can audit or hand-edit the file (for example to enlarge `root_volume_gib`).

| Key | Source | Notes |
|---|---|---|
| `aws_region` | `--region` / env | Must match `^[a-z]{2}(-[a-z]+)+-[0-9]$` |
| `name_prefix` | derived (`rh-<deploymentId fragment>`) | Prefixes every AWS resource name; `^[a-z][a-z0-9-]{2,30}$` |
| `deployment_id` | `deployment.json` | `^dep_[0-9a-f]{24}$` |
| `tenant_id` | `deployment.json` | Your RunHarbor organization (tenant) id |
| `saas_origin` | `deployment.json` | HTTPS origin, `^https://` |
| `saas_public_key` | `deployment.json` | Keyset-root pin; fetched keysets are accepted only after this public key verifies the document signature |
| `webhook_url` | `deployment.json`, copied verbatim | Never reconstructed from `saas_origin` + `bindingKey` — treat it as opaque |
| `installer_public_key` | generated by `runharbor init` | Base64 SPKI Ed25519; the `setup` Lambda uses it to verify your CLI's one-time setup ticket |
| `images` | `runharbor init` defaults | Map of `x64` and `arm64` to `{ root_volume_gib, max_duration_minutes }`. The AMI is not a field: at apply the module resolves Canonical's public SSM parameter for Ubuntu 24.04 LTS (`/aws/service/canonical/ubuntu/server/24.04/stable/current/<arch>/hvm/ebs-gp3/ami-id`) and reads the root device name from that image. `root_volume_gib` carries the job's workspace, not just the OS: the runner's `_work` directory is bind mounted onto the root volume, so size it for your largest checkout and build. |
| `allowed_instance_types` | `--allowed-instance-types` / `ALLOWED_INSTANCE_TYPES`, default `c7g.xlarge,c7i.large` | The customer-controlled launch allowlist; it must contain `c7g.xlarge` and `c7i.large`. The Connector gives a readable permanent rejection for a parsed, unlisted type, and IAM re-enforces the same list at `RunInstances`. |
| `purchase_mode` | `--purchase-mode` / `PURCHASE_MODE`, default `spot` | `spot` or `on-demand`. Keep this in customer config, not in SaaS. |
| `log_retention_days` | default `14` | CloudWatch Logs retention for all four Lambda log groups |
| `orphan_sweep_enabled` | default `true` | Enables the hourly tag-based orphan-instance cleanup |
| `lambda_artifact_dir` | optional | Only set this if you're not building the Lambda zips locally (e.g. pointing at a downloaded GitHub Release) |

### Step 3 — deploy

```sh
terraform -chdir=infra/roots/connector init -backend-config=backend.hcl
terraform -chdir=infra/roots/connector apply
```

Copy `backend.hcl.example` to `backend.hcl` (or your own name) with your own state backend configuration first — RunHarbor doesn't provide one. One `apply` creates everything: four Lambdas (`start`, `runner`, `setup`, `timeout`), a DynamoDB table, an SSM parameter, a dedicated VPC (`10.64.0.0/16`) with one public subnet per Availability Zone, an internet gateway and route table, a security group with no inbound rules and all outbound allowed, IAM roles scoped per function, an EventBridge Scheduler group, and an hourly orphan-sweep rule. Runners launch only in that VPC. It is not peered to any other network. There is no NAT Gateway. The `start` Function URL is public (`NONE`); SaaS is not granted AWS IAM. Nothing is activated yet.

### Step 4 — create the GitHub App

```sh
node cli/runharbor.mjs setup
```

This reads `terraform output`, signs a short-lived (5-minute) Ed25519 ticket with `.runharbor/installer.key`, exchanges it with the `setup` Lambda for a one-time 120-second handoff code, and opens your browser to complete Connector setup (see [`docs/setup-ui.md`](setup-ui.md) for setup UI states and design). The GitHub Action instead runs `setup --print-url`: that uses the separate 30-minute actions-mode exchange, publishes the origin and capability to SaaS over a new OIDC token, and prints only `/deployments/<id>/setup/activate`. From there:

1. Click "Create GitHub App" — the setup page displays the proposed App name (deterministically derived from your verified GitHub organization as `RunHarbor (<org>)`, max 34 characters, to prevent global naming collisions) and allows editing it before posting the Manifest to GitHub (`hook_attributes.url` is your `webhook_url`; permissions requested are `actions:read`, `administration:write`, `metadata:read`; event `workflow_job`).

2. GitHub redirects back with the new App's credentials, which the `setup` Lambda writes straight into your Connector's SSM parameter — your terminal and browser never see the private key.
3. You're guided to the App's installation page; choose the repositories that should be allowed to use RunHarbor runners.

### Step 5 — activation (automatic)

Once installation completes, the `setup` Lambda validates it, writes the `DEPLOYMENT` record, and calls the SaaS `activate` endpoint using the enrollment token from step 1. The status page in your browser shows "activated"; you can also check from the CLI:

```sh
node cli/runharbor.mjs status
```

If activation fails, check `node cli/runharbor.mjs status` and the `setup` Lambda's CloudWatch log group for the reason. The enrollment token is single-use only after a *successful* activation, so as long as it hasn't passed `enrollmentExpiresAt`, re-run `node cli/runharbor.mjs setup`: once the `DEPLOYMENT` record exists the setup page no longer offers to create a GitHub App and shows a **Retry activation** button instead, which re-sends activation for the App you already installed. Don't create a second GitHub App. Past 24 hours, reissue a token from the console, re-run `runharbor init` with the new `deployment.json`, then `runharbor setup` and **Retry activation**.

### Step 6 — verify

Push [`examples/hello-world.yml`](../examples/hello-world.yml) to a repository the App is installed on:

```yaml
runs-on: [self-hosted, rh-x64-2vcpu-4gib]
```

Watch it: GitHub sends `workflow_job.queued`, the SaaS dispatches to your Connector, an EC2 instance launches, claims its one-time JIT runner config, executes the job, and powers itself off (the instance then terminates on its own — the Connector never calls `TerminateInstances` for the happy path).

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `a valid --region is required (or set AWS_REGION/AWS_DEFAULT_REGION)` | No `--region` flag and no region env var | Pass `--region` explicitly, or export `AWS_REGION` |
| `invalid deployment.json` | File isn't the exact `runharbor.deployment.v2` shape, or is missing a required field | Re-download `deployment.json` from the console; don't hand-edit it |
| `EEXIST` on `.runharbor/installer.key` or `.runharbor/enrollment.token` | `runharbor init` was already run in this checkout | Only run `init` once per deployment; if you're re-initializing intentionally, remove `.runharbor/` first |
| `setup ticket exchange failed` | The Connector isn't deployed yet, `terraform output setup_url` is stale, or the installer keypair doesn't match what's in `terraform.tfvars` | Confirm `terraform apply` succeeded and `installer_public_key` in `terraform.tfvars` matches `.runharbor/installer.key`'s public half (re-run `init` if you regenerated the key) |
| Browser shows "no valid session, run `runharbor setup` again" | The one-time handoff code (120-second lifetime) expired before you opened the link, or you reused a link from a previous `runharbor setup` run | Re-run `node cli/runharbor.mjs setup` and open the newly printed/opened link promptly |
| Activation shows `failed` on the status page | The enrollment token expired, or the SaaS rejected the payload (e.g. region mismatch between `startFunctionUrl` and `awsRegion`) | Re-run `node cli/runharbor.mjs setup` and click **Retry activation** if the token hasn't expired; otherwise reissue a token in the console, re-run `runharbor init`, then retry the same way |
| `hello-world.yml` job stays queued and no runner ever registers | The App isn't installed on that repository, or the workflow's `runs-on` lacks exactly one valid `rh-...` runner label | See [`docs/runbooks/job-not-started.md`](runbooks/job-not-started.md) |
| `hello-world.yml` job stays queued while a runner shows `online` and idle | The runner registered without every label the job's `runs-on` asks for, so GitHub can never schedule the job onto it | See [`docs/runbooks/job-not-started.md`](runbooks/job-not-started.md) |
