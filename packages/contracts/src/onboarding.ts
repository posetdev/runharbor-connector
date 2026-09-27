import { createHash } from 'node:crypto';
import { z } from 'zod';
import { deploymentFileSchema } from './deployment-file.js';
import { deploymentIdSchema, epochMsSchema, functionUrlSchema } from './ids.js';

/** Maximum length of a GitHub App name per GitHub constraints. */
export const GITHUB_APP_NAME_MAX_LENGTH = 34;

/**
 * Validates a GitHub App display name.
 * - 1 to 34 characters
 * - Alphanumeric, spaces, hyphens, underscores, dots, and parentheses
 * - Must start with alphanumeric or '('
 * - Cannot be the globally reserved name "RunHarbor" (case-insensitive)
 */
export const gitHubAppNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(GITHUB_APP_NAME_MAX_LENGTH)
  .regex(/^[A-Za-z0-9(][A-Za-z0-9 _().-]{0,32}[A-Za-z0-9)]?$/)
  .refine((val) => val.toLowerCase() !== 'runharbor', {
    message: 'GitHub App name "RunHarbor" is globally reserved',
  });

/**
 * Generates a deterministic, human-readable, collision-resistant GitHub App
 * name from the verified GitHub organization login, respecting GitHub's
 * 34-character limit.
 *
 * Example:
 * - "acme" -> "RunHarbor (acme)"
 * - long org logins -> "RunHarbor (<trimmed>-<hash>)" (max 34 characters)
 */
export function deterministicGitHubAppName(organizationLogin: string): string {
  const cleanOrg = organizationLogin.trim();
  if (cleanOrg === '') throw new Error('Organization login must not be empty');
  const prefix = 'RunHarbor (';
  const suffix = ')';
  const overhead = prefix.length + suffix.length; // 12
  const maxOrgLen = GITHUB_APP_NAME_MAX_LENGTH - overhead; // 22

  if (cleanOrg.length <= maxOrgLen) {
    return `${prefix}${cleanOrg}${suffix}`;
  }

  const hash = createHash('sha256').update(cleanOrg.toLowerCase()).digest('hex').slice(0, 6);
  const trimmed = cleanOrg.slice(0, 15).replace(/-+$/, '');
  return `${prefix}${trimmed}-${hash}${suffix}`;
}


/** Audience the customer deploy workflow must request on its GitHub OIDC token. */
export const ONBOARDING_OIDC_AUDIENCE = 'runharbor-saas:onboarding';

/** Fixed SaaS origin. Customer workflows must not take a callback URL input. */
export const ONBOARDING_SAAS_ORIGIN = 'https://runharbor.poset.dev';

export function onboardingConfigPath(deploymentId: string): string {
  return `/api/v1/onboarding/deployments/${deploymentIdSchema.parse(deploymentId)}/configuration`;
}

export function onboardingConfigUrl(deploymentId: string, origin = ONBOARDING_SAAS_ORIGIN): string {
  return new URL(onboardingConfigPath(deploymentId), origin).href;
}

/** SaaS returns the same deployment.json shape the local CLI consumes (C5). */
export const onboardingConfigResponseSchema = deploymentFileSchema;

export function onboardingContinuationUrl(deploymentId: string, origin = ONBOARDING_SAAS_ORIGIN): string {
  const id = deploymentIdSchema.parse(deploymentId);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('SaaS origin must be https without credentials');
  return `${url.origin}/deployments/${id}/setup/activate`;
}

/** One-time Connector setup capability published to SaaS after Actions apply. */
export const setupHandoffCapabilitySchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
export const publishSetupHandoffRequestSchema = z.object({ setupOrigin: functionUrlSchema, capability: setupHandoffCapabilitySchema }).strict();
export const publishSetupHandoffResponseSchema = z.object({ expiresAt: epochMsSchema }).strict();

export function onboardingSetupHandoffPath(deploymentId: string): string {
  return `/api/v1/onboarding/deployments/${deploymentIdSchema.parse(deploymentId)}/setup-handoff`;
}

export function onboardingSetupHandoffUrl(deploymentId: string, origin = ONBOARDING_SAAS_ORIGIN): string {
  const id = deploymentIdSchema.parse(deploymentId);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('SaaS origin must be https without credentials');
  return `${url.origin}/api/v1/onboarding/deployments/${id}/setup-handoff`;
}
