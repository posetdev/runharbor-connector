import { z } from 'zod';
import { bindingKeySchema, deliveryIdSchema, deploymentIdSchema, idempotencyKeySchema, instanceTypeSchema, runnerLabelSchema, tenantIdSchema } from './ids.js';
import { jobSchema } from './start.js';
export const intentSchema = z.object({ apiVersion: z.literal('runharbor.intent.v1'), tenantId: tenantIdSchema, deploymentId: deploymentIdSchema, bindingKey: bindingKeySchema, deliveryId: deliveryIdSchema, idempotencyKey: idempotencyKeySchema, runnerLabel: runnerLabelSchema, instanceType: instanceTypeSchema, job: jobSchema }).strict();
