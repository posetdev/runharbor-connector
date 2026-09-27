import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createInstallationTokenCache } from '../adapters/github/app-auth.js';
import { getInstallation, listInstallationRepos } from '../adapters/github/installation.js';
import { convertManifestCode } from '../adapters/github/manifest.js';
import { SaasActivateClient } from '../adapters/saas/activate.js';
import { DynamoDeploymentStore } from '../adapters/dynamodb/deployment-store.js';
import { DynamoOperationStore } from '../adapters/dynamodb/operation-store.js';
import { DynamoSetupStore } from '../adapters/dynamodb/setup-store.js';
import { readAppCredentials, writeAppCredentials } from '../adapters/ssm/secrets.js';
import { aws } from './aws.js';
import { config } from './config.js';

export function composeSetup() {
  const document = DynamoDBDocumentClient.from(aws.dynamo());
  const setup = new DynamoSetupStore(document, config.tableName);
  const deployments = new DynamoDeploymentStore(document, config.tableName);
  const operations = new DynamoOperationStore(document, config.tableName);
  const installationTokens = createInstallationTokenCache();
  return {
    runtime: { config, store: setup }, deployments, operations,
    github: { convertManifest: (code: string) => convertManifestCode(code, config.githubAppOrganization), getInstallation, installationToken: installationTokens.getInstallationAccessToken, listInstallationRepos },
    secrets: { readAppCredentials: (name: string) => readAppCredentials(name, aws.ssm()), writeAppCredentials: (name: string, value: Parameters<typeof writeAppCredentials>[1]) => writeAppCredentials(name, value, aws.ssm()) },
    saas: new SaasActivateClient(config.saasOrigin),
  };
}
