import type { EpochMs } from '@runharbor/contracts';
import type { InstallerHandoff, InstallerTicket } from '../../domain/setup.js';
import { AppError } from '../../domain/errors.js';
import { ConditionalWriteError } from '../../ports/operation-store.js';
import type { SetupRuntime, SetupTicketPurpose } from './shared.js';
import { ACTIONS_TICKET_PURPOSE, SETUP_TICKET_PURPOSE, randomToken, secondsToTtl, sha256, verifySetupTicket } from './shared.js';

export const LOCAL_HANDOFF_SECONDS = 120;
export const ACTIONS_HANDOFF_SECONDS = 1_800;

export async function exchangeTicket(runtime: SetupRuntime, ticket: unknown, now: EpochMs): Promise<{ handoffCode: string; expiresInSeconds: 120 }> {
  return exchangeWithPurpose(runtime, ticket, now, SETUP_TICKET_PURPOSE, LOCAL_HANDOFF_SECONDS);
}

export async function exchangeActionsTicket(runtime: SetupRuntime, ticket: unknown, now: EpochMs): Promise<{ handoffCode: string; expiresInSeconds: 1800 }> {
  return exchangeWithPurpose(runtime, ticket, now, ACTIONS_TICKET_PURPOSE, ACTIONS_HANDOFF_SECONDS);
}

async function exchangeWithPurpose<Seconds extends 120 | 1800>(runtime: SetupRuntime, ticket: unknown, now: EpochMs, purpose: SetupTicketPurpose, expiresInSeconds: Seconds): Promise<{ handoffCode: string; expiresInSeconds: Seconds }> {
  const claims = verifySetupTicket(ticket, runtime.config.installerPublicKey, now, purpose);
  const handoffCode = randomToken(); const handoffTtlMs = (expiresInSeconds + 60) * 1_000;
  const handoff: InstallerHandoff = { pk: `HANDOFF#${sha256(handoffCode)}`, sk: '#', kind: 'installer_handoff', schema: 1, revision: 0, createdAt: now, updatedAt: now, ttl: secondsToTtl((now + handoffTtlMs) as EpochMs), jtiHash: sha256(claims.jti), enrollmentToken: claims.enrollmentToken, expiresAt: (now + expiresInSeconds * 1_000) as EpochMs };
  const consumed: InstallerTicket = { pk: `TICKET#${sha256(claims.jti)}`, sk: '#', kind: 'installer_ticket', schema: 1, revision: 0, createdAt: now, updatedAt: now, ttl: secondsToTtl((now + 5 * 60 * 1_000) as EpochMs) };
  try {
    // A jti that is already present means the signed ticket is being replayed.
    await runtime.store.consumeTicket(consumed);
    await runtime.store.createHandoff(handoff);
  } catch (error) {
    if (error instanceof ConditionalWriteError) throw new AppError('UNAUTHENTICATED');
    throw AppError.from(error);
  }
  return { handoffCode, expiresInSeconds };
}
