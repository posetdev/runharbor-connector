import type { EpochMs } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import type { DeploymentRecord } from '../../domain/deployment.js';
import type { DeploymentStore } from '../../ports/deployment-store.js';
import type { SaasPort } from '../../ports/saas.js';
import type { SecretsPort } from '../../ports/secrets.js';
import { activationRequest, recordActivationFailure, type SetupRuntime } from './shared.js';

/**
 * Re-sends activation for a DEPLOYMENT that installed wrote but could not activate. Takes no GitHub
 * port on purpose: installed already verified the installation, and a retry must not be a second
 * chance to swap it. The payload comes from the record only. sessionHash is the installer's
 * setupStateHash when the same browser session is still around; it is advisory, never a gate.
 */
export async function retryActivate(runtime: SetupRuntime, deploymentStore: DeploymentStore, secrets: SecretsPort, saas: SaasPort, sessionHash: string | undefined, enrollmentToken: string, now: EpochMs): Promise<DeploymentRecord> {
  const deployment = await deploymentStore.get();
  if (deployment === undefined || deployment.saasActivation.status === 'active') throw new AppError('STATE_CONFLICT');
  const credentials = await secrets.readAppCredentials(deployment.ssmParameterName);
  // The webhook secret must belong to the App the record names; SSM holding another App's
  // credentials means the parameter was overwritten and activating would register a wrong secret.
  if (credentials.appId !== deployment.github.appId) throw new AppError('STATE_CONFLICT');
  try {
    if (runtime.config.startFunctionUrl === undefined) throw new AppError('INTERNAL');
    await saas.activate(runtime.config.deploymentId, enrollmentToken, activationRequest(runtime.config, deployment, credentials.webhookSecret));
  } catch (error) {
    await recordActivationFailure(deploymentStore, deployment, error, now);
    throw error;
  }
  const active = await deploymentStore.update(deployment, { activatedAt: now, saasActivation: { status: 'active', lastAttemptAt: now }, updatedAt: now });
  const session = sessionHash === undefined ? undefined : await runtime.store.getSession(sessionHash);
  if (session?.status === 'installed') await runtime.store.advanceSession(session, 'activated', { updatedAt: now });
  return active;
}
