import { AppError } from '../../domain/errors.js';

export type FetchLike = typeof fetch;

export interface GitHubHttpDeps {
  readonly fetch?: FetchLike;
  /** Overridable only for tests; production always uses the 10s default. */
  readonly timeoutMs?: number;
}

export interface GitHubRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly authorization?: string;
  readonly body?: unknown;
}

export interface GitHubResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const USER_AGENT = 'runharbor-connector';

/** The single fetch wrapper every github/*.ts adapter goes through (05 §1.1). */
export async function requestGitHub(request: GitHubRequest, deps: GitHubHttpDeps = {}): Promise<GitHubResponse> {
  const fetchImpl = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
    if (request.authorization !== undefined) headers.Authorization = request.authorization;
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchImpl(`${GITHUB_API_ORIGIN}${request.path}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      throw new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
    }
    const body = await readBoundedBody(response, controller.signal);
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new AppError('UPSTREAM_UNAVAILABLE');
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new AppError('UPSTREAM_UNAVAILABLE');
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof AppError ? error : new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * The one retained JSON pre-scan (05 §4): reject integer literals outside
 * Number.MAX_SAFE_INTEGER before JSON.parse, then parse. Callers apply zod
 * on the result. GitHub numeric ids must otherwise be read back as strings.
 */
export function parseGitHubJson(body: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  assertSafeIntegers(text);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
  }
}

function assertSafeIntegers(text: string): void {
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      index = skipString(text, index) + 1;
      continue;
    }
    if (char === '-' || isDigit(char)) {
      const start = index;
      if (char === '-') index += 1;
      while (isDigit(text[index])) index += 1;
      if (text[index] === '.') {
        index += 1;
        while (isDigit(text[index])) index += 1;
      }
      if (text[index] === 'e' || text[index] === 'E') {
        index += 1;
        if (text[index] === '+' || text[index] === '-') index += 1;
        while (isDigit(text[index])) index += 1;
      }
      const token = text.slice(start, index);
      if (/^-?(?:0|[1-9]\d*)$/.test(token)) {
        const value = BigInt(token);
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
          throw new AppError('UPSTREAM_UNAVAILABLE');
        }
      }
      continue;
    }
    index += 1;
  }
}

function skipString(text: string, openingQuote: number): number {
  let index = openingQuote + 1;
  while (index < text.length) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '"') return index;
    index += 1;
  }
  return text.length;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}
