import { sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { parseEd25519PublicKey, serializeCanonicalJson } from './command.js';
import { commandKeyIdSchema, epochMsSchema } from './ids.js';

export const COMMAND_KEYS_API_VERSION = 'runharbor.command-keys.v1';
export const COMMAND_KEYS_PATH = '/.well-known/runharbor-command-keys.v1.json';
export const COMMAND_ALGORITHM = 'Ed25519';

const publicKeySpkiSchema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(44).max(88).superRefine((value, context) => {
  try { parseEd25519PublicKey(value); } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'not an Ed25519 SPKI public key' });
  }
});

const detachedSignatureSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const commandKeyRecordSchema = z.object({
  keyId: commandKeyIdSchema,
  algorithm: z.literal(COMMAND_ALGORITHM),
  publicKey: publicKeySpkiSchema,
  notBefore: epochMsSchema,
  notAfter: epochMsSchema,
}).strict().superRefine((value, context) => {
  if (value.notAfter <= value.notBefore) context.addIssue({ code: z.ZodIssueCode.custom, path: ['notAfter'], message: 'notAfter must be after notBefore' });
});
export type CommandKeyRecord = z.infer<typeof commandKeyRecordSchema>;

export const commandKeysDocumentSchema = z.object({
  apiVersion: z.literal(COMMAND_KEYS_API_VERSION),
  cacheMaxAgeSeconds: z.number().int().min(60).max(86_400),
  keys: z.array(commandKeyRecordSchema).min(1).max(8),
  rootKeyId: commandKeyIdSchema,
  signature: detachedSignatureSchema,
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  for (const [index, key] of value.keys.entries()) {
    if (seen.has(key.keyId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['keys', index, 'keyId'], message: 'keyId must be unique' });
    seen.add(key.keyId);
    if (key.keyId === value.rootKeyId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['keys', index, 'keyId'], message: 'rootKeyId must not be a command key' });
    }
  }
});
export type CommandKeysDocument = z.infer<typeof commandKeysDocumentSchema>;
export type UnsignedCommandKeysDocument = Omit<CommandKeysDocument, 'signature'>;

export const saasPublicKeySchema = publicKeySpkiSchema;

/**
 * Canonical bytes for the keyset-root Ed25519 detached signature.
 * Covers every security-relevant field; `signature` is excluded.
 * Object keys are sorted; array order is preserved. Same serializer as commands.
 */
export function canonicalCommandKeysBytes(document: {
  apiVersion: string;
  cacheMaxAgeSeconds: number;
  keys: readonly CommandKeyRecord[];
  rootKeyId: string;
}): Buffer {
  return Buffer.from(serializeCanonicalJson({
    apiVersion: document.apiVersion,
    cacheMaxAgeSeconds: document.cacheMaxAgeSeconds,
    keys: document.keys,
    rootKeyId: document.rootKeyId,
  }), 'utf8');
}

export function signCommandKeysDocument(
  document: UnsignedCommandKeysDocument,
  privateKey: Parameters<typeof sign>[2],
): CommandKeysDocument {
  const signature = sign(null, canonicalCommandKeysBytes(document), privateKey).toString('base64url');
  return { ...document, signature };
}

export function verifyCommandKeysSignature(
  document: CommandKeysDocument,
  publicKey: KeyObject | string | Buffer,
): boolean {
  try {
    const key = parseEd25519PublicKey(publicKey);
    const signature = Buffer.from(document.signature, 'base64url');
    if (signature.length !== 64) return false;
    return verify(null, canonicalCommandKeysBytes(document), key, signature);
  } catch {
    return false;
  }
}
