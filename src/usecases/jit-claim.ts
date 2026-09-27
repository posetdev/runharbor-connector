import type { EpochMs } from '@runharbor/contracts';
import { AppError } from '../domain/errors.js';
import type { Ec2Port } from '../ports/ec2.js';
import { ConditionalWriteError, type ClaimedJit, type OperationStore } from '../ports/operation-store.js';

/**
 * Instance identity is the IAM session name, the operation's recorded
 * instanceId and the instance's own runharbor:operation-id tag, all agreeing
 * (03 §C2); only then is the JIT config released, once.
 */
export async function claimJit(store: OperationStore, ec2: Ec2Port, instanceId: string, operationId: string, now: EpochMs): Promise<ClaimedJit> {
  const record = await store.get(operationId);
  if (record === undefined || record.instanceId !== instanceId) throw new AppError('NOT_FOUND');
  if (record.jitConfig === undefined) throw new AppError('ALREADY_CLAIMED');
  if (record.state !== 'ready') throw new AppError('IN_PROGRESS');
  const instance = await ec2.describeByInstanceId(instanceId);
  if (instance?.operationId !== operationId) throw new AppError('FORBIDDEN');
  try {
    return await store.claimJit(operationId, instanceId, now);
  } catch (error) {
    if (error instanceof ConditionalWriteError) throw new AppError('ALREADY_CLAIMED');
    throw error;
  }
}
