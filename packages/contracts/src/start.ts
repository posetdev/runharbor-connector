import { z } from 'zod';
import { deploymentIdSchema, githubIdSchema, idempotencyKeySchema, instanceIdSchema, instanceTypeSchema, operationIdSchema, repositoryFullNameSchema, runnerLabelSchema, runAttemptSchema } from './ids.js';
export const jobSchema = z.object({ githubInstallationId: githubIdSchema, repositoryId: githubIdSchema, repositoryFullName: repositoryFullNameSchema, jobId: githubIdSchema, runId: githubIdSchema, runAttempt: runAttemptSchema }).strict();
export const startRequestSchema = z.object({ apiVersion: z.literal('runharbor.start.v1'), deploymentId: deploymentIdSchema, idempotencyKey: idempotencyKeySchema, runnerLabel: runnerLabelSchema, instanceType: instanceTypeSchema, job: jobSchema }).strict();
export const operationStateSchema = z.enum(['accepted', 'launched', 'ready', 'done', 'failed']);
export const terminalReasonSchema = z.enum(['timeout', 'launch_failed', 'jit_failed', 'admission_failed', 'orphan_cleanup']);
export const startResponseSchema = z.object({ apiVersion: z.literal('runharbor.start.v1'), operationId: operationIdSchema, state: operationStateSchema, instanceId: instanceIdSchema.optional(), replay: z.boolean(), terminalReason: terminalReasonSchema.optional() }).strict();
export type StartRequest = z.infer<typeof startRequestSchema>;
export type StartResponse = z.infer<typeof startResponseSchema>;
