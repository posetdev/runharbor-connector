import { COMMAND_KEYS_PATH, commandKeysDocumentSchema, type CommandKeysDocument } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import { COMMAND_KEYS_CACHE_MAX_SECONDS, COMMAND_KEYS_CACHE_MIN_SECONDS, COMMAND_KEYS_FETCH_TIMEOUT_MS, COMMAND_KEYS_MAX_BYTES } from '../../domain/command-keys.js';
import type { CommandKeySource, LoadedCommandKeySet } from '../../ports/command-keys.js';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Fetches only `GET {saasOrigin}/.well-known/runharbor-command-keys.v1.json`.
 * HTTPS origin and path are pinned. The body must be a strict signed
 * `runharbor.command-keys.v1` document; signature verification against the
 * pinned keyset-root public key happens in acceptCommandKeySet before cache.
 * Response bodies and key material are never logged.
 */
export class HttpsCommandKeysClient implements CommandKeySource {
  private readonly url: URL;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(saasOrigin: string, fetchImpl: FetchLike = fetch, timeoutMs = COMMAND_KEYS_FETCH_TIMEOUT_MS) {
    this.url = pinnedCommandKeysUrl(saasOrigin);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async load(): Promise<LoadedCommandKeySet> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url.href, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppError('UPSTREAM_UNAVAILABLE');
    }
    if (response.url !== '' && !pinnedResponseUrl(response.url, this.url)) throw new AppError('UNAUTHENTICATED');
    if (response.status !== 200) throw new AppError('UPSTREAM_UNAVAILABLE');
    const contentType = response.headers.get('content-type');
    if (contentType !== null && !contentType.toLowerCase().startsWith('application/json')) throw new AppError('UNAUTHENTICATED');
    const raw = await readBoundedBody(response);
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(raw); } catch { throw new AppError('UNAUTHENTICATED'); }
    const parsed = commandKeysDocumentSchema.safeParse(parsedJson);
    if (!parsed.success) throw new AppError('UNAUTHENTICATED');
    return { document: parsed.data, cacheMaxAgeSeconds: cacheMaxAgeSeconds(response.headers.get('cache-control'), parsed.data) };
  }
}

export function pinnedCommandKeysUrl(saasOrigin: string): URL {
  let origin: URL;
  try { origin = new URL(saasOrigin); } catch { throw new AppError('INTERNAL'); }
  if (origin.protocol !== 'https:' || origin.username !== '' || origin.password !== '') throw new AppError('INTERNAL');
  if (origin.pathname !== '/' && origin.pathname !== '') throw new AppError('INTERNAL');
  const url = new URL(COMMAND_KEYS_PATH, `${origin.origin}/`);
  if (url.protocol !== 'https:' || url.pathname !== COMMAND_KEYS_PATH || url.search !== '' || url.hash !== '') throw new AppError('INTERNAL');
  return url;
}

function pinnedResponseUrl(responseUrl: string, expected: URL): boolean {
  try {
    const actual = new URL(responseUrl);
    return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && actual.search === '' && actual.hash === '';
  } catch {
    return false;
  }
}

function cacheMaxAgeSeconds(header: string | null, document: CommandKeysDocument): number {
  const fromHeader = parseCacheControlMaxAge(header);
  const candidate = fromHeader === undefined ? document.cacheMaxAgeSeconds : Math.min(fromHeader, document.cacheMaxAgeSeconds);
  return Math.min(Math.max(candidate, COMMAND_KEYS_CACHE_MIN_SECONDS), COMMAND_KEYS_CACHE_MAX_SECONDS);
}

export function parseCacheControlMaxAge(header: string | null): number | undefined {
  if (header === null || header === '') return undefined;
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)\s*(?:,|$)/i.exec(header);
  if (match === null) return undefined;
  return Number(match[1]);
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > COMMAND_KEYS_MAX_BYTES) throw new AppError('UNAUTHENTICATED');
  if (response.body === null) throw new AppError('UNAUTHENTICATED');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > COMMAND_KEYS_MAX_BYTES) throw new AppError('UNAUTHENTICATED');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof AppError ? error : new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
