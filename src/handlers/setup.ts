import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { appCreated } from '../usecases/setup/app-created.js';
import { beginSetup } from '../usecases/setup/begin.js';
import { consumeHandoff } from '../usecases/setup/consume-handoff.js';
import { exchangeActionsTicket } from '../usecases/setup/exchange-ticket.js';
import { exchangeTicket } from '../usecases/setup/exchange-ticket.js';
import { installed } from '../usecases/setup/installed.js';
import { retryActivate } from '../usecases/setup/retry-activate.js';
import { setupStatus } from '../usecases/setup/status.js';
import { authenticatedInstaller, nowMs, sha256, type SetupRuntime } from '../usecases/setup/shared.js';
import type { DeploymentRecord } from '../domain/deployment.js';
import type { DeploymentStore } from '../ports/deployment-store.js';
import type { GitHubPort } from '../ports/github.js';
import type { OperationStore } from '../ports/operation-store.js';
import type { SaasPort } from '../ports/saas.js';
import type { SecretsPort } from '../ports/secrets.js';
import { composeSetup } from '../runtime/setup-compose.js';
import { errorResponse, json, parseFunctionUrlEvent, parseJsonBody, type FunctionUrlRequest, type FunctionUrlResponse } from '../runtime/http.js';

import {
  renderActivePage,
  renderInstallPage,
  renderManifestPage,
  renderRetryPage,
  renderSecurityErrorPage,
  renderSetupStartPage,
  renderSuccessPage,
} from './setup-html.js';

const exchangeSchema = z.object({ ticket: z.string().min(1).max(8_192) }).strict();

export type SetupDependencies = Readonly<{ runtime: SetupRuntime; deployments: DeploymentStore; operations: OperationStore; github: Pick<GitHubPort, 'convertManifest' | 'getInstallation' | 'installationToken' | 'listInstallationRepos'>; secrets: SecretsPort; saas: SaasPort }>;

export const handler = createSetupHandler(composeSetup);

export function createSetupHandler(compose: () => SetupDependencies): (event: unknown) => Promise<FunctionUrlResponse> {
  return async (event) => {
    try {
      const request = parseFunctionUrlEvent(event); const composed = compose(); const now = nowMs();
      if (request.method === 'POST' && request.path === '/auth/exchange') {
        if (!isLoopbackOrigin(request.headers.origin)) throw new AppError('FORBIDDEN');
        const parsed = exchangeSchema.safeParse(parseJsonBody(request)); if (!parsed.success) throw new AppError('BAD_REQUEST');
        const result = await exchangeTicket(composed.runtime, parsed.data.ticket, now);
        return json(200, result);
      }
      if (request.method === 'POST' && request.path === '/auth/actions-exchange') {
        if (!isLoopbackOrigin(request.headers.origin)) throw new AppError('FORBIDDEN');
        const parsed = exchangeSchema.safeParse(parseJsonBody(request)); if (!parsed.success) throw new AppError('BAD_REQUEST');
        const result = await exchangeActionsTicket(composed.runtime, parsed.data.ticket, now);
        return json(200, result);
      }
      if (request.method === 'GET' && request.path === '/setup') {
        if (request.query.code !== undefined) {
          if (Object.keys(request.query).length !== 1) throw new AppError('BAD_REQUEST');
          const result = await consumeHandoff(composed.runtime, request.query.code, now);
          return { statusCode: 302, headers: { location: '/setup', 'cache-control': 'no-store' }, cookies: [result.cookie], body: '' };
        }
        try { await authenticatedInstaller(composed.runtime.store, request.headers.cookie, now); }
        catch { return html(200, renderSecurityErrorPage()); }
        return html(200, setupPage(await composed.deployments.get(), composed.runtime.config.githubAppOrganization.login));
      }
      if (request.method === 'POST' && request.path === '/setup/retry-activate') {
        const installer = await authenticatedInstaller(composed.runtime.store, request.headers.cookie, now);
        if (installer.enrollmentToken === undefined) throw new AppError('STATE_CONFLICT');
        await retryActivate(composed.runtime, composed.deployments, composed.secrets, composed.saas, installer.setupStateHash, installer.enrollmentToken, now);
        await composed.runtime.store.updateInstallerSession(installer, { enrollmentToken: undefined, updatedAt: now });
        return html(200, renderSuccessPage());
      }
      if (request.method === 'POST' && request.path === '/setup/begin') {
        const installer = await authenticatedInstaller(composed.runtime.store, request.headers.cookie, now);
        // Hiding the button on GET /setup is not a guard: a stale tab still holds the same-site form SameSite=Lax lets through.
        // Once DEPLOYMENT exists a second begin would create a second GitHub App and overwrite the first one's SSM credentials.
        if (await composed.deployments.get() !== undefined) throw new AppError('STATE_CONFLICT');
        const setupUrl = setupOrigin(request.headers.host, composed.runtime.config.awsRegion);
        const installerHash = installer.pk.slice('INSTALLER#'.length);
        const requestedAppName = parseAppNameFromBody(request);
        const result = await beginSetup(composed.runtime, installerHash, setupUrl, now, requestedAppName);
        await composed.runtime.store.updateInstallerSession(installer, { setupStateHash: sha256(result.state), updatedAt: now });
        return html(200, renderManifestPage(result.state, result.manifest, composed.runtime.config.githubAppOrganization.login, result.appName));
      }
      if (request.method === 'GET' && request.path === '/github/app-created') {
        const state = query(request.query, 'state'); const code = query(request.query, 'code');
        const created = await appCreated(composed.runtime, composed.deployments, composed.github, composed.secrets, state, code, now);
        return html(200, renderInstallPage(created.slug));
      }
      if (request.method === 'GET' && request.path === '/github/installed') {
        const installer = await authenticatedInstaller(composed.runtime.store, request.headers.cookie, now);
        const installationId = query(request.query, 'installation_id');
        if (request.query.setup_action !== 'install') throw new AppError('BAD_REQUEST');
        if (installer.setupStateHash === undefined || installer.enrollmentToken === undefined) throw new AppError('STATE_CONFLICT');
        await installed(composed.runtime, composed.deployments, composed.github, composed.secrets, composed.saas, installer.setupStateHash, installer.enrollmentToken, installationId, now);
        await composed.runtime.store.updateInstallerSession(installer, { enrollmentToken: undefined, updatedAt: now });
        return html(200, renderSuccessPage());
      }
      if (request.method === 'GET' && request.path === '/status') return json(200, await setupStatus(composed.deployments, composed.operations));
      throw new AppError('NOT_FOUND');
    } catch (error) { return errorResponse(AppError.from(error)); }
  };
}

/** A DEPLOYMENT record exists once installed ran; from then on this page must never offer to create another GitHub App. */
function setupPage(deployment: DeploymentRecord | undefined, organizationLogin?: string): string {
  if (deployment === undefined) {
    return renderSetupStartPage(organizationLogin);
  }
  if (deployment.saasActivation.status === 'active') {
    return renderActivePage();
  }
  return renderRetryPage(deployment.saasActivation.lastErrorCode);
}

function parseAppNameFromBody(request: FunctionUrlRequest): string | undefined {
  if (request.body.length === 0) return undefined;
  const contentType = request.headers['content-type']?.toLowerCase() ?? '';
  if (contentType.startsWith('application/json')) {
    try {
      const parsed = JSON.parse(request.body.toString('utf8')) as Record<string, unknown>;
      if (typeof parsed.appName === 'string') return parsed.appName;
      if (typeof parsed.name === 'string') return parsed.name;
    } catch {
      throw new AppError('BAD_REQUEST');
    }
  }
  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    try {
      const params = new URLSearchParams(request.body.toString('utf8'));
      const appName = params.get('app_name') ?? params.get('name');
      if (typeof appName === 'string') return appName;
    } catch {
      throw new AppError('BAD_REQUEST');
    }
  }
  return undefined;
}

function query(queryValues: Record<string, string>, name: string): string { if (Object.keys(queryValues).some((key) => key !== name && key !== 'code' && key !== 'state' && key !== 'installation_id' && key !== 'setup_action') || typeof queryValues[name] !== 'string') throw new AppError('BAD_REQUEST'); return queryValues[name]; }
function isLoopbackOrigin(origin: string | undefined): boolean { return origin !== undefined && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(origin); }
export function setupOrigin(host: string | undefined, region: string): string { if (host === undefined || !new RegExp(`^(?:[a-z0-9]{26}|[a-z0-9]{32})\\.lambda-url\\.${region.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\.on\\.aws$`).test(host)) throw new AppError('FORBIDDEN'); return `https://${host}`; }
function html(statusCode: number, body: string): FunctionUrlResponse { return { statusCode, headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' }, body }; }
