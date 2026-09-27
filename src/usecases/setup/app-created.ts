import type { EpochMs } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import type { DeploymentStore } from '../../ports/deployment-store.js';
import type { GitHubPort } from '../../ports/github.js';
import type { SecretsPort } from '../../ports/secrets.js';
import type { SetupRuntime } from './shared.js';
import { sha256 } from './shared.js';

export async function appCreated(runtime: SetupRuntime, deploymentStore: DeploymentStore, github: Pick<GitHubPort, 'convertManifest'>, secrets: SecretsPort, state: string, code: string, now: EpochMs): Promise<{ slug: string }> {
  const session = await runtime.store.getSession(sha256(state));
  if (session === undefined || session.status !== 'pending') throw new AppError('NOT_FOUND');
  // A DEPLOYMENT record means some App is already installed and named by it. Finishing a second
  // manifest flow here would overwrite SSM with credentials that record does not name, and
  // retry-activate would then refuse on the appId mismatch, leaving no way forward. Refusing costs
  // the customer an orphan App on GitHub, which they can delete; accepting costs them the deployment.
  if (await deploymentStore.get() !== undefined) throw new AppError('STATE_CONFLICT');
  const converted = await github.convertManifest(code);
  await secrets.writeAppCredentials(runtime.config.githubAppParameterName, { appId: converted.appId, slug: converted.slug, pem: converted.pem, clientId: converted.clientId, webhookSecret: converted.webhookSecret });
  await runtime.store.advanceSession(session, 'app_created', { githubAppId: converted.appId, expectedOwner: converted.owner, updatedAt: now });
  return { slug: converted.slug };
}
