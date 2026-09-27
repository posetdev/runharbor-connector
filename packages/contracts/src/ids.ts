import { z } from 'zod';

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
export type EpochMs = Brand<number, 'EpochMs'>;

export const patterns = {
  tenantId: /^[a-z0-9][a-z0-9-]{0,62}$/,
  deploymentId: /^dep_[0-9a-f]{24}$/,
  bindingKey: /^bk_[0-9a-f]{32}$/,
  enrollmentToken: /^et_[A-Za-z0-9_-]{43}$/,
  operationId: /^op_[0-9a-f]{64}$/,
  idempotencyKey: /^ik_[0-9a-f]{32}$/,
  runnerLabel: /^rh-(x64|arm64)-([1-9][0-9]{0,2})vcpu-([1-9][0-9]{0,3})gib(?:-(spot|on-demand|demand))?$/,
  instanceType: /^[a-z0-9-]+\.[a-z0-9-]+$/,
  label: /^[A-Za-z0-9_.-]{1,100}$/,
  githubId: /^[1-9][0-9]{0,15}$/,
  repositoryFullName: /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/,
  instanceId: /^i-[0-9a-f]{8,17}$/,
  awsAccountId: /^[0-9]{12}$/,
  awsRegion: /^[a-z]{2}(-[a-z]+)+-[0-9]$/,
  roleArn: /^arn:aws:iam::[0-9]{12}:role\/[\w+=,.@/-]{1,512}$/,
  commandId: /^cmd_[0-9a-fA-Za-z_-]{16,128}$/,
  commandKeyId: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  workflowFile: /^\.github\/workflows\/[A-Za-z0-9_.-]{1,100}\.ya?ml$/,
} as const;

export const tenantIdSchema = z.string().regex(patterns.tenantId);
export const deploymentIdSchema = z.string().regex(patterns.deploymentId);
export const bindingKeySchema = z.string().regex(patterns.bindingKey);
export const enrollmentTokenSchema = z.string().regex(patterns.enrollmentToken);
export const operationIdSchema = z.string().regex(patterns.operationId);
export const idempotencyKeySchema = z.string().regex(patterns.idempotencyKey);
export const runnerLabelSchema = z.string().regex(patterns.runnerLabel);
export const instanceTypeSchema = z.string().regex(patterns.instanceType);
export const labelSchema = z.string().regex(patterns.label);
export const githubIdSchema = z.string().regex(patterns.githubId);
export const repositoryFullNameSchema = z.string().regex(patterns.repositoryFullName);
export const instanceIdSchema = z.string().regex(patterns.instanceId);
export const awsAccountIdSchema = z.string().regex(patterns.awsAccountId);
export const awsRegionSchema = z.string().regex(patterns.awsRegion);
export const roleArnSchema = z.string().regex(patterns.roleArn);
/**
 * X-GitHub-Delivery is a UUID whose version is GitHub's business, not ours: deliveries arrive
 * stamped with time-based (v1) GUIDs. Pinning the version and variant nibbles to v4 rejected every
 * webhook GitHub sent. The value is a DynamoDB sort key, so the shape and lowercase form stay
 * pinned; the version does not.
 */
export const deliveryIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const epochMsSchema = z.number().int().safe().transform((value) => value as EpochMs);
export const runAttemptSchema = z.number().int().min(1).max(1000);
export const gitRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/);
export const commandIdSchema = z.string().regex(patterns.commandId);
export const commandKeyIdSchema = z.string().regex(patterns.commandKeyId);
export const workflowFileSchema = z.string().regex(patterns.workflowFile);

export const functionUrlSchema = z.string().url().refine((value) => /^https:\/\/([a-z0-9]{26}|[a-z0-9]{32})\.lambda-url\.([a-z]{2}(?:-[a-z]+)+-[0-9])\.on\.aws\/$/.test(value));

export type RunnerArchitecture = 'x64' | 'arm64';
export type RunnerPurchaseMode = 'spot' | 'on-demand';
export type RunnerLabelSpec = Readonly<{
  architecture: RunnerArchitecture;
  vcpu: number;
  memGiB: number;
  purchaseModeOverride?: RunnerPurchaseMode;
}>;

/** Parses the public runner label and normalizes both on-demand suffixes. */
export function parseRunnerLabelSpec(runnerLabel: string): RunnerLabelSpec | undefined {
  const match = patterns.runnerLabel.exec(runnerLabel);
  if (match === null) return undefined;
  const suffix = match[4];
  const purchaseModeOverride: RunnerPurchaseMode | undefined = suffix === 'spot' ? 'spot' : suffix === undefined ? undefined : 'on-demand';
  return {
    architecture: match[1] as RunnerArchitecture,
    vcpu: Number(match[2]),
    memGiB: Number(match[3]),
    ...(purchaseModeOverride === undefined ? {} : { purchaseModeOverride }),
  };
}

export type TenantId = z.infer<typeof tenantIdSchema>;
export type DeploymentId = z.infer<typeof deploymentIdSchema>;
export type OperationId = z.infer<typeof operationIdSchema>;
export type CommandId = z.infer<typeof commandIdSchema>;
