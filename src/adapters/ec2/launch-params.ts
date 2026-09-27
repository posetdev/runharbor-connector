import { createHash } from 'node:crypto';
import type { RunInstancesCommandInput } from '@aws-sdk/client-ec2';
import { ec2ClientToken } from '../../domain/operation.js';
import { renderLinuxX64UserData } from './user-data.js';

export type LaunchImage = Readonly<{
  amiId: string; rootVolumeGiB: number; rootDeviceName: string;
}>;

/** How the instance is bought. Spot is the default; see `runInstancesInput`. */
export type PurchaseMode = 'spot' | 'on-demand';

/**
 * EC2's ClientToken is at most 64 characters, and the operation id already
 * uses all 64 of them. Reusing that token for a second subnet makes AWS treat
 * the call as a replay and reject the new SubnetId
 * (`IdempotentParameterMismatch`). Each subnet therefore gets its own token:
 * SHA-256 of the operation token and the subnet id. The same pair still
 * replays; a different subnet does not.
 */
export function subnetClientToken(operationToken: string, subnetId: string): string {
  return createHash('sha256').update(`${operationToken}\n${subnetId}`).digest('hex');
}

/** Caller recovery still holds the operation's 64 hex. Fan it out to every subnet token the launch may have used. */
export function describeClientTokens(operationToken: string, subnetIds: readonly string[]): string[] {
  return [operationToken, ...subnetIds.map((subnetId) => subnetClientToken(operationToken, subnetId))];
}

export type LaunchInput = Readonly<{
  operationId: string; deploymentId: string; runnerLabel: string; instanceType: string; image: LaunchImage;
  subnetId: string; securityGroupId: string; instanceProfileArn: string;
  region: string; runnerFunctionUrl: string; purchaseMode: PurchaseMode;
}>;

/** The RunHarbor-owned tag set (02 §3); requests can never add to or override it. */
export function ownershipTags(input: Pick<LaunchInput, 'operationId' | 'deploymentId' | 'runnerLabel'>): { Key: string; Value: string }[] {
  return [
    { Key: 'runharbor:deployment-id', Value: input.deploymentId },
    { Key: 'runharbor:managed', Value: 'true' },
    { Key: 'runharbor:operation-id', Value: input.operationId },
    { Key: 'runharbor:runner-label', Value: input.runnerLabel },
  ];
}

export function runInstancesInput(input: LaunchInput): RunInstancesCommandInput {
  const tags = ownershipTags(input);
  const userData = renderLinuxX64UserData({ region: input.region, runnerFunctionUrl: input.runnerFunctionUrl, operationId: input.operationId });
  return {
    ImageId: input.image.amiId,
    InstanceType: input.instanceType as RunInstancesCommandInput['InstanceType'],
    MinCount: 1,
    MaxCount: 1,
    ClientToken: subnetClientToken(ec2ClientToken(input.operationId), input.subnetId),
    SubnetId: input.subnetId,
    SecurityGroupIds: [input.securityGroupId],
    IamInstanceProfile: { Arn: input.instanceProfileArn },
    MetadataOptions: { HttpEndpoint: 'enabled', HttpTokens: 'required', HttpPutResponseHopLimit: 1, InstanceMetadataTags: 'disabled' },
    // A block device mapping matches the root volume by device name, and that
    // name belongs to the image, not to its architecture: Ubuntu noble is
    // /dev/sda1 on both amd64 and arm64, Amazon Linux 2023 is /dev/xvda on both.
    // Naming the wrong one fails nothing — EC2 attaches an extra volume and
    // leaves the real root at the AMI's own size, so rootVolumeGiB quietly stops
    // applying. Terraform therefore reads this off the AMI (module locals.tf).
    BlockDeviceMappings: [{
      DeviceName: input.image.rootDeviceName,
      Ebs: { DeleteOnTermination: true, Encrypted: true, VolumeSize: input.image.rootVolumeGiB, VolumeType: 'gp3' },
    }],
    TagSpecifications: [{ ResourceType: 'instance', Tags: tags }, { ResourceType: 'volume', Tags: tags }],
    // A runner is one job on a machine that powers itself off afterwards, so a
    // one-time Spot request covers the whole lifecycle: nothing wants the
    // request to outlive the instance, and terminating on interruption is the
    // only interruption behaviour a one-time request may have anyway -- stop
    // and hibernate need a persistent request, which would re-launch a runner
    // whose job is already gone. Measured in ap-southeast-2 this is 43-49% off
    // on-demand for c7g, which is also what the pool these runners replace was
    // already paying: launching on-demand here would have been a regression,
    // not a saving. `on-demand` stays reachable by configuration because a Spot
    // launch can be refused for capacity, and there is nothing between that
    // refusal and a job that queues until its timeout.
    ...(input.purchaseMode === 'spot' ? {
      InstanceMarketOptions: { MarketType: 'spot', SpotOptions: { SpotInstanceType: 'one-time', InstanceInterruptionBehavior: 'terminate' } },
    } : {}),
    // The bootstrap powers the guest off after its one job; EC2 must terminate, not stop, it (D4).
    InstanceInitiatedShutdownBehavior: 'terminate',
    // EC2 Query's UserData is a String shape, so the SDK sends this base64 unchanged.
    UserData: Buffer.from(userData, 'utf8').toString('base64'),
  };
}
