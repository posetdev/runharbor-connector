import type { EpochMs } from '@runharbor/contracts';
import type { InstallerSession } from '../../domain/setup.js';
import { AppError } from '../../domain/errors.js';
import { ConditionalWriteError } from '../../ports/operation-store.js';
import type { SetupRuntime } from './shared.js';
import { installerCookie, randomToken, secondsToTtl, sha256 } from './shared.js';

export async function consumeHandoff(runtime: SetupRuntime, code: string, now: EpochMs): Promise<{ cookie: string }> {
  let handoff;
  try {
    handoff = await runtime.store.consumeHandoff(sha256(code), now);
  } catch (error) {
    // Unknown, already consumed and expired are deliberately indistinguishable. Everything else is an
    // upstream failure: reporting it as a dead link would send the user to re-run setup over a blip.
    if (error instanceof ConditionalWriteError) throw new AppError('NOT_FOUND');
    throw AppError.from(error);
  }
  const token = randomToken(); const tokenHash = sha256(token);
  const installer: InstallerSession = { pk: `INSTALLER#${tokenHash}`, sk: '#', kind: 'installer_session', schema: 1, revision: 0, createdAt: now, updatedAt: now, ttl: secondsToTtl((now + 30 * 60 * 1_000) as EpochMs), jtiHash: handoff.jtiHash, enrollmentToken: handoff.enrollmentToken, expiresAt: (now + 30 * 60 * 1_000) as EpochMs };
  await runtime.store.createInstallerSession(installer);
  return { cookie: installerCookie(token) };
}
