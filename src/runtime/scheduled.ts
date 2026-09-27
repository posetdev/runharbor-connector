import { z } from 'zod';
import { operationIdSchema } from '@runharbor/contracts';

const timeoutEventSchema = z.object({ operationId: operationIdSchema }).strict();
const sweepEventSchema = z.object({ mode: z.literal('sweep') }).strict();
export type ScheduledEvent = z.infer<typeof timeoutEventSchema> | z.infer<typeof sweepEventSchema>;

export function parseScheduledEvent(event: unknown): ScheduledEvent {
  const timeout = timeoutEventSchema.safeParse(event);
  if (timeout.success) return timeout.data;
  const sweep = sweepEventSchema.safeParse(event);
  if (sweep.success) return sweep.data;
  throw new Error('invalid scheduled event');
}
