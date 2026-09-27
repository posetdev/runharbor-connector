import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import { requestGitHub, parseGitHubJson, type GitHubHttpDeps } from './http.js';

const DEFAULT_RUNNER_GROUP_ID = 1;
const DEFAULT_WORK_FOLDER = '_work';

const jitConfigResponseSchema = z.object({
  runner: z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string().min(1),
    labels: z.array(z.object({ name: z.string().min(1) })),
  }),
  encoded_jit_config: z.string().min(1),
});

/** POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig → encodedJitConfig. */
export async function generateJitConfig(
  owner: string,
  repo: string,
  runnerName: string,
  labels: readonly string[],
  token: string,
  deps: GitHubHttpDeps = {},
): Promise<string> {
  const response = await requestGitHub(
    {
      method: 'POST',
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runners/generate-jitconfig`,
      authorization: `Bearer ${token}`,
      body: { name: runnerName, runner_group_id: DEFAULT_RUNNER_GROUP_ID, labels, work_folder: DEFAULT_WORK_FOLDER },
    },
    deps,
  );
  // 404/409/422 will not change on retry (repository gone, runner name taken, request rejected).
  if (response.status === 404 || response.status === 409 || response.status === 422) throw new AppError('JOB_NOT_ELIGIBLE');
  if (response.status !== 201) throw new AppError('UPSTREAM_UNAVAILABLE');
  const parsed = jitConfigResponseSchema.parse(parseGitHubJson(response.body));
  if (parsed.runner.name !== runnerName) throw new AppError('UPSTREAM_UNAVAILABLE');
  const grantedLabels = parsed.runner.labels.map((label) => label.name);
  if (!labels.every((label) => grantedLabels.includes(label))) throw new AppError('UPSTREAM_UNAVAILABLE');
  return parsed.encoded_jit_config;
}

const workflowDispatchResponseSchema = z.object({ workflow_run_id: z.union([z.number(), z.string()]).optional() });

/** Dispatches the customer-configured workflow. Inputs contain only normalized Gitee push metadata. */
export async function dispatchWorkflow(
  owner: string,
  repo: string,
  workflowFile: string,
  ref: string,
  inputs: Readonly<Record<string, string>>,
  token: string,
  deps: GitHubHttpDeps = {},
): Promise<string | undefined> {
  const response = await requestGitHub({
    method: 'POST', path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
    authorization: `Bearer ${token}`, body: { ref, inputs },
  }, deps);
  if (response.status === 404 || response.status === 422) throw new AppError('FORBIDDEN');
  if (response.status !== 200 && response.status !== 204) throw new AppError('UPSTREAM_UNAVAILABLE');
  if (response.status === 204) return undefined;
  const parsed = workflowDispatchResponseSchema.safeParse(parseGitHubJson(response.body));
  if (!parsed.success) throw new AppError('UPSTREAM_UNAVAILABLE');
  return parsed.data.workflow_run_id === undefined ? undefined : String(parsed.data.workflow_run_id);
}
