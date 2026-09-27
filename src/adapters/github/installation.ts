import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import { requestGitHub, parseGitHubJson, type GitHubHttpDeps } from './http.js';
import type { GitHubInstallation, GitHubRepository } from '../../ports/github.js';

const installationResponseSchema = z.object({
  id: z.union([z.number(), z.string()]),
  app_id: z.union([z.number(), z.string()]),
  account: z.object({
    id: z.union([z.number(), z.string()]),
    login: z.string().min(1),
    type: z.enum(['User', 'Organization']),
  }),
  repository_selection: z.enum(['all', 'selected']),
});

/** GET /app/installations/{installation_id}, authenticated with the App JWT. */
export async function getInstallation(installationId: string, jwt: string, deps: GitHubHttpDeps = {}): Promise<GitHubInstallation> {
  const response = await requestGitHub(
    { method: 'GET', path: `/app/installations/${encodeURIComponent(installationId)}`, authorization: `Bearer ${jwt}` },
    deps,
  );
  if (response.status === 404) throw new AppError('NOT_FOUND');
  if (response.status !== 200) throw new AppError('UPSTREAM_UNAVAILABLE');
  const parsed = installationResponseSchema.parse(parseGitHubJson(response.body));
  return {
    id: String(parsed.id),
    appId: String(parsed.app_id),
    account: { id: String(parsed.account.id), login: parsed.account.login, type: parsed.account.type },
    repositorySelection: parsed.repository_selection,
  };
}

const repositoriesResponseSchema = z.object({
  total_count: z.number().int().min(0),
  repositories: z.array(z.object({ id: z.union([z.number(), z.string()]), full_name: z.string().min(1) })),
});

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/** GET /installation/repositories, authenticated with the installation access token. */
export async function listInstallationRepos(token: string, deps: GitHubHttpDeps = {}): Promise<readonly GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await requestGitHub(
      { method: 'GET', path: `/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`, authorization: `Bearer ${token}` },
      deps,
    );
    if (response.status !== 200) {
      throw new AppError('UPSTREAM_UNAVAILABLE', {
        // Keep diagnostics safe for CloudWatch: do not log GitHub response bodies or credentials.
        cause: { name: 'GitHubApiError', code: `installation_repositories_${response.status}` },
      });
    }
    const parsed = repositoriesResponseSchema.parse(parseGitHubJson(response.body));
    for (const repo of parsed.repositories) repositories.push({ id: String(repo.id), fullName: repo.full_name });
    if (parsed.repositories.length < PAGE_SIZE || repositories.length >= parsed.total_count) break;
  }
  return repositories;
}
