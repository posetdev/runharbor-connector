import { createAppJwt, REQUIRED_INSTALLATION_PERMISSIONS } from '../../adapters/github/app-auth.js';
import type { EpochMs } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import type { DeploymentRecord } from '../../domain/deployment.js';
import type { DeploymentStore } from '../../ports/deployment-store.js';
import type { GitHubPort } from '../../ports/github.js';
import type { SaasPort } from '../../ports/saas.js';
import type { SecretsPort } from '../../ports/secrets.js';
import { activationRequest, recordActivationFailure, type SetupRuntime } from './shared.js';

export async function installed(runtime: SetupRuntime, deploymentStore: DeploymentStore, github: Pick<GitHubPort, 'getInstallation' | 'installationToken' | 'listInstallationRepos'>, secrets: SecretsPort, saas: SaasPort, sessionHash: string, enrollmentToken: string, installationId: string, now: EpochMs): Promise<DeploymentRecord> {
  // A DEPLOYMENT record means a previous installed already verified an installation. A second pass
  // would only fail on create's notExists condition; say which path applies instead. Never turn
  // this GitHub callback into a retry: pending/failed activation is resumed by retryActivate.
  const existing = await deploymentStore.get();
  if (existing !== undefined) throw new AppError('STATE_CONFLICT', { cause: new Error(existing.saasActivation.status === 'active' ? 'deployment is already active' : 'deployment exists but is not active; use POST /setup/retry-activate') });
  const session = await runtime.store.getSession(sessionHash);
  if (session === undefined || session.status !== 'app_created' || session.githubAppId === undefined || session.expectedOwner === undefined) throw new AppError('STATE_CONFLICT');
  const credentials = await secrets.readAppCredentials(runtime.config.githubAppParameterName);
  const installation = await github.getInstallation(installationId, createAppJwt(credentials.pem, credentials.appId, now));
  const expectedOrganization = runtime.config.githubAppOrganization;
  if (installation.appId !== session.githubAppId || installation.account.id !== session.expectedOwner.id || installation.account.type !== session.expectedOwner.type || installation.account.login.toLowerCase() !== session.expectedOwner.login.toLowerCase() || installation.account.id !== expectedOrganization.id || installation.account.type !== 'Organization' || installation.account.login.toLowerCase() !== expectedOrganization.login.toLowerCase() || installation.repositorySelection !== 'all') throw new AppError('FORBIDDEN');
  const token = await github.installationToken({ appId: credentials.appId, pem: credentials.pem, installationId, permissions: REQUIRED_INSTALLATION_PERMISSIONS });
  const repositories = await github.listInstallationRepos(token.token);
  const record: DeploymentRecord = { pk: 'DEPLOYMENT', sk: '#', kind: 'deployment', schema: 1, revision: 0, createdAt: now, updatedAt: now, deploymentId: runtime.config.deploymentId, tenantId: runtime.config.tenantId, github: { appId: credentials.appId, appSlug: credentials.slug, installationId, owner: installation.account, repositories: [...repositories] }, ssmParameterName: runtime.config.githubAppParameterName, saasActivation: { status: 'pending', lastAttemptAt: now } };
  const deployment = await deploymentStore.create(record);
  await runtime.store.advanceSession(session, 'installed', { updatedAt: now });
  const activation = activationRequest(runtime.config, deployment, credentials.webhookSecret);
  try {
    if (runtime.config.startFunctionUrl === undefined) throw new AppError('INTERNAL');
    await saas.activate(runtime.config.deploymentId, enrollmentToken, activation);
    const active = await deploymentStore.update(deployment, { activatedAt: now, saasActivation: { status: 'active', lastAttemptAt: now }, updatedAt: now });
    await runtime.store.advanceSession(await runtime.store.getSession(sessionHash) as typeof session, 'activated', { updatedAt: now });
    return active;
  } catch (error) {
    await recordActivationFailure(deploymentStore, deployment, error, now);
    throw error;
  }
}
