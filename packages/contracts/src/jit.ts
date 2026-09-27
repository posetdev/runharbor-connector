import { z } from 'zod';
import { operationIdSchema } from './ids.js';
export const jitReadinessResponseSchema = z.object({ operationId: operationIdSchema, status: z.enum(['pending', 'ready', 'terminal']) }).strict();
export const jitClaimRequestSchema = z.object({ operationId: operationIdSchema }).strict();
export const jitClaimResponseSchema = z.object({ operationId: operationIdSchema, runnerName: z.string().regex(/^rh-[0-9a-f]{16}$/), encodedJitConfig: z.string().min(1) }).strict();
