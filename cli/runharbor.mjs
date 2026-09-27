#!/usr/bin/env node
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isFunctionUrlOrigin, publishSetupHandoff } from '../scripts/onboarding-config.mjs';

const regionPattern = /^[a-z]{2}(-gov)?-[a-z]+-[0-9]$/;
function repoRoot() { return process.env.RUNHARBOR_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); }
const booleanFlags = new Set(['print-url']);
const saasOrigin = process.env.RUNHARBOR_SAAS_ORIGIN ?? 'https://runharbor.poset.dev';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'init') return init(parseArgs(args));
  if (command === 'setup') return setup(parseArgs(args));
  if (command === 'status') return status();
  throw new Error('usage: runharbor <init|setup|status>');
}

function init(options) {
  if (typeof options.config !== 'string') throw new Error('--config is required');
  const deployment = deploymentFile(options.config);
  const region = nonempty(options.region) ?? nonempty(process.env.AWS_REGION) ?? nonempty(process.env.AWS_DEFAULT_REGION);
  if (typeof region !== 'string' || !regionPattern.test(region)) throw new Error('a valid --region is required (or set AWS_REGION/AWS_DEFAULT_REGION)');
  const purchaseMode = nonempty(options['purchase-mode']) ?? nonempty(process.env.PURCHASE_MODE) ?? 'spot';
  if (purchaseMode !== 'spot' && purchaseMode !== 'on-demand') throw new Error('--purchase-mode must be spot or on-demand');
  const allowed = instanceTypes(nonempty(options['allowed-instance-types']) ?? nonempty(process.env.ALLOWED_INSTANCE_TYPES));
  const local = path.join(repoRoot(), '.runharbor'); fs.mkdirSync(local, { recursive: true, mode: 0o700 });
  const keys = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(local, 'installer.key'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(local, 'enrollment.token'), deployment.enrollmentToken, { mode: 0o600, flag: 'wx' });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const namePrefix = `rh-${deployment.deploymentId.slice(4, 16)}`;
  // No image choice: the host is Canonical's Ubuntu 24.04 LTS on both
  // architectures, and Terraform resolves its current AMI per architecture from
  // Canonical's public SSM parameters at deploy time. Only the settings that
  // are not properties of that image are written here.
  const tfvars = `aws_region = ${literal(region)}\nname_prefix = ${literal(namePrefix)}\ndeployment_id = ${literal(deployment.deploymentId)}\ntenant_id = ${literal(deployment.tenantId)}\nsaas_public_key = ${literal(deployment.saasPublicKey)}\nsaas_origin = ${literal(deployment.saasOrigin)}\nwebhook_url = ${literal(deployment.webhookUrl)}\ngithub_app_organization = ${literal(deployment.githubAppOrganization)}\ninstaller_public_key = ${literal(publicKey)}\nimages = {\n  x64 = {\n    root_volume_gib = 20\n    max_duration_minutes = 60\n  }\n  arm64 = {\n    root_volume_gib = 20\n    max_duration_minutes = 60\n  }\n}\nallowed_instance_types = ${literal(allowed)}\npurchase_mode = ${literal(purchaseMode)}\n`;
  fs.writeFileSync(path.join(repoRoot(), 'infra/roots/connector/terraform.tfvars'), tfvars, { mode: 0o600 });
  fs.writeFileSync(path.join(repoRoot(), 'infra/roots/connector/backend.hcl.example'), '# Supply your customer-managed Terraform backend configuration here.\n', { mode: 0o644 });
}

export async function setup(options, deps = {}) {
  const httpFetch = deps.fetch ?? fetch;
  const openUrl = deps.open ?? open;
  const outputs = terraformOutputs(); const setupUrl = output(outputs, 'setup_url');
  const actions = options['print-url'] === true || process.env.GITHUB_ACTIONS === 'true';
  if (actions && !isFunctionUrlOrigin(setupUrl)) throw new Error('setup url is invalid');
  const token = fs.readFileSync(path.join(repoRoot(), '.runharbor/enrollment.token'), 'utf8').trim();
  const key = createPrivateKey(fs.readFileSync(path.join(repoRoot(), '.runharbor/installer.key'), 'utf8'));
  const now = Math.floor(Date.now() / 1000); const header = encode({ alg: 'EdDSA', typ: 'JWT' }); const payload = encode({ purpose: actions ? 'runharbor-setup-actions-v1' : 'runharbor-setup-v1', jti: randomBytes(24).toString('base64url'), exp: now + 300, enrollmentToken: token });
  const ticket = `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), key).toString('base64url')}`;
  const exchangePath = actions ? 'auth/actions-exchange' : 'auth/exchange';
  let response;
  try {
    response = await httpFetch(`${setupUrl}${exchangePath}`, { method: 'POST', headers: { origin: 'http://127.0.0.1', 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) });
  } catch {
    throw new Error('setup ticket exchange failed');
  }
  if (!response.ok) throw new Error('setup ticket exchange failed');
  let handoff;
  try { handoff = await response.json(); } catch { throw new Error('setup ticket exchange returned an invalid response'); }
  const expectedExpiry = actions ? 1800 : 120;
  if (!handoff || typeof handoff.handoffCode !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(handoff.handoffCode) || handoff.expiresInSeconds !== expectedExpiry) throw new Error('setup ticket exchange returned an invalid response');
  const deploymentId = tfvarsField('deployment_id');
  const consoleLink = continuationLink(deploymentId);
  if (actions) {
    try {
      await publishSetupHandoff({ deploymentId, setupOrigin: setupUrl, capability: handoff.handoffCode }, process.env, httpFetch);
    } catch (error) {
      if (error instanceof Error && (error.message === 'setup handoff publish failed' || error.message === 'GitHub OIDC token request environment is missing' || error.message === 'GitHub OIDC token request failed' || error.message === 'RUNHARBOR_DEPLOYMENT_ID is invalid')) throw error;
      throw new Error('setup handoff publish failed');
    }
    process.stdout.write(`${consoleLink}\n`);
    if (typeof process.env.GITHUB_STEP_SUMMARY === 'string' && process.env.GITHUB_STEP_SUMMARY !== '') fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${consoleLink}\n`);
    return;
  }
  openUrl(`${setupUrl}setup?code=${encodeURIComponent(handoff.handoffCode)}`);
}

function status() { process.stdout.write(`${JSON.stringify(terraformOutputs())}\n`); }
function terraformOutputs() { return JSON.parse(execFileSync('terraform', ['-chdir=infra/roots/connector', 'output', '-json'], { cwd: repoRoot(), encoding: 'utf8' })); }
function output(outputs, name) { const value = outputs[name]?.value; if (typeof value !== 'string' || (!value.startsWith('https://') && !/^http:\/\/127\.0\.0\.1(?::[0-9]+)?\/?$/.test(value))) throw new Error(`terraform output ${name} is missing`); return value.endsWith('/') ? value : `${value}/`; }
function open(url) { const result = spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }); if (result.error) throw result.error; }
function deploymentFile(file) { const parsed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); const required = ['tenantId', 'deploymentId', 'bindingKey', 'webhookUrl', 'saasOrigin', 'saasPublicKey', 'githubAppOrganization', 'enrollmentToken', 'enrollmentExpiresAt']; const organization = parsed?.githubAppOrganization; if (parsed?.apiVersion !== 'runharbor.deployment.v2' || required.some((key) => !(key in parsed)) || typeof parsed.webhookUrl !== 'string' || typeof parsed.saasPublicKey !== 'string' || !organization || !/^[1-9][0-9]{0,15}$/.test(organization.id) || !/^[A-Za-z0-9_.-]{1,100}$/.test(organization.login) || organization.type !== 'Organization') throw new Error('invalid deployment.json'); return parsed; }
function parseArgs(args) { const result = {}; for (let index = 0; index < args.length; index += 1) { const value = args[index]; if (!value.startsWith('--')) throw new Error(`unexpected argument ${value}`); const key = value.slice(2); if (booleanFlags.has(key)) { result[key] = true; continue; } const next = args[index + 1]; if (next === undefined || next.startsWith('--')) throw new Error(`--${key} requires a value`); result[key] = next; index += 1; } return result; }
function encode(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function literal(value) { return JSON.stringify(value); }
function instanceTypes(value) {
  const list = (typeof value === 'string' && value !== '' ? value : 'c7g.xlarge,c7i.large').split(',').map((item) => item.trim()).filter(Boolean);
  if (!list.includes('c7g.xlarge') || !list.includes('c7i.large')) throw new Error('allowed instance types must include c7g.xlarge and c7i.large');
  if (list.some((item) => !/^[a-z0-9-]+\.[a-z0-9-]+$/.test(item))) throw new Error('invalid instance type');
  return list;
}
function tfvarsField(name) {
  const match = fs.readFileSync(path.join(repoRoot(), 'infra/roots/connector/terraform.tfvars'), 'utf8').match(new RegExp(`^${name} = "(.*)"$`, 'm'));
  if (match === null) throw new Error(`terraform.tfvars ${name} is missing`);
  return match[1];
}
function nonempty(value) { return typeof value === 'string' && value !== '' ? value : undefined; }
function continuationLink(deploymentId) {
  if (!/^dep_[0-9a-f]{24}$/.test(deploymentId)) throw new Error('invalid deployment id');
  const url = new URL(saasOrigin);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('SaaS origin must be https without credentials');
  return `${url.origin}/deployments/${deploymentId}/setup/activate`;
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'command failed'}\n`); process.exitCode = 1; });
}
