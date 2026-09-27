import type { DeploymentStore } from '../../ports/deployment-store.js';
import type { OperationStore } from '../../ports/operation-store.js';
export async function setupStatus(deployments: DeploymentStore, operations: OperationStore): Promise<unknown> {
  const deployment = await deployments.get();
  const recent = await operations.listRecent(1);
  return { deploymentId: deployment?.deploymentId, github: deployment === undefined ? undefined : { appId: deployment.github.appId, appSlug: deployment.github.appSlug, installationId: deployment.github.installationId, owner: deployment.github.owner, repositories: deployment.github.repositories }, activated: deployment?.saasActivation.status === 'active', operation: recent[0] };
}
