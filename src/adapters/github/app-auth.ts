import { createPrivateKey, createSign } from 'node:crypto';
import { z } from 'zod';
import type { EpochMs } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import { requestGitHub, parseGitHubJson, type GitHubHttpDeps } from './http.js';
import { REQUIRED_INSTALLATION_PERMISSIONS, type InstallationAccessToken, type InstallationTokenRequest } from '../../ports/github.js';

const APP_JWT_LIFETIME_SECONDS = 9 * 60;
const APP_JWT_CLOCK_SKEW_SECONDS = 60;
const TOKEN_REFRESH_SKEW_MS = 60_000;

export { REQUIRED_INSTALLATION_PERMISSIONS };

/** RS256 App JWT per GitHub's documented 10-minute maximum lifetime. */
export function createAppJwt(pem: string, appId: string, now: EpochMs): string {
  let key;
  try {
    key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not an RSA key');
  } catch (error) {
    throw new AppError('INTERNAL', { cause: error });
  }
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iat: Math.floor(now / 1_000) - APP_JWT_CLOCK_SKEW_SECONDS,
    exp: Math.floor(now / 1_000) + APP_JWT_LIFETIME_SECONDS,
    iss: appId,
  });
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(key).toString('base64url')}`;
}

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Rejects an installation token whose granted permissions fall short of the required table. */
export function assertRequiredPermissions(granted: Readonly<Record<string, unknown>>): void {
  for (const [permission, level] of Object.entries(REQUIRED_INSTALLATION_PERMISSIONS)) {
    if (granted[permission] !== level) throw new AppError('FORBIDDEN');
  }
}

const installationTokenResponseSchema = z.object({
  token: z.string().min(1).max(8_192),
  expires_at: z.string().min(1),
  permissions: z.record(z.string(), z.string()),
});

export interface InstallationTokenCache {
  getInstallationAccessToken(request: InstallationTokenRequest): Promise<InstallationAccessToken>;
}

/** Caches the installation token until 60s before it expires (Issue #2 requirement). */
export function createInstallationTokenCache(deps: GitHubHttpDeps & { readonly now?: () => EpochMs } = {}): InstallationTokenCache {
  const now = deps.now ?? (() => Date.now() as EpochMs);
  let cached: { cacheKey: string; token: InstallationAccessToken } | undefined;
  let inflight: Promise<InstallationAccessToken> | undefined;

  async function fetchToken(request: InstallationTokenRequest): Promise<InstallationAccessToken> {
    const jwt = createAppJwt(request.pem, request.appId, now());
    const response = await requestGitHub(
      {
        method: 'POST',
        path: `/app/installations/${encodeURIComponent(request.installationId)}/access_tokens`,
        authorization: `Bearer ${jwt}`,
        body: { ...(request.repositories === undefined ? {} : { repositories: request.repositories }), permissions: request.permissions },
      },
      deps,
    );
    if (response.status !== 201) {
      throw new AppError('UPSTREAM_UNAVAILABLE', {
        // Deliberately retain only the phase and HTTP status: GitHub response bodies can contain sensitive detail.
        cause: { name: 'GitHubApiError', code: `installation_token_${response.status}` },
      });
    }
    const parsed = installationTokenResponseSchema.parse(parseGitHubJson(response.body));
    assertRequiredPermissions(parsed.permissions);
    const expiresAt = Date.parse(parsed.expires_at);
    if (!Number.isSafeInteger(expiresAt)) throw new AppError('UPSTREAM_UNAVAILABLE');
    return { token: parsed.token, expiresAt: expiresAt as EpochMs };
  }

  return {
    async getInstallationAccessToken(request: InstallationTokenRequest): Promise<InstallationAccessToken> {
      const cacheKey = JSON.stringify({
        installationId: request.installationId,
        repositories: request.repositories === undefined ? undefined : [...request.repositories].sort(),
        permissions: request.permissions,
      });
      const current = now();
      if (cached !== undefined && cached.cacheKey === cacheKey && cached.token.expiresAt > current + TOKEN_REFRESH_SKEW_MS) {
        return cached.token;
      }
      if (inflight === undefined) {
        inflight = fetchToken(request).finally(() => {
          inflight = undefined;
        });
      }
      const token = await inflight;
      cached = { cacheKey, token };
      return token;
    },
  };
}
