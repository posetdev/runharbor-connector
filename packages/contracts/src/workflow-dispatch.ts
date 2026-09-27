import { z } from 'zod';
import { deploymentIdSchema, gitRefSchema, githubIdSchema, idempotencyKeySchema, repositoryFullNameSchema } from './ids.js';


export const workflowDispatchRequestSchema = z.object({
  apiVersion: z.literal('runharbor.workflow-dispatch.v2'),
  deploymentId: deploymentIdSchema,
  idempotencyKey: idempotencyKeySchema,
  target: z.object({ repositoryId: githubIdSchema, repositoryFullName: repositoryFullNameSchema }).strict(),
  source: z.object({ repositoryFullName: repositoryFullNameSchema, ref: gitRefSchema, after: z.string().regex(/^[0-9a-f]{40}$/i) }).strict(),
}).strict();
export type WorkflowDispatchRequest = z.infer<typeof workflowDispatchRequestSchema>;

export const workflowDispatchResponseSchema = z.object({
  apiVersion: z.literal('runharbor.workflow-dispatch.v2'),
  idempotencyKey: idempotencyKeySchema,
  workflowRunId: githubIdSchema.optional(),
}).strict();
export type WorkflowDispatchResponse = z.infer<typeof workflowDispatchResponseSchema>;
