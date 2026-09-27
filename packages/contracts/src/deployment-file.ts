import { z } from 'zod';
import { saasPublicKeySchema } from './command-keys.js';
import { bindingKeySchema, deploymentIdSchema, enrollmentTokenSchema, epochMsSchema, githubIdSchema, labelSchema, tenantIdSchema } from './ids.js';

/**
 * The organization that owns the customer-created GitHub App. It is verified
 * by the SaaS against GitHub before issuing C5, then checked again against the
 * Manifest conversion response in the customer's Connector.
 */
export const githubAppOrganizationSchema = z.object({
  id: githubIdSchema,
  login: labelSchema,
  type: z.literal('Organization'),
}).strict();

export const deploymentFileSchema = z.object({
  apiVersion: z.literal('runharbor.deployment.v2'),
  tenantId: tenantIdSchema,
  deploymentId: deploymentIdSchema,
  bindingKey: bindingKeySchema,
  webhookUrl: z.string().url(),
  saasOrigin: z.string().url(),
  saasPublicKey: saasPublicKeySchema,
  githubAppOrganization: githubAppOrganizationSchema,
  enrollmentToken: enrollmentTokenSchema,
  enrollmentExpiresAt: epochMsSchema,
}).strict();
