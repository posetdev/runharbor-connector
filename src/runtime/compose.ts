import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoCommandStore } from '../adapters/dynamodb/command-store.js';
import { DynamoDeploymentStore } from '../adapters/dynamodb/deployment-store.js';
import { DynamoOperationStore } from '../adapters/dynamodb/operation-store.js';
import { Ec2Adapter } from '../adapters/ec2/client.js';
import { createInstallationTokenCache } from '../adapters/github/app-auth.js';
import { getInstallation, listInstallationRepos } from '../adapters/github/installation.js';
import { dispatchWorkflow, generateJitConfig } from '../adapters/github/jit.js';
import { getJob, getRun } from '../adapters/github/jobs.js';
import { convertManifestCode } from '../adapters/github/manifest.js';
import { HttpsCommandKeysClient } from '../adapters/https/command-keys.js';
import { SchedulerAdapter } from '../adapters/scheduler/scheduler.js';
import { readAppCredentials, writeAppCredentials } from '../adapters/ssm/secrets.js';
import type { CommandKeyResolver } from '../ports/command-keys.js';
import type { CommandStore } from '../ports/command-store.js';
import type { DeploymentStore } from '../ports/deployment-store.js';
import type { Ec2Port } from '../ports/ec2.js';
import type { GitHubPort } from '../ports/github.js';
import type { OperationStore } from '../ports/operation-store.js';
import type { SchedulerPort } from '../ports/scheduler.js';
import type { AppCredentials, SecretsPort } from '../ports/secrets.js';
import { CommandKeyDirectory } from '../usecases/command-keys.js';
import { aws } from './aws.js';
import { config } from './config.js';

export function compose() { return { config }; }

let document: DynamoDBDocumentClient | undefined;
const documentClient = () => (document ??= DynamoDBDocumentClient.from(aws.dynamo()));

export function operationStore(): DynamoOperationStore { return new DynamoOperationStore(documentClient(), config.tableName); }

export function ec2Adapter(): Ec2Adapter {
  // Only the runner Lambda's own config omits runnerClaimUrl (it would be its own URL), and the
  // runner only ever reads instances through this adapter. Ec2Adapter therefore takes the URL as
  // optional and refuses a launch without it, rather than this factory refusing to build at all:
  // that refusal ran before the runner handler's routing and made every request a silent 500.
  return new Ec2Adapter(aws.ec2(), { deploymentId: config.deploymentId, region: config.awsRegion, runnerFunctionUrl: config.runnerClaimUrl, images: config.images, subnetIds: config.subnetIds, securityGroupId: config.securityGroupId, instanceProfileArn: config.instanceProfileArn, purchaseMode: config.purchaseMode });
}

/** The App credentials are read from SSM once per container (D8); a failed read is not cached. */
let credentials: Promise<AppCredentials> | undefined;
const secrets: SecretsPort = {
  readAppCredentials: (parameterName) => (credentials ??= readAppCredentials(parameterName, aws.ssm()).catch((error: unknown) => { credentials = undefined; throw error; })),
  writeAppCredentials: (parameterName, data) => writeAppCredentials(parameterName, data, aws.ssm()),
};

const tokens = createInstallationTokenCache();
const github: GitHubPort = {
  installationToken: (request) => tokens.getInstallationAccessToken(request),
  getJob: (owner, repo, jobId, token) => getJob(owner, repo, jobId, token),
  getRun: (owner, repo, runId, token) => getRun(owner, repo, runId, token),
  generateJitConfig: (owner, repo, name, labels, token) => generateJitConfig(owner, repo, name, labels, token),
  dispatchWorkflow: (owner, repo, workflowFile, ref, inputs, token) => dispatchWorkflow(owner, repo, workflowFile, ref, inputs, token),
  convertManifest: (code) => convertManifestCode(code, config.githubAppOrganization),
  getInstallation: (installationId, jwt) => getInstallation(installationId, jwt),
  listInstallationRepos: (token) => listInstallationRepos(token),
};

export type StartDeps = Readonly<{
  operations: OperationStore;
  deployments: DeploymentStore;
  secrets: SecretsPort;
  github: GitHubPort;
  ec2: Ec2Port;
  scheduler: SchedulerPort;
  commands: CommandStore;
  commandKeys: CommandKeyResolver;
}>;
let start: StartDeps | undefined;
export function composeStart(): StartDeps {
  return (start ??= {
    operations: operationStore(),
    deployments: new DynamoDeploymentStore(documentClient(), config.tableName),
    secrets,
    github,
    ec2: ec2Adapter(),
    scheduler: new SchedulerAdapter(aws.scheduler(), config),
    commands: new DynamoCommandStore(documentClient(), config.tableName),
    commandKeys: new CommandKeyDirectory(new HttpsCommandKeysClient(config.saasOrigin), config.saasPublicKey),
  });
}

export type TimeoutDeps = Readonly<{ operations: OperationStore; ec2: Ec2Port }>;
let timeout: TimeoutDeps | undefined;
export function composeTimeout(): TimeoutDeps {
  return (timeout ??= { operations: operationStore(), ec2: ec2Adapter() });
}
