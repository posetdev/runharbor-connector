import { z } from 'zod';
import { epochMsSchema, githubIdSchema } from '@runharbor/contracts';
import { AppError } from './errors.js';

const envelopeSchema = z.object({ pk: z.string(), sk: z.literal('#'), kind: z.string(), schema: z.literal(1), revision: z.number().int().nonnegative(), createdAt: epochMsSchema, updatedAt: epochMsSchema, ttl: z.number().int() }).strict();
export const setupSessionSchema = envelopeSchema.extend({
  pk: z.string().regex(/^SETUP#[0-9a-f]{64}$/), kind: z.literal('setup_session'), status: z.enum(['pending', 'app_created', 'installed', 'activated', 'failed']),
  installerSessionHash: z.string().regex(/^[0-9a-f]{64}$/), browserStartedAt: epochMsSchema.optional(), expectedOwner: z.object({ id: githubIdSchema, login: z.string().min(1), type: z.enum(['User', 'Organization']) }).strict().optional(), githubAppId: githubIdSchema.optional(), error: z.string().min(1).optional(), enrollmentToken: z.string().min(1).optional(),
}).strict();
export type SetupSession = z.infer<typeof setupSessionSchema>;
export type SetupState = SetupSession['status'];
export const installerSessionSchema = envelopeSchema.extend({ pk: z.string().regex(/^INSTALLER#[0-9a-f]{64}$/), kind: z.literal('installer_session'), jtiHash: z.string().regex(/^[0-9a-f]{64}$/), enrollmentToken: z.string().min(1).optional(), setupStateHash: z.string().regex(/^[0-9a-f]{64}$/).optional(), expiresAt: epochMsSchema, revokedAt: epochMsSchema.optional() }).strict();
export type InstallerSession = z.infer<typeof installerSessionSchema>;
export const installerTicketSchema = z.object({ pk: z.string().regex(/^TICKET#[0-9a-f]{64}$/), sk: z.literal('#'), kind: z.literal('installer_ticket'), schema: z.literal(1), revision: z.number().int().nonnegative(), createdAt: epochMsSchema, updatedAt: epochMsSchema, ttl: z.number().int() }).strict();
export type InstallerTicket = z.infer<typeof installerTicketSchema>;
export const installerHandoffSchema = envelopeSchema.extend({ pk: z.string().regex(/^HANDOFF#[0-9a-f]{64}$/), kind: z.literal('installer_handoff'), jtiHash: z.string().regex(/^[0-9a-f]{64}$/), enrollmentToken: z.string().min(1), expiresAt: epochMsSchema, consumedAt: epochMsSchema.optional() }).strict();
export type InstallerHandoff = z.infer<typeof installerHandoffSchema>;

const setupTransitions: Readonly<Record<SetupState, readonly SetupState[]>> = { pending: ['app_created', 'failed'], app_created: ['installed', 'failed'], installed: ['activated', 'failed'], activated: [], failed: [] };
export function transitionSetupSession(record: SetupSession, to: SetupState, patch: Partial<Omit<SetupSession, 'pk' | 'sk' | 'kind' | 'schema' | 'status' | 'revision' | 'createdAt' | 'ttl'>> = {}): SetupSession {
  if (!setupTransitions[record.status].includes(to)) throw new AppError('INVALID_TRANSITION');
  const next = { ...record, ...patch, status: to, revision: record.revision + 1 };
  if (to === 'activated') delete next.enrollmentToken;
  return setupSessionSchema.parse(next);
}
