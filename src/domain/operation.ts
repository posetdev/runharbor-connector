import { createHash } from 'node:crypto';
import { z } from 'zod';
import { deploymentIdSchema, epochMsSchema, idempotencyKeySchema, instanceIdSchema, instanceTypeSchema, operationIdSchema, operationStateSchema, runnerLabelSchema, type EpochMs } from '@runharbor/contracts';
import { AppError } from './errors.js';
import { jobSchema, terminalReasonSchema, type StartRequest } from '@runharbor/contracts';

const envelopeSchema = z.object({
  pk: z.string(), sk: z.string(), kind: z.string(), schema: z.literal(1), revision: z.number().int().nonnegative(),
  createdAt: epochMsSchema, updatedAt: epochMsSchema, ttl: z.number().int().optional(),
}).strict();

export const operationRecordSchema = envelopeSchema.extend({
  pk: z.string().regex(/^OP#op_[0-9a-f]{64}$/), sk: z.literal('#'), kind: z.literal('operation'),
  state: operationStateSchema, deploymentId: deploymentIdSchema, runnerLabel: runnerLabelSchema, instanceType: instanceTypeSchema,
  idempotencyKey: idempotencyKeySchema, job: jobSchema, instanceId: instanceIdSchema.optional(),
  runnerName: z.string().regex(/^rh-[0-9a-f]{16}$/), jitConfig: z.string().min(1).optional(),
  jitClaimedAt: epochMsSchema.optional(), timeoutAt: epochMsSchema, scheduleName: z.string().min(1).optional(),
  terminalReason: terminalReasonSchema.optional(), terminatedAt: epochMsSchema.optional(),
  gsi1pk: z.literal('OP'), gsi1sk: z.string().regex(/^\d{13}#op_[0-9a-f]{64}$/),
}).strict();

export type OperationRecord = z.infer<typeof operationRecordSchema>;
export type OperationState = OperationRecord['state'];
export type OperationPatch = Partial<Omit<OperationRecord, 'pk' | 'sk' | 'kind' | 'schema' | 'state' | 'revision' | 'createdAt' | 'gsi1pk' | 'gsi1sk'>>;

export const operationTransitions: Readonly<Record<OperationState, readonly OperationState[]>> = {
  accepted: ['launched', 'failed'], launched: ['ready', 'failed'], ready: ['done', 'failed'], done: [], failed: [],
};

export function transition(record: OperationRecord, to: OperationState, patch: OperationPatch = {}): OperationRecord {
  if (!operationTransitions[record.state].includes(to)) throw new AppError('INVALID_TRANSITION');
  return operationRecordSchema.parse({ ...record, ...patch, state: to, revision: record.revision + 1 });
}

export function deriveOperationId(input: Pick<OperationRecord, 'deploymentId' | 'job'>): string;
export function deriveOperationId(deploymentId: string, job: StartRequest['job']): string;
export function deriveOperationId(input: Pick<OperationRecord, 'deploymentId' | 'job'> | string, suppliedJob?: StartRequest['job']): string {
  const { deploymentId, job } = typeof input === 'string' ? { deploymentId: input, job: suppliedJob } : input;
  if (job === undefined) throw new AppError('BAD_REQUEST');
  return `op_${createHash('sha256').update(`${deploymentId}|${job.repositoryId}|${job.jobId}|${job.runAttempt}`).digest('hex')}`;
}

export function runnerName(operationId: string): string {
  if (!operationIdSchema.safeParse(operationId).success) throw new AppError('BAD_REQUEST');
  return `rh-${operationId.slice(3, 19)}`;
}

export function isTakeoverAllowed(record: OperationRecord, now: EpochMs): boolean {
  return (record.state === 'accepted' || record.state === 'launched') && record.updatedAt < (now - 90_000);
}

/** Time the bootstrap gets to install packages and claim JIT before the job's own budget starts. */
export const BOOTSTRAP_BUDGET_MS = 15 * 60_000;
const TERMINAL_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export function isTerminal(state: OperationState): boolean {
  return state === 'done' || state === 'failed';
}

export function scheduleName(operationId: string): string {
  if (!operationIdSchema.safeParse(operationId).success) throw new AppError('BAD_REQUEST');
  return `rh-${operationId.slice(3, 35)}`;
}

/** `ttl` (epoch seconds) written with every terminal transition: 30 days after it. */
export function terminalTtl(now: EpochMs): number {
  return Math.floor(now / 1_000) + TERMINAL_RETENTION_SECONDS;
}

export type AcceptedOperationInput = Readonly<{
  operationId: string; deploymentId: string; runnerLabel: string; instanceType: string; idempotencyKey: string;
  job: StartRequest['job']; timeoutAfterMs: number; now: EpochMs;
}>;

/** `timeoutAfterMs` is the whole budget: the caller adds BOOTSTRAP_BUDGET_MS to the image's maxDurationMs. */

export function acceptedOperation(input: AcceptedOperationInput): OperationRecord {
  return operationRecordSchema.parse({
    pk: `OP#${input.operationId}`, sk: '#', kind: 'operation', schema: 1, revision: 0, createdAt: input.now, updatedAt: input.now,
    state: 'accepted', deploymentId: input.deploymentId, runnerLabel: input.runnerLabel, instanceType: input.instanceType, idempotencyKey: input.idempotencyKey, job: input.job,
    runnerName: runnerName(input.operationId), timeoutAt: input.now + input.timeoutAfterMs,
    gsi1pk: 'OP', gsi1sk: `${String(input.now).padStart(13, '0')}#${input.operationId}`,
  });
}

/** The EC2 ClientToken of an operation's one instance: the 64 hex after `op_` (04 §1). */
export function ec2ClientToken(operationId: string): string {
  if (!operationIdSchema.safeParse(operationId).success) throw new AppError('BAD_REQUEST');
  return operationId.slice(3, 67);
}

/** `shutting-down` is already on its way to `terminated`; neither can run a job any more. */
export function isInstanceGone(instance: Readonly<{ state: string }> | undefined): boolean {
  return instance === undefined || instance.state === 'terminated' || instance.state === 'shutting-down';
}
