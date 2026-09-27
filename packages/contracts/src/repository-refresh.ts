import { z } from 'zod';
import { deploymentIdSchema, githubIdSchema, repositoryFullNameSchema } from './ids.js';

const repositorySchema = z.object({ id: githubIdSchema, fullName: repositoryFullNameSchema }).strict();

/** A SaaS-initiated, Connector-authoritative refresh of the GitHub App installation scope. */
export const repositoryRefreshRequestSchema = z.object({
  apiVersion: z.literal('runharbor.repository-refresh.v1'),
  deploymentId: deploymentIdSchema,
}).strict();
export type RepositoryRefreshRequest = z.infer<typeof repositoryRefreshRequestSchema>;

/** No credential or source data crosses this boundary: only GitHub repository identities. */
export const repositoryRefreshResponseSchema = z.object({
  apiVersion: z.literal('runharbor.repository-refresh.v1'),
  deploymentId: deploymentIdSchema,
  github: z.object({ installationId: githubIdSchema, repositories: z.array(repositorySchema).min(1).max(1_000) }).strict(),
}).strict();
export type RepositoryRefreshResponse = z.infer<typeof repositoryRefreshResponseSchema>;
