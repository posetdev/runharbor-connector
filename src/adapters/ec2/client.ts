import { DescribeInstancesCommand, RunInstancesCommand, TerminateInstancesCommand, type DescribeInstancesCommandOutput, type Instance } from '@aws-sdk/client-ec2';
import { parseRunnerLabelSpec, type EpochMs } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import type { Ec2Port, ManagedInstance } from '../../ports/ec2.js';
import { describeClientTokens, runInstancesInput, type LaunchImage, type PurchaseMode } from './launch-params.js';

export interface Ec2ClientLike {
  send(command: RunInstancesCommand | DescribeInstancesCommand | TerminateInstancesCommand): Promise<unknown>;
}

export type Ec2Settings = Readonly<{
  deploymentId: string; region: string; runnerFunctionUrl?: string;
  images: Readonly<Partial<Record<'x64' | 'arm64', LaunchImage>>>;
  subnetIds: readonly string[]; securityGroupId: string; instanceProfileArn: string; purchaseMode: PurchaseMode;
}>;

/** InsufficientInstanceCapacity is also how Spot reports "no Spot capacity" for RunInstances. */
const CAPACITY_ERROR_NAMES = new Set(['InsufficientInstanceCapacity', 'InsufficientHostCapacity', 'UnfulfillableCapacity']);

const LIVE_STATES = ['pending', 'running', 'stopping', 'stopped'];
const NOT_FOUND = new Set(['InvalidInstanceID.NotFound', 'InvalidInstanceID.Malformed']);
const CLIENT_TOKEN = /^[0-9a-f]{64}$/;

export class Ec2Adapter implements Ec2Port {
  constructor(private readonly client: Ec2ClientLike, private readonly settings: Ec2Settings) {}

  /** `token` is the operation id's 64 hex, so the operation-id tag is `op_<token>`. The EC2 ClientToken is derived per subnet. */
  async runInstances(token: string, runnerLabel: string, instanceType: string): Promise<{ instanceId: string }> {
    if (!CLIENT_TOKEN.test(token)) throw new AppError('INTERNAL');
    const spec = parseRunnerLabelSpec(runnerLabel);
    if (spec === undefined) throw new AppError('FORBIDDEN');
    const image = this.settings.images[spec.architecture];
    if (image === undefined) throw new AppError('FORBIDDEN');
    // Launching is the only thing that needs the runner's claim URL, and only the start Lambda
    // launches. The runner Lambda's own config omits it (it would be its own URL), so demanding it
    // when the adapter is built breaks every runner request; a start deployment missing it is still
    // a packaging error, and still fails here before any instance exists.
    const { runnerFunctionUrl } = this.settings;
    if (runnerFunctionUrl === undefined) throw new AppError('INTERNAL');
    const purchaseMode = spec.purchaseModeOverride ?? this.settings.purchaseMode;
    if (this.settings.subnetIds.length === 0) throw new AppError('INTERNAL');
    let lastError: unknown;
    for (let index = 0; index < this.settings.subnetIds.length; index += 1) {
      const subnetId = this.settings.subnetIds[index];
      if (subnetId === undefined) throw new AppError('INTERNAL');
      const input = runInstancesInput({ operationId: `op_${token}`, deploymentId: this.settings.deploymentId, runnerLabel, instanceType, image, subnetId, securityGroupId: this.settings.securityGroupId, instanceProfileArn: this.settings.instanceProfileArn, region: this.settings.region, runnerFunctionUrl, purchaseMode });
      try {
        const output = await this.send(new RunInstancesCommand(input)) as { Instances?: Instance[] };
        const instanceId = output.Instances?.[0]?.InstanceId;
        if (instanceId === undefined) throw new AppError('UPSTREAM_UNAVAILABLE');
        return { instanceId };
      } catch (error) {
        const moreSubnets = index < this.settings.subnetIds.length - 1;
        if (moreSubnets && isCapacityError(error)) { lastError = error; continue; }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new AppError('UPSTREAM_UNAVAILABLE');
  }

  async describeByClientToken(token: string): Promise<ManagedInstance | undefined> {
    const instances = (await this.describe({ Filters: [{ Name: 'client-token', Values: describeClientTokens(token, this.settings.subnetIds) }] })).flatMap(managed);
    return instances.find((instance) => instance.state !== 'terminated') ?? instances[0];
  }

  async describeByInstanceId(instanceId: string): Promise<ManagedInstance | undefined> {
    const [instance] = await this.describeInstance(instanceId);
    return instance === undefined ? undefined : managed(instance)[0];
  }

  /**
   * Terminates only an instance tagged with this deployment id (04 §1); the
   * timeout role's IAM condition on the same tag is the second guard. An
   * instance already gone is not an error.
   */
  async terminate(instanceId: string, deploymentId: string): Promise<void> {
    const [instance] = await this.describeInstance(instanceId);
    if (instance === undefined || instance.State?.Name === 'terminated') return;
    if (tagValue(instance, 'runharbor:deployment-id') !== deploymentId) throw new AppError('FORBIDDEN');
    try {
      await this.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
    } catch (error) {
      if (error instanceof AppError && NOT_FOUND.has(causeName(error.cause))) return;
      throw error;
    }
  }

  async listManaged(deploymentId: string): Promise<readonly ManagedInstance[]> {
    return (await this.describe({ Filters: [
      { Name: 'tag:runharbor:managed', Values: ['true'] },
      { Name: 'tag:runharbor:deployment-id', Values: [deploymentId] },
      { Name: 'instance-state-name', Values: LIVE_STATES },
    ] })).flatMap(managed);
  }

  private async describeInstance(instanceId: string): Promise<Instance[]> {
    try {
      return await this.describe({ InstanceIds: [instanceId] });
    } catch (error) {
      if (error instanceof AppError && NOT_FOUND.has(causeName(error.cause))) return [];
      throw error;
    }
  }

  private async describe(input: Omit<DescribeInstancesCommand['input'], 'NextToken'>): Promise<Instance[]> {
    const instances: Instance[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.send(new DescribeInstancesCommand({ ...input, NextToken: nextToken })) as DescribeInstancesCommandOutput;
      for (const reservation of page.Reservations ?? []) instances.push(...reservation.Instances ?? []);
      nextToken = page.NextToken;
    } while (nextToken !== undefined && nextToken !== '');
    return instances;
  }

  private async send(command: RunInstancesCommand | DescribeInstancesCommand | TerminateInstancesCommand): Promise<unknown> {
    try {
      return await this.client.send(command);
    } catch (error) {
      // Every EC2 failure is retried by the caller's queue; the timeout schedule bounds the damage.
      throw new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
    }
  }
}

/** An instance without the operation-id tag is not one RunHarbor launched, so it is never reported as managed. */
function managed(instance: Instance): ManagedInstance[] {
  const operationId = tagValue(instance, 'runharbor:operation-id');
  if (instance.InstanceId === undefined || instance.State?.Name === undefined || operationId === undefined) return [];
  return [{
    instanceId: instance.InstanceId, operationId, state: instance.State.Name,
    ...(instance.LaunchTime === undefined ? {} : { launchedAt: instance.LaunchTime.getTime() as EpochMs }),
  }];
}

function tagValue(instance: Instance, key: string): string | undefined {
  return instance.Tags?.find((item) => item.Key === key)?.Value;
}

function causeName(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'name' in cause && typeof cause.name === 'string' ? cause.name : '';
}

function isCapacityError(error: unknown): boolean {
  const cause = error instanceof AppError ? error.cause : error;
  if (CAPACITY_ERROR_NAMES.has(causeName(cause))) return true;
  const message = cause instanceof Error ? cause.message : '';
  return /no Spot capacity available/i.test(message);
}
