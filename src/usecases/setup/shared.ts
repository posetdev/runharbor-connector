import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { z } from 'zod';
import { enrollmentTokenSchema, type EpochMs } from '@runharbor/contracts';
import type { ConnectorConfig } from '../../runtime/config.js';
import { AppError } from '../../domain/errors.js';
import type { DeploymentRecord } from '../../domain/deployment.js';
import type { DeploymentStore } from '../../ports/deployment-store.js';
import type { InstallerSession } from '../../domain/setup.js';
import type { ActivateRequest } from '../../ports/saas.js';
import type { SetupStore } from '../../ports/setup-store.js';

export const SETUP_TICKET_PURPOSE = 'runharbor-setup-v1';
export const ACTIONS_TICKET_PURPOSE = 'runharbor-setup-actions-v1';
export type SetupTicketPurpose = typeof SETUP_TICKET_PURPOSE | typeof ACTIONS_TICKET_PURPOSE;
const ticketSchema = z.object({ purpose: z.enum(['runharbor-setup-v1', 'runharbor-setup-actions-v1']), jti: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), exp: z.number().int().positive(), enrollmentToken: enrollmentTokenSchema }).strict();
const headerSchema = z.object({ alg: z.literal('EdDSA'), typ: z.literal('JWT') }).strict();
export type SetupTicket = z.infer<typeof ticketSchema>;

export function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function randomToken(): string { return randomBytes(32).toString('base64url'); }
export function secondsToTtl(value: EpochMs): number { return Math.ceil(value / 1_000); }

export function verifySetupTicket(ticket: unknown, publicKey: string, now: EpochMs, purpose: SetupTicketPurpose = SETUP_TICKET_PURPOSE): SetupTicket {
  if (typeof ticket !== 'string' || ticket.length > 8_192) throw new AppError('UNAUTHENTICATED');
  const parts = ticket.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new AppError('UNAUTHENTICATED');
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = headerSchema.parse(JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')));
    const payload = ticketSchema.parse(JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')));
    const signature = Buffer.from(encodedSignature, 'base64url');
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (header.alg !== 'EdDSA' || !verify(null, Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'), key, signature)) throw new Error('invalid signature');
    if (payload.purpose !== purpose) throw new Error('wrong ticket purpose');
    if (payload.exp * 1_000 <= now || payload.exp * 1_000 > now + 5 * 60 * 1_000) throw new Error('expired ticket');
    return payload;
  } catch {
    throw new AppError('UNAUTHENTICATED');
  }
}

export async function authenticatedInstaller(store: SetupStore, cookie: string | undefined, now: EpochMs): Promise<InstallerSession> {
  const token = cookieValue(cookie, '__Host-runharbor-setup');
  if (token === undefined) throw new AppError('UNAUTHENTICATED');
  const installer = await store.getInstallerSession(sha256(token));
  if (installer === undefined || installer.revokedAt !== undefined || installer.expiresAt <= now) throw new AppError('UNAUTHENTICATED');
  return installer;
}

export function installerCookie(value: string): string { return `__Host-runharbor-setup=${value}; Path=/; Max-Age=1800; Secure; HttpOnly; SameSite=Lax`; }

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined || header.length > 8_192) return undefined;
  const value = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value !== undefined && /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : undefined;
}

export function nowMs(): EpochMs { return Date.now() as EpochMs; }
export type SetupRuntime = Readonly<{ config: ConnectorConfig; store: SetupStore }>;

/** The C3 payload; built only from the DEPLOYMENT record so a retry reports exactly what the first attempt verified. */
export function activationRequest(config: ConnectorConfig, deployment: DeploymentRecord, webhookSecret: string): ActivateRequest {
  return { apiVersion: 'runharbor.activate.v1', connector: { awsAccountId: config.awsAccountId, awsRegion: config.awsRegion, startFunctionUrl: config.startFunctionUrl ?? '', version: '1.0.0' }, github: deployment.github, webhookSecret };
}

/** Best effort: a failed write must not replace the activate error the caller is about to rethrow. */
export async function recordActivationFailure(deploymentStore: DeploymentStore, deployment: DeploymentRecord, error: unknown, now: EpochMs): Promise<void> {
  try { await deploymentStore.update(deployment, { saasActivation: { status: 'failed', lastAttemptAt: now, lastErrorCode: AppError.from(error).code }, updatedAt: now }); } catch { /* the activate error is the one to report */ }
}
