#!/usr/bin/env node
/**
 * Fetches scoped Connector deployment configuration from SaaS using a GitHub
 * Actions OIDC token (audience runharbor-saas:onboarding), and publishes the
 * post-apply setup Function URL plus one-time capability. Never prints the
 * request, response, enrollment token, origin, or capability.
 */
import fs from 'node:fs';
import path from 'node:path';

export const ONBOARDING_OIDC_AUDIENCE = 'runharbor-saas:onboarding';
export const ONBOARDING_SAAS_ORIGIN = 'https://runharbor.poset.dev';
const deploymentIdPattern = /^dep_[0-9a-f]{24}$/;
const functionUrlPattern = /^https:\/\/([a-z0-9]{26}|[a-z0-9]{32})\.lambda-url\.([a-z]{2}(?:-[a-z]+)+-[0-9])\.on\.aws\/$/;
const capabilityPattern = /^[A-Za-z0-9_-]{32,128}$/;

export function onboardingConfigUrl(deploymentId, origin = ONBOARDING_SAAS_ORIGIN) {
  return saasOnboardingUrl(deploymentId, origin, 'configuration');
}

export function onboardingSetupHandoffUrl(deploymentId, origin = ONBOARDING_SAAS_ORIGIN) {
  return saasOnboardingUrl(deploymentId, origin, 'setup-handoff');
}

export function isFunctionUrlOrigin(value) {
  return typeof value === 'string' && functionUrlPattern.test(value);
}

function saasOnboardingUrl(deploymentId, origin, suffix) {
  if (!deploymentIdPattern.test(deploymentId)) throw new Error('RUNHARBOR_DEPLOYMENT_ID is invalid');
  const saas = new URL(origin);
  if (saas.protocol !== 'https:' || saas.username !== '' || saas.password !== '') throw new Error('SaaS origin must be https without credentials');
  return `${saas.origin}/api/v1/onboarding/deployments/${deploymentId}/${suffix}`;
}

function saasOrigin(env) {
  return typeof env.RUNHARBOR_SAAS_ORIGIN === 'string' && env.RUNHARBOR_SAAS_ORIGIN !== '' ? env.RUNHARBOR_SAAS_ORIGIN : ONBOARDING_SAAS_ORIGIN;
}

/** Always requests a new token. Callers must not reuse a previous Actions OIDC token. */
export async function requestGitHubOidcToken(env, httpFetch = fetch) {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (typeof requestUrl !== 'string' || typeof requestToken !== 'string' || requestUrl === '' || requestToken === '') throw new Error('GitHub OIDC token request environment is missing');
  const audienceUrl = new URL(requestUrl);
  audienceUrl.searchParams.set('audience', ONBOARDING_OIDC_AUDIENCE);
  let tokenResponse;
  try {
    tokenResponse = await httpFetch(audienceUrl, { headers: { Authorization: `Bearer ${requestToken}`, Accept: 'application/json' } });
  } catch {
    throw new Error('GitHub OIDC token request failed');
  }
  if (!tokenResponse.ok) throw new Error('GitHub OIDC token request failed');
  let tokenBody;
  try { tokenBody = await tokenResponse.json(); } catch { throw new Error('GitHub OIDC token request failed'); }
  if (!tokenBody || typeof tokenBody.value !== 'string' || tokenBody.value === '') throw new Error('GitHub OIDC token request failed');
  return tokenBody.value;
}

export async function fetchOnboardingConfiguration(env, httpFetch = fetch) {
  const deploymentId = env.RUNHARBOR_DEPLOYMENT_ID;
  if (typeof deploymentId !== 'string' || !deploymentIdPattern.test(deploymentId)) throw new Error('RUNHARBOR_DEPLOYMENT_ID is required');
  const token = await requestGitHubOidcToken(env, httpFetch);
  const configResponse = await httpFetch(onboardingConfigUrl(deploymentId, saasOrigin(env)), { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!configResponse.ok) throw new Error('onboarding configuration request failed');
  let config;
  try { config = await configResponse.json(); } catch { throw new Error('onboarding configuration request failed'); }
  const required = ['tenantId', 'deploymentId', 'bindingKey', 'webhookUrl', 'saasOrigin', 'saasPublicKey', 'githubAppOrganization', 'enrollmentToken', 'enrollmentExpiresAt'];
  const organization = config?.githubAppOrganization;
  if (config?.apiVersion !== 'runharbor.deployment.v2' || required.some((key) => !(key in config)) || config.deploymentId !== deploymentId || typeof config.webhookUrl !== 'string' || typeof config.saasPublicKey !== 'string' || !organization || !/^[1-9][0-9]{0,15}$/.test(organization.id) || !/^[A-Za-z0-9_.-]{1,100}$/.test(organization.login) || organization.type !== 'Organization') throw new Error('onboarding configuration request failed');
  return config;
}

export async function publishSetupHandoff(input, env, httpFetch = fetch) {
  const deploymentId = input?.deploymentId;
  if (typeof deploymentId !== 'string' || !deploymentIdPattern.test(deploymentId)) throw new Error('RUNHARBOR_DEPLOYMENT_ID is invalid');
  if (!isFunctionUrlOrigin(input?.setupOrigin) || typeof input?.capability !== 'string' || !capabilityPattern.test(input.capability)) {
    throw new Error('setup handoff publish failed');
  }
  const token = await requestGitHubOidcToken(env, httpFetch);
  let response;
  try {
    response = await httpFetch(onboardingSetupHandoffUrl(deploymentId, saasOrigin(env)), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ setupOrigin: input.setupOrigin, capability: input.capability }),
    });
  } catch (error) {
    if (error instanceof Error && (error.message === 'GitHub OIDC token request failed' || error.message === 'GitHub OIDC token request environment is missing')) throw error;
    throw new Error('setup handoff publish failed');
  }
  if (!response.ok) throw new Error('setup handoff publish failed');
  let body;
  try { body = await response.json(); } catch { throw new Error('setup handoff publish failed'); }
  if (!body || typeof body.expiresAt !== 'number' || !Number.isInteger(body.expiresAt) || body.expiresAt <= 0) throw new Error('setup handoff publish failed');
  return { expiresAt: body.expiresAt };
}

export function writeDeploymentConfig(root, config) {
  const local = path.join(root, '.runharbor');
  fs.mkdirSync(local, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(local, 'deployment.json'), JSON.stringify(config), { mode: 0o600 });
}

async function main() {
  const root = process.env.RUNHARBOR_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const config = await fetchOnboardingConfiguration(process.env);
  writeDeploymentConfig(root, config);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'command failed'}\n`); process.exitCode = 1; });
}
