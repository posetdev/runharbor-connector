import type { EpochMs } from '@runharbor/contracts';

export type ManagedInstance = Readonly<{
  instanceId: string;
  operationId: string;
  state: string;
  launchedAt?: EpochMs;
}>;

export interface Ec2Port {
  /** 04-data-model.md §1: launch idempotently. The EC2 ClientToken is per subnet, derived from operationId.slice(3, 67), so an AZ retry is not a replay. */
  runInstances(clientToken: string, runnerLabel: string, instanceType: string): Promise<{ instanceId: string }>;

  /** 04-data-model.md §1: recover a possibly-created instance through EC2's client-token filter. */
  describeByClientToken(clientToken: string): Promise<ManagedInstance | undefined>;

  /** 01-architecture.md §3 step 6: inspect the instance associated with an operation. */
  describeByInstanceId(instanceId: string): Promise<ManagedInstance | undefined>;

  /** 04-data-model.md §1: terminate only when runharbor:deployment-id equals deploymentId. */
  terminate(instanceId: string, deploymentId: string): Promise<void>;

  /** 01-architecture.md §3 step 9: list only instances constrained by runharbor:deployment-id. */
  listManaged(deploymentId: string): Promise<readonly ManagedInstance[]>;
}
