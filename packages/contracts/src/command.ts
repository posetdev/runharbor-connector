import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  commandIdSchema,
  commandKeyIdSchema,
  deploymentIdSchema,
  epochMsSchema,
  gitRefSchema,
  githubIdSchema,
  idempotencyKeySchema,
  instanceTypeSchema,
  repositoryFullNameSchema,
  runnerLabelSchema,
} from './ids.js';
import { jobSchema } from './start.js';

export const COMMAND_ENVELOPE_VERSION = 'runharbor.command.v1';
export const commandTypeSchema = z.enum(['start_runner', 'dispatch_workflow']);
export type CommandType = z.infer<typeof commandTypeSchema>;

export const startRunnerPayloadSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  runnerLabel: runnerLabelSchema,
  instanceType: instanceTypeSchema,
  job: jobSchema,
}).strict();
export type StartRunnerPayload = z.infer<typeof startRunnerPayloadSchema>;

export const dispatchWorkflowPayloadSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  target: z.object({
    repositoryId: githubIdSchema,
    repositoryFullName: repositoryFullNameSchema,
  }).strict(),
  source: z.object({
    repositoryFullName: repositoryFullNameSchema,
    ref: gitRefSchema,
    after: z.string().regex(/^[0-9a-f]{40}$/i),
  }).strict(),
}).strict();
export type DispatchWorkflowPayload = z.infer<typeof dispatchWorkflowPayloadSchema>;

export const commandEnvelopeSchema = z.object({
  version: z.literal(COMMAND_ENVELOPE_VERSION),
  keyId: commandKeyIdSchema,
  commandId: commandIdSchema,
  deploymentId: deploymentIdSchema,
  issuedAt: epochMsSchema,
  expiresAt: epochMsSchema,
  type: commandTypeSchema,
  payload: z.record(z.unknown()),
  signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export type UnsignedCommandEnvelope = Omit<CommandEnvelope, 'signature'>;

/**
 * Custom deterministic JSON serialization.
 */
export function serializeCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${serializeCanonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/**
 * Canonical bytes over which the Ed25519 detached signature is computed.
 */
export function canonicalCommandBytes(envelope: {
  version: string;
  keyId: string;
  commandId: string;
  deploymentId: string;
  issuedAt: number;
  expiresAt: number;
  type: string;
  payload: unknown;
}): Buffer {
  const canonical = serializeCanonicalJson({
    commandId: envelope.commandId,
    deploymentId: envelope.deploymentId,
    expiresAt: envelope.expiresAt,
    issuedAt: envelope.issuedAt,
    keyId: envelope.keyId,
    payload: envelope.payload,
    type: envelope.type,
    version: envelope.version,
  });
  return Buffer.from(canonical, 'utf8');
}

/**
 * Parses an Ed25519 public key in Base64 SPKI DER format, PEM format, or KeyObject.
 */
export function parseEd25519PublicKey(key: KeyObject | string | Buffer): KeyObject {
  if (typeof key === 'object' && 'type' in key && key.type === 'public') {
    return requireEd25519Public(key as KeyObject);
  }
  if (Buffer.isBuffer(key)) {
    return requireEd25519Public(createPublicKey({ key, format: 'der', type: 'spki' }));
  }
  if (typeof key === 'string') {
    if (key.startsWith('-----BEGIN')) {
      return requireEd25519Public(createPublicKey(key));
    }
    return requireEd25519Public(createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }));
  }
  throw new Error('invalid public key');
}

function requireEd25519Public(key: KeyObject): KeyObject {
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') throw new Error('invalid public key');
  return key;
}

/**
 * Signs a command envelope with an Ed25519 private key, producing detached signature in base64url.
 */
export function signCommandEnvelope(
  envelope: UnsignedCommandEnvelope,
  privateKey: Parameters<typeof sign>[2],
): CommandEnvelope {
  const bytes = canonicalCommandBytes(envelope);
  const signature = sign(null, bytes, privateKey).toString('base64url');
  return {
    ...envelope,
    signature,
  };
}

/**
 * Verifies an Ed25519 detached signature over canonical bytes.
 */
export function verifyCommandSignature(
  envelope: CommandEnvelope,
  publicKey: KeyObject | string | Buffer,
): boolean {
  try {
    const key = parseEd25519PublicKey(publicKey);
    const bytes = canonicalCommandBytes(envelope);
    return verify(null, bytes, key, Buffer.from(envelope.signature, 'base64url'));
  } catch {
    return false;
  }
}
