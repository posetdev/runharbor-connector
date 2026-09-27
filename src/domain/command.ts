import { z } from 'zod';
import { commandIdSchema, deploymentIdSchema, epochMsSchema } from '@runharbor/contracts';

export const commandRecordSchema = z.object({
  pk: z.string().regex(/^CMD#[A-Za-z0-9_-]{8,128}$/),
  sk: z.literal('#'),
  kind: z.literal('command'),
  schema: z.literal(1),
  commandId: commandIdSchema,
  deploymentId: deploymentIdSchema,
  type: z.string().min(1),
  createdAt: epochMsSchema,
  ttl: z.number().int(),
}).strict();
