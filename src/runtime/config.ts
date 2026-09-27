import { z } from 'zod';
import { awsAccountIdSchema, awsRegionSchema, deploymentIdSchema, githubAppOrganizationSchema, instanceTypeSchema, roleArnSchema, saasPublicKeySchema, tenantIdSchema } from '@runharbor/contracts';

const imageSchema = z.object({
  amiId: z.string().regex(/^ami-[0-9a-f]{8,17}$/),
  rootVolumeGiB: z.number().int().min(1),
  rootDeviceName: z.string().regex(/^\/dev\/[a-z][a-z0-9]{1,9}$/),
  maxDurationMs: z.number().int().positive(),
}).strict();

export const connectorConfigSchema = z.object({
  schema: z.literal(1),
  deploymentId: deploymentIdSchema,
  tenantId: tenantIdSchema,
  awsAccountId: awsAccountIdSchema,
  awsRegion: awsRegionSchema,
  tableName: z.string().min(3),
  githubAppParameterName: z.string().min(1),
  saasPublicKey: saasPublicKeySchema,
  giteeWorkflow: z.object({ workflowFile: z.string(), ref: z.string() }).strict().nullable().optional(),
  saasOrigin: z.string().url().refine((value) => {
    try {
      const origin = new URL(value);
      return origin.protocol === 'https:' && origin.username === '' && origin.password === '';
    } catch {
      return false;
    }
  }),
  webhookUrl: z.string().url(),
  githubAppOrganization: githubAppOrganizationSchema,
  runnerRoleArn: roleArnSchema,
  runnerClaimUrl: z.string().url().optional(),
  startFunctionUrl: z.string().url().optional(),
  installerPublicKey: z.string().min(1),
  timeoutFunctionArn: z.string().min(1).optional(),
  schedulerRoleArn: roleArnSchema.optional(),
  scheduleGroupName: z.string().min(1).optional(),
  subnetIds: z.array(z.string().regex(/^subnet-[0-9a-f]+$/)).min(1),
  securityGroupId: z.string().regex(/^sg-[0-9a-f]+$/),
  instanceProfileArn: z.string().regex(/^arn:aws:iam::[0-9]{12}:instance-profile\/[\w+=,.@/-]{1,512}$/),
  allowedInstanceTypes: z.array(instanceTypeSchema).min(1),
  // Where a deployment declares Spot or on-demand, so a customer who hits Spot
  // capacity trouble flips one Terraform variable instead of waiting for a
  // release. The variable's own default is `spot`, which is where the intent
  // belongs; this fallback only ever applies to a config JSON written before
  // the field existed, and such a deployment has not granted the Spot
  // service-linked-role statement either, so it keeps launching what it
  // launched yesterday rather than changing purchase mode on its own.
  purchaseMode: z.enum(['spot', 'on-demand']).default('on-demand'),
  images: z.record(z.enum(['x64', 'arm64']), imageSchema),
}).strict();
export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const raw = environment.RUNHARBOR_CONFIG;
  if (raw === undefined) throw new Error('RUNHARBOR_CONFIG is required');
  try {
    return connectorConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error('RUNHARBOR_CONFIG is invalid', { cause: error });
  }
}

export const config = loadConfig();
