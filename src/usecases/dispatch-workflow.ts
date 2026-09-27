import type { WorkflowDispatchRequest, WorkflowDispatchResponse } from '@runharbor/contracts';
import { AppError } from '../domain/errors.js';
import { REQUIRED_INSTALLATION_PERMISSIONS, type GitHubPort } from '../ports/github.js';
import type { DeploymentStore } from '../ports/deployment-store.js';
import type { SecretsPort } from '../ports/secrets.js';

export type WorkflowDispatchSettings = Readonly<{
  deploymentId: string;
  githubAppParameterName: string;
  giteeWorkflow?: { workflowFile: string; ref: string } | null;
}>;

/** SaaS sends the authenticated user's stored binding; customer-held credentials execute it without leaving AWS. */
export async function dispatchWorkflow(
  request: WorkflowDispatchRequest,
  deployments: DeploymentStore,
  github: GitHubPort,
  secrets: SecretsPort,
  settings: WorkflowDispatchSettings,
): Promise<WorkflowDispatchResponse> {
  if (request.deploymentId !== settings.deploymentId) throw new AppError('FORBIDDEN');
  if (!settings.giteeWorkflow) throw new AppError('FORBIDDEN', { publicReason: 'Gitee workflow is not configured' });
  const configuredWorkflow = settings.giteeWorkflow;
  const deployment = await deployments.get();
  const repository = deployment?.github.repositories.find((item) => item.id === request.target.repositoryId && item.fullName === request.target.repositoryFullName);
  if (deployment === undefined || repository === undefined) throw new AppError('FORBIDDEN');
  const [owner, repo] = repository.fullName.split('/');
  if (owner === undefined || repo === undefined) throw new AppError('FORBIDDEN');
  const credentials = await secrets.readAppCredentials(settings.githubAppParameterName);
  const token = await github.installationToken({ appId: credentials.appId, pem: credentials.pem, installationId: deployment.github.installationId, repositories: [repo], permissions: REQUIRED_INSTALLATION_PERMISSIONS });
  const workflowRunId = await github.dispatchWorkflow(owner, repo, configuredWorkflow.workflowFile, configuredWorkflow.ref, {
    gitee_repository: request.source.repositoryFullName, gitee_ref: request.source.ref, gitee_after: request.source.after, runharbor_delivery: request.idempotencyKey,
  }, token.token);
  return { apiVersion: 'runharbor.workflow-dispatch.v2', idempotencyKey: request.idempotencyKey, ...(workflowRunId === undefined ? {} : { workflowRunId }) };
}
