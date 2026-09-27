import type { EpochMs } from '@runharbor/contracts';
import { acceptCommandKeySet, resolveActiveCommandKey, type AcceptedCommandKeySet } from '../domain/command-keys.js';
import { AppError } from '../domain/errors.js';
import type { CommandKeyResolver, CommandKeySource } from '../ports/command-keys.js';

type CachedSet = Readonly<{
  accepted: AcceptedCommandKeySet;
  expiresAt: EpochMs;
}>;

/**
 * Process-local keyset cache. A snapshot is stored only after the pinned
 * keyset-root public key verifies the document signature. After the TTL the
 * snapshot cannot verify commands; a refresh must succeed. Fetch or signature
 * failures after expiry fail closed and clear the cache.
 */
export class CommandKeyDirectory implements CommandKeyResolver {
  private cache: CachedSet | undefined;
  private inflight: Promise<AcceptedCommandKeySet> | undefined;

  constructor(
    private readonly source: CommandKeySource,
    private readonly rootPublicKey: string,
  ) {}

  async resolve(keyId: string, now: EpochMs): Promise<string> {
    const accepted = await this.snapshot(now);
    const publicKey = resolveActiveCommandKey(accepted.keys, keyId, now);
    if (publicKey === undefined) throw new AppError('UNAUTHENTICATED');
    return publicKey;
  }

  private async snapshot(now: EpochMs): Promise<AcceptedCommandKeySet> {
    if (this.cache !== undefined && now < this.cache.expiresAt) return this.cache.accepted;
    if (this.inflight !== undefined) return this.inflight;
    this.inflight = this.refresh(now);
    try {
      return await this.inflight;
    } finally {
      this.inflight = undefined;
    }
  }

  private async refresh(now: EpochMs): Promise<AcceptedCommandKeySet> {
    let loaded;
    try {
      loaded = await this.source.load();
    } catch (error) {
      this.cache = undefined;
      throw error instanceof AppError ? error : new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
    }
    let accepted: AcceptedCommandKeySet;
    try {
      accepted = acceptCommandKeySet(loaded.document, this.rootPublicKey, loaded.cacheMaxAgeSeconds);
    } catch (error) {
      this.cache = undefined;
      throw error instanceof AppError ? error : new AppError('UNAUTHENTICATED', { cause: error });
    }
    this.cache = { accepted, expiresAt: (now + accepted.cacheMaxAgeSeconds * 1000) as EpochMs };
    return accepted;
  }
}
