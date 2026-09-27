import type { z } from 'zod';
import type { activateRequestSchema } from '@runharbor/contracts';
export type ActivateRequest = z.infer<typeof activateRequestSchema>;
export interface SaasPort { activate(deploymentId: string, token: string, payload: ActivateRequest): Promise<void>; }
