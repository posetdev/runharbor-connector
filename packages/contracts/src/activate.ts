import { z } from 'zod';
import { awsAccountIdSchema, awsRegionSchema, deploymentIdSchema, functionUrlSchema, githubIdSchema, repositoryFullNameSchema } from './ids.js';
const ownerSchema = z.object({ id: githubIdSchema, login: z.string().min(1), type: z.enum(['User', 'Organization']) }).strict();
const repositorySchema = z.object({ id: githubIdSchema, fullName: repositoryFullNameSchema }).strict();
export const activateRequestSchema = z.object({ apiVersion: z.literal('runharbor.activate.v1'), connector: z.object({ awsAccountId: awsAccountIdSchema, awsRegion: awsRegionSchema, startFunctionUrl: functionUrlSchema, version: z.string().min(1) }).strict(), github: z.object({ appId: githubIdSchema, appSlug: z.string().min(1), installationId: githubIdSchema, owner: ownerSchema, repositories: z.array(repositorySchema) }).strict(), webhookSecret: z.string().min(1) }).strict();
export const activateResponseSchema = z.object({ apiVersion: z.literal('runharbor.activate.v1'), deploymentId: deploymentIdSchema, status: z.literal('active'), webhookUrl: z.string().url() }).strict();
