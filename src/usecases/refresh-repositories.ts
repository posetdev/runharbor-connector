import type { RepositoryRefreshRequest, RepositoryRefreshResponse } from '@runharbor/contracts';
import { AppError } from '../domain/errors.js';
import { REQUIRED_INSTALLATION_PERMISSIONS, type GitHubPort } from '../ports/github.js';
import type { DeploymentStore } from '../ports/deployment-store.js';
import type { SecretsPort } from '../ports/secrets.js';

export type RepositoryRefreshSettings = Readonly<{ deploymentId: string; githubAppParameterName: string }>;

/**
 * SaaS can request a refresh but cannot provide the repository list. The Connector reads that list
 * from GitHub using its customer-held App credentials, persists it locally, then returns identities only.
 */
export async function refreshRepositories(
  request: RepositoryRefreshRequest,
  deployments: DeploymentStore,
  github: GitHubPort,
  secrets: SecretsPort,
  settings: RepositoryRefreshSettings,
): Promise<RepositoryRefreshResponse> {
  if (request.deploymentId !== settings.deploymentId) throw new AppError('FORBIDDEN');
  const deployment = await deployments.get();
  if (deployment === undefined || deployment.saasActivation.status !== 'active') throw new AppError('FORBIDDEN');
  const credentials = await secrets.readAppCredentials(settings.githubAppParameterName);
  const token = await github.installationToken({ appId: credentials.appId, pem: credentials.pem, installationId: deployment.github.installationId, permissions: REQUIRED_INSTALLATION_PERMISSIONS });
  const repositories = await github.listInstallationRepos(token.token);
  if (repositories.length === 0 || repositories.length > 1_000) {
    throw new AppError('UPSTREAM_UNAVAILABLE', {
      cause: { name: 'GitHubRepositoryScopeError', code: `repository_count_${repositories.length}` },
    });
  }
  const updated = await deployments.update(deployment, { github: { ...deployment.github, repositories: [...repositories] } });
  return { apiVersion: 'runharbor.repository-refresh.v1', deploymentId: updated.deploymentId, github: { installationId: updated.github.installationId, repositories: updated.github.repositories } };
}
