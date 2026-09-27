import {
  commandEnvelopeSchema,
  dispatchWorkflowPayloadSchema,
  startRunnerPayloadSchema,
  verifyCommandSignature,
  type CommandEnvelope,
  type DispatchWorkflowPayload,
  type EpochMs,
  type StartRunnerPayload,
} from '@runharbor/contracts';
import { AppError } from '../domain/errors.js';
import type { CommandKeyResolver } from '../ports/command-keys.js';
import type { CommandStore } from '../ports/command-store.js';
import { ConditionalWriteError } from '../ports/operation-store.js';

export const MAX_CLOCK_SKEW_MS = 60_000;

export interface VerifyCommandSettings {
  readonly deploymentId: string;
}

export type VerifiedCommand =
  | { readonly type: 'start_runner'; readonly envelope: CommandEnvelope; readonly payload: StartRunnerPayload }
  | { readonly type: 'dispatch_workflow'; readonly envelope: CommandEnvelope; readonly payload: DispatchWorkflowPayload };

/**
 * Verifies a SaaS-signed CommandEnvelope before any side effects.
 * Key material comes from a root-signed discovered keyset: exact keyId match,
 * currently valid keys only, no built-in fallback. The pinned saasPublicKey is
 * the keyset-root verifier, not a command-signing key.
 */
export async function verifySignedCommand(
  rawBody: unknown,
  store: CommandStore,
  keys: CommandKeyResolver,
  settings: VerifyCommandSettings,
  now: EpochMs,
): Promise<VerifiedCommand> {
  const parsedEnvelope = commandEnvelopeSchema.safeParse(rawBody);
  if (!parsedEnvelope.success) throw new AppError('BAD_REQUEST');
  const envelope = parsedEnvelope.data;

  if (envelope.deploymentId !== settings.deploymentId) throw new AppError('FORBIDDEN');
  if (envelope.expiresAt <= now) throw new AppError('TOKEN_EXPIRED');
  if (envelope.issuedAt > now + MAX_CLOCK_SKEW_MS) throw new AppError('BAD_REQUEST');
  if (envelope.expiresAt <= envelope.issuedAt) throw new AppError('BAD_REQUEST');

  const publicKey = await keys.resolve(envelope.keyId, now);
  if (!verifyCommandSignature(envelope, publicKey)) throw new AppError('INVALID_SIGNATURE');

  let payload: StartRunnerPayload | DispatchWorkflowPayload;
  if (envelope.type === 'start_runner') {
    const parsedPayload = startRunnerPayloadSchema.safeParse(envelope.payload);
    if (!parsedPayload.success) throw new AppError('BAD_REQUEST');
    payload = parsedPayload.data;
  } else if (envelope.type === 'dispatch_workflow') {
    const parsedPayload = dispatchWorkflowPayloadSchema.safeParse(envelope.payload);
    if (!parsedPayload.success) throw new AppError('BAD_REQUEST');
    payload = parsedPayload.data;
  } else {
    throw new AppError('BAD_REQUEST');
  }

  try {
    await store.recordCommand({
      pk: `CMD#${envelope.commandId}`,
      sk: '#',
      kind: 'command',
      schema: 1,
      commandId: envelope.commandId,
      deploymentId: envelope.deploymentId,
      type: envelope.type,
      createdAt: now,
      ttl: Math.ceil(envelope.expiresAt / 1_000),
    });
  } catch (error) {
    if (error instanceof ConditionalWriteError) throw new AppError('UNAUTHENTICATED');
    throw error;
  }

  if (envelope.type === 'start_runner') {
    return { type: 'start_runner', envelope, payload: payload as StartRunnerPayload };
  }
  return { type: 'dispatch_workflow', envelope, payload: payload as DispatchWorkflowPayload };
}
