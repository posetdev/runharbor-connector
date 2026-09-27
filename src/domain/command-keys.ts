import { timingSafeEqual } from 'node:crypto';
import { commandKeysDocumentSchema, parseEd25519PublicKey, verifyCommandKeysSignature, type CommandKeyRecord, type CommandKeysDocument, type EpochMs } from '@runharbor/contracts';
import { AppError } from './errors.js';

export const COMMAND_KEYS_CACHE_MIN_SECONDS = 60;
export const COMMAND_KEYS_CACHE_MAX_SECONDS = 86_400;
export const COMMAND_KEYS_FETCH_TIMEOUT_MS = 3_000;
export const COMMAND_KEYS_MAX_BYTES = 8_192;

export type AcceptedCommandKeySet = Readonly<{
  keys: readonly CommandKeyRecord[];
  cacheMaxAgeSeconds: number;
}>;

/**
 * Accepts a discovered keyset only when the customer-pinned keyset-root public
 * key verifies the detached Ed25519 signature. The root is not a command key:
 * command keys in the signed document may overlap, rotate, or retire. TLS
 * origin pinning is transport protection only; this check is the trust anchor.
 * Signature verification happens before the caller may cache or use any key.
 */
export function acceptCommandKeySet(
  document: CommandKeysDocument,
  rootPublicKey: string,
  cacheMaxAgeSeconds: number,
): AcceptedCommandKeySet {
  const parsed = commandKeysDocumentSchema.safeParse(document);
  if (!parsed.success) throw new AppError('UNAUTHENTICATED');
  if (parsed.data.keys.some((key) => publicKeysEqual(key.publicKey, rootPublicKey))) {
    throw new AppError('UNAUTHENTICATED');
  }
  if (!verifyCommandKeysSignature(parsed.data, rootPublicKey)) {
    throw new AppError('UNAUTHENTICATED');
  }
  return {
    keys: parsed.data.keys,
    cacheMaxAgeSeconds: clampCacheMaxAgeSeconds(cacheMaxAgeSeconds, parsed.data.cacheMaxAgeSeconds),
  };
}

export function resolveActiveCommandKey(keys: readonly CommandKeyRecord[], keyId: string, now: EpochMs): string | undefined {
  const key = keys.find((item) => item.keyId === keyId);
  if (key === undefined) return undefined;
  if (now < key.notBefore || now >= key.notAfter) return undefined;
  try { parseEd25519PublicKey(key.publicKey); } catch { return undefined; }
  return key.publicKey;
}

export function clampCacheMaxAgeSeconds(headerOrConfig: number, documentValue: number): number {
  const bounded = Math.min(headerOrConfig, documentValue, COMMAND_KEYS_CACHE_MAX_SECONDS);
  return Math.max(COMMAND_KEYS_CACHE_MIN_SECONDS, bounded);
}

export function publicKeysEqual(left: string, right: string): boolean {
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(left, 'base64');
    b = Buffer.from(right, 'base64');
    parseEd25519PublicKey(a);
    parseEd25519PublicKey(b);
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
