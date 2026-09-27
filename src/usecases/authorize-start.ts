import type { StartRequest } from '@runharbor/contracts';
import { AppError } from '../domain/errors.js';
import type { DeploymentStore } from '../ports/deployment-store.js';

export type StartImage = Readonly<{ maxDurationMs: number }>;
export type StartAuthorization = Readonly<{
  deploymentId: string; allowedInstanceTypes: readonly string[]; images: Readonly<Partial<Record<'x64' | 'arm64', StartImage>>>;
}>;

/**
 * 03 §C1 checks that precede startOperation: the request is for this deployment,
 * an image exists for its runner label architecture, and the job's installation
 * and repository belong to the deployment's allowed repositories.
 * Returns the image the start runs with.
 */
export async function authorizeStart(
  request: StartRequest,
  deployments: DeploymentStore,
  settings: StartAuthorization,
): Promise<StartImage> {
  if (request.deploymentId !== settings.deploymentId) throw new AppError('FORBIDDEN');
  if (!settings.allowedInstanceTypes.includes(request.instanceType)) {
    throw new AppError('FORBIDDEN', { publicReason: `instance type ${request.instanceType} is not allowed; allowed_instance_types: ${settings.allowedInstanceTypes.join(', ')}` });
  }
  const arch = request.runnerLabel.match(/^rh-(x64|arm64)-/)?.[1] as 'x64' | 'arm64' | undefined;
  const image = arch === undefined ? undefined : settings.images[arch];
  if (image === undefined) throw new AppError('FORBIDDEN');
  const deployment = await deployments.get();
  if (deployment === undefined || deployment.github.installationId !== request.job.githubInstallationId
    || !deployment.github.repositories.some((repository) => repository.id === request.job.repositoryId)) {
    throw new AppError('FORBIDDEN');
  }
  return image;
}
