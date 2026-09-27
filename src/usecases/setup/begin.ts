import type { EpochMs } from '@runharbor/contracts';
import { deterministicGitHubAppName, gitHubAppNameSchema } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import type { SetupSession } from '../../domain/setup.js';
import type { SetupRuntime } from './shared.js';
import { randomToken, secondsToTtl, sha256 } from './shared.js';

export async function beginSetup(
  runtime: SetupRuntime,
  installerHash: string,
  setupUrl: string,
  now: EpochMs,
  customAppName?: string,
): Promise<{ state: string; manifest: string; appName: string }> {
  const state = randomToken(); const stateHash = sha256(state);
  const session: SetupSession = { pk: `SETUP#${stateHash}`, sk: '#', kind: 'setup_session', schema: 1, revision: 0, createdAt: now, updatedAt: now, ttl: secondsToTtl((now + 60 * 60 * 1_000) as EpochMs), status: 'pending', installerSessionHash: installerHash, browserStartedAt: now };
  await runtime.store.createSession(session);
  const orgLogin = runtime.config.githubAppOrganization.login;
  let appName: string;
  if (customAppName !== undefined && customAppName.trim() !== '') {
    const parsed = gitHubAppNameSchema.safeParse(customAppName);
    if (!parsed.success) throw new AppError('BAD_REQUEST');
    appName = parsed.data;
  } else {
    appName = deterministicGitHubAppName(orgLogin);
  }
  return {
    state,
    appName,
    manifest: JSON.stringify({
      name: appName,
      url: runtime.config.webhookUrl,
      hook_attributes: { url: runtime.config.webhookUrl },
      redirect_url: `${setupUrl}/github/app-created`,
      setup_url: `${setupUrl}/github/installed`,
      default_permissions: { actions: 'write', administration: 'write', metadata: 'read' },
      default_events: ['workflow_job'],
    }),
  };
}
