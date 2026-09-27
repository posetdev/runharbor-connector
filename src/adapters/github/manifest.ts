import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import { requestGitHub, parseGitHubJson, type GitHubHttpDeps } from './http.js';
import type { GitHubOwnerType, ManifestConversion } from '../../ports/github.js';

const CODE = /^[A-Za-z0-9_-]{1,256}$/;

const manifestResponseSchema = z.object({
  id: z.union([z.number(), z.string()]),
  slug: z.string().min(1),
  pem: z.string().min(1),
  client_id: z.string().min(1),
  webhook_secret: z.string().min(1),
  owner: z.object({
    id: z.union([z.number(), z.string()]),
    login: z.string().min(1),
    type: z.enum(['User', 'Organization']),
  }),
});

export interface ExpectedManifestOwner {
  readonly login: string;
  readonly type: GitHubOwnerType;
  readonly id?: string;
}

/**
 * POST /app-manifests/{code}/conversions, unauthenticated per GitHub's spec.
 * Owner is verified three ways (login case-insensitively, type, and id when
 * known) against the customer-fixed expectation, never against request data.
 */
export async function convertManifestCode(code: string, expectedOwner: ExpectedManifestOwner, deps: GitHubHttpDeps = {}): Promise<ManifestConversion> {
  if (!CODE.test(code)) throw new AppError('BAD_REQUEST');
  const response = await requestGitHub({ method: 'POST', path: `/app-manifests/${encodeURIComponent(code)}/conversions` }, deps);
  if (response.status !== 201) throw new AppError('UPSTREAM_UNAVAILABLE');
  const manifest = manifestResponseSchema.parse(parseGitHubJson(response.body));
  const ownerId = String(manifest.owner.id);
  const ownerLogin = manifest.owner.login;
  const ownerType = manifest.owner.type;
  if (asciiLowercase(ownerLogin) !== asciiLowercase(expectedOwner.login)) throw new AppError('FORBIDDEN');
  if (ownerType !== expectedOwner.type) throw new AppError('FORBIDDEN');
  if (expectedOwner.id !== undefined && ownerId !== expectedOwner.id) throw new AppError('FORBIDDEN');
  return {
    appId: String(manifest.id),
    slug: manifest.slug,
    pem: manifest.pem,
    clientId: manifest.client_id,
    webhookSecret: manifest.webhook_secret,
    owner: { id: ownerId, login: ownerLogin, type: ownerType },
  };
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}
