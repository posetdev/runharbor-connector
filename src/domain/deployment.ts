import { z } from 'zod';
import { deploymentIdSchema, epochMsSchema, githubIdSchema, repositoryFullNameSchema, tenantIdSchema } from '@runharbor/contracts';

const ownerSchema = z.object({ id: githubIdSchema, login: z.string().min(1), type: z.enum(['User', 'Organization']) }).strict();
const repositorySchema = z.object({ id: githubIdSchema, fullName: repositoryFullNameSchema }).strict();
export const deploymentRecordSchema = z.object({
  pk: z.literal('DEPLOYMENT'), sk: z.literal('#'), kind: z.literal('deployment'), schema: z.literal(1),
  revision: z.number().int().nonnegative(), createdAt: epochMsSchema, updatedAt: epochMsSchema,
  deploymentId: deploymentIdSchema, tenantId: tenantIdSchema,
  github: z.object({ appId: githubIdSchema, appSlug: z.string().min(1), installationId: githubIdSchema, owner: ownerSchema, repositories: z.array(repositorySchema) }).strict(),
  ssmParameterName: z.string().min(1), activatedAt: epochMsSchema.optional(),
  saasActivation: z.object({ status: z.enum(['pending', 'active', 'failed']), lastAttemptAt: epochMsSchema, lastErrorCode: z.string().min(1).optional() }).strict(),
}).strict();
export type DeploymentRecord = z.infer<typeof deploymentRecordSchema>;
