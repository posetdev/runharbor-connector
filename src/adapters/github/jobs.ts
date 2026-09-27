import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import { requestGitHub, parseGitHubJson, type GitHubHttpDeps } from './http.js';
import type { WorkflowJob, WorkflowRun } from '../../ports/github.js';

const jobResponseSchema = z.object({
  id: z.union([z.number(), z.string()]),
  run_id: z.union([z.number(), z.string()]),
  run_attempt: z.number().int().min(1).optional(),
  status: z.string().min(1),
  conclusion: z.string().nullable(),
  labels: z.array(z.string()),
});

const runResponseSchema = z.object({
  id: z.union([z.number(), z.string()]),
  status: z.string().min(1),
  conclusion: z.string().nullable(),
  head_sha: z.string().min(1),
});

export async function getJob(owner: string, repo: string, jobId: string, token: string, deps: GitHubHttpDeps = {}): Promise<WorkflowJob> {
  const response = await requestGitHub(
    { method: 'GET', path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${encodeURIComponent(jobId)}`, authorization: `Bearer ${token}` },
    deps,
  );
  if (response.status === 404) throw new AppError('JOB_NOT_ELIGIBLE');
  if (response.status !== 200) throw new AppError('UPSTREAM_UNAVAILABLE');
  const parsed = jobResponseSchema.parse(parseGitHubJson(response.body));
  return {
    id: String(parsed.id),
    runId: String(parsed.run_id),
    runAttempt: parsed.run_attempt ?? 1,
    status: parsed.status,
    conclusion: parsed.conclusion,
    labels: parsed.labels,
  };
}

export async function getRun(owner: string, repo: string, runId: string, token: string, deps: GitHubHttpDeps = {}): Promise<WorkflowRun> {
  const response = await requestGitHub(
    { method: 'GET', path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}`, authorization: `Bearer ${token}` },
    deps,
  );
  if (response.status === 404) throw new AppError('JOB_NOT_ELIGIBLE');
  if (response.status !== 200) throw new AppError('UPSTREAM_UNAVAILABLE');
  const parsed = runResponseSchema.parse(parseGitHubJson(response.body));
  return { id: String(parsed.id), status: parsed.status, conclusion: parsed.conclusion, headSha: parsed.head_sha };
}
