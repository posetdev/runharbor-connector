import type { EpochMs } from '@runharbor/contracts';

/**
 * Provisional port: R2 (domain/ports/dynamodb) had not merged into this branch
 * when this file was written. Signatures follow 05-code-structure.md §1.1;
 * reconcile with R2's ports/github.ts on merge.
 */

export type GitHubOwnerType = 'User' | 'Organization';

export interface GitHubOwner {
  readonly id: string;
  readonly login: string;
  readonly type: GitHubOwnerType;
}

export interface GitHubRepository {
  readonly id: string;
  readonly fullName: string;
}

export interface InstallationAccessToken {
  readonly token: string;
  readonly expiresAt: EpochMs;
}

export interface WorkflowJob {
  readonly id: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly status: string;
  readonly conclusion: string | null;
  readonly labels: readonly string[];
}

export interface WorkflowRun {
  readonly id: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly headSha: string;
}

export interface GitHubInstallation {
  readonly id: string;
  readonly appId: string;
  readonly account: GitHubOwner;
  /** GitHub's immutable installation-wide repository grant, not a count we infer from listing pages. */
  readonly repositorySelection: 'all' | 'selected';
}

export interface ManifestConversion {
  readonly appId: string;
  readonly slug: string;
  readonly pem: string;
  readonly clientId: string;
  readonly webhookSecret: string;
  readonly owner: GitHubOwner;
}

export interface InstallationTokenRequest {
  readonly appId: string;
  readonly pem: string;
  readonly installationId: string;
  /** Omit to request the whole installed repository scope; a present list narrows the token. */
  readonly repositories?: readonly string[];
  readonly permissions: Readonly<Record<string, 'read' | 'write'>>;
}

/** The one permission table an installation token is ever requested with (01 §4). */
export const REQUIRED_INSTALLATION_PERMISSIONS: Readonly<Record<string, 'read' | 'write'>> = Object.freeze({
  actions: 'write',
  administration: 'write',
  metadata: 'read',
});

export interface GitHubPort {
  installationToken(request: InstallationTokenRequest): Promise<InstallationAccessToken>;
  getJob(owner: string, repo: string, jobId: string, token: string): Promise<WorkflowJob>;
  getRun(owner: string, repo: string, runId: string, token: string): Promise<WorkflowRun>;
  generateJitConfig(owner: string, repo: string, runnerName: string, labels: readonly string[], token: string): Promise<string>;
  dispatchWorkflow(owner: string, repo: string, workflowFile: string, ref: string, inputs: Readonly<Record<string, string>>, token: string): Promise<string | undefined>;
  convertManifest(code: string): Promise<ManifestConversion>;
  getInstallation(installationId: string, jwt: string): Promise<GitHubInstallation>;
  listInstallationRepos(token: string): Promise<readonly GitHubRepository[]>;
}
