#!/usr/bin/env node
/**
 * Rebuilds Terraform input for an already-installed Connector without asking
 * the SaaS for C5 again. C5 contains a one-time enrollment secret and is only
 * for first installation; this command intentionally reads only the deployed
 * start Lambda's non-secret RUNHARBOR_CONFIG.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const deploymentIdPattern = /^dep_[0-9a-f]{24}$/;
const publicKeyPattern = /^[A-Za-z0-9+/]+={0,2}$/;
const organizationLoginPattern = /^[A-Za-z0-9_.-]{1,100}$/;

export function upgradeTerraformVariables(current, environment) {
  const deploymentId = requiredDeploymentId(environment.RUNHARBOR_DEPLOYMENT_ID);
  const publicKey = requiredPublicKey(environment.RUNHARBOR_SAAS_PUBLIC_KEY);
  const organization = {
    id: requiredOrganizationId(environment.GITHUB_APP_ORGANIZATION_ID),
    login: requiredOrganizationLogin(environment.GITHUB_REPOSITORY_OWNER),
    type: 'Organization',
  };
  if (current?.schema !== 1 || current.deploymentId !== deploymentId) throw new Error('deployed Connector configuration is invalid');
  if (typeof current.tenantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current.tenantId)) throw new Error('deployed Connector configuration is invalid');
  if (typeof current.awsRegion !== 'string' || !/^[a-z]{2}(?:-[a-z]+)+-[0-9]$/.test(current.awsRegion)) throw new Error('deployed Connector configuration is invalid');
  if (!httpsUrl(current.saasOrigin) || !httpsUrl(current.webhookUrl) || !publicKeyPattern.test(current.installerPublicKey ?? '')) {
    throw new Error('deployed Connector configuration is invalid');
  }
  if (!Array.isArray(current.allowedInstanceTypes) || current.allowedInstanceTypes.length === 0 || current.allowedInstanceTypes.some((value) => typeof value !== 'string' || !/^[a-z0-9-]+\.[a-z0-9-]+$/.test(value))) {
    throw new Error('deployed Connector configuration is invalid');
  }
  if (current.purchaseMode !== 'spot' && current.purchaseMode !== 'on-demand') throw new Error('deployed Connector configuration is invalid');

  const images = normalizeImages(current.images);
  return {
    aws_region: current.awsRegion,
    name_prefix: `rh-${deploymentId.slice(4, 16)}`,
    deployment_id: deploymentId,
    tenant_id: current.tenantId,
    saas_public_key: publicKey,
    saas_origin: current.saasOrigin,
    webhook_url: current.webhookUrl,
    github_app_organization: organization,
    installer_public_key: current.installerPublicKey,
    images,
    allowed_instance_types: current.allowedInstanceTypes,
    purchase_mode: current.purchaseMode,
  };
}

export function terraformTfvars(variables) {
  return Object.entries(variables).map(([name, value]) => `${name} = ${JSON.stringify(value)}\n`).join('');
}

function normalizeImages(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('deployed Connector configuration is invalid');
  const images = {};
  for (const [architecture, image] of Object.entries(value)) {
    if ((architecture !== 'x64' && architecture !== 'arm64') || image === null || typeof image !== 'object') throw new Error('deployed Connector configuration is invalid');
    const item = image;
    // The deployed config still carries the resolved AMI id at runtime, so it
    // is validated here -- but it is not written back out: the next apply
    // re-resolves the host image from Canonical's public SSM parameters, and
    // only the settings that are not properties of that image belong in
    // terraform.tfvars.
    if (!/^ami-[0-9a-f]{8,17}$/.test(item.amiId ?? '') || !Number.isInteger(item.rootVolumeGiB) || item.rootVolumeGiB < 8 || item.rootVolumeGiB > 16384 || !Number.isInteger(item.maxDurationMs) || item.maxDurationMs < 60_000 || item.maxDurationMs % 60_000 !== 0) {
      throw new Error('deployed Connector configuration is invalid');
    }
    images[architecture] = { root_volume_gib: item.rootVolumeGiB, max_duration_minutes: item.maxDurationMs / 60_000 };
  }
  if (Object.keys(images).length === 0) throw new Error('deployed Connector configuration is invalid');
  return images;
}

function requiredDeploymentId(value) {
  if (typeof value !== 'string' || !deploymentIdPattern.test(value)) throw new Error('RUNHARBOR_DEPLOYMENT_ID is required');
  return value;
}

function requiredPublicKey(value) {
  if (typeof value !== 'string' || !publicKeyPattern.test(value)) throw new Error('RUNHARBOR_SAAS_PUBLIC_KEY is required');
  return value;
}

function requiredOrganizationId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value)) throw new Error('GITHUB_APP_ORGANIZATION_ID is required');
  return value;
}

function requiredOrganizationLogin(value) {
  if (typeof value !== 'string' || !organizationLoginPattern.test(value)) throw new Error('GITHUB_REPOSITORY_OWNER is required');
  return value;
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch { return false; }
}

function main() {
  const root = process.env.RUNHARBOR_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const deploymentId = requiredDeploymentId(process.env.RUNHARBOR_DEPLOYMENT_ID);
  const functionName = `rh-${deploymentId.slice(4, 16)}-start`;
  let raw;
  try {
    raw = execFileSync('aws', ['lambda', 'get-function-configuration', '--function-name', functionName, '--query', 'Environment.Variables.RUNHARBOR_CONFIG', '--output', 'text'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { throw new Error('unable to read deployed Connector configuration'); }
  let current;
  try { current = JSON.parse(raw); } catch { throw new Error('unable to read deployed Connector configuration'); }
  const target = path.join(root, 'infra/roots/connector/terraform.tfvars');
  fs.writeFileSync(target, terraformTfvars(upgradeTerraformVariables(current, process.env)), { mode: 0o600 });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'upgrade configuration failed'}\n`); process.exitCode = 1; }
}
