import type { Clock } from '../domain/clock.js';
import { AppError } from '../domain/errors.js';
import { ec2ClientToken, isInstanceGone, isTerminal, terminalTtl, type OperationPatch, type OperationRecord, type OperationState } from '../domain/operation.js';
import type { Ec2Port } from '../ports/ec2.js';
import { ConditionalWriteError, type OperationStore } from '../ports/operation-store.js';
import { silentLogger, type UsecaseLogger } from './log.js';

/**
 * Runs at an operation's timeoutAt (D3). An instance that is already gone
 * ended on its own: a `ready` operation becomes `done`. Anything still
 * running is terminated (only under this deployment's tag) and the operation
 * becomes `failed(timeout)`. An operation that never reached `ready` cannot
 * become `done` (04 §1.1), so it also ends as `failed(timeout)`. A terminal
 * operation is returned unchanged.
 */
export async function timeoutOperation(
  operationId: string,
  operationStore: OperationStore,
  ec2: Ec2Port,
  clock: Clock,
  log: UsecaseLogger = silentLogger,
): Promise<OperationRecord> {
  const record = await operationStore.get(operationId);
  if (record === undefined) throw new AppError('NOT_FOUND');
  if (isTerminal(record.state)) return record;
  const now = clock.now();
  if (record.timeoutAt > now) throw new AppError('IN_PROGRESS');
  const instance = record.instanceId === undefined
    ? await ec2.describeByClientToken(ec2ClientToken(operationId))
    : await ec2.describeByInstanceId(record.instanceId);
  if (instance === undefined || isInstanceGone(instance)) {
    return record.state === 'ready'
      ? save(operationStore, clock, record, 'done', { terminatedAt: now, ttl: terminalTtl(now) })
      : save(operationStore, clock, record, 'failed', { terminalReason: 'timeout', ttl: terminalTtl(now) });
  }
  await ec2.terminate(instance.instanceId, record.deploymentId);
  log.info('timeout_instance_terminated', { operationId, instanceId: instance.instanceId, state: record.state });
  return save(operationStore, clock, record, 'failed', { terminalReason: 'timeout', terminatedAt: now, ttl: terminalTtl(now), instanceId: instance.instanceId });
}

async function save(store: OperationStore, clock: Clock, record: OperationRecord, to: OperationState, patch: OperationPatch): Promise<OperationRecord> {
  try {
    return await store.advance(record, to, { ...patch, updatedAt: clock.now() });
  } catch (error) {
    // start moved the operation meanwhile; the invocation is retried and re-reads it.
    if (error instanceof ConditionalWriteError) throw new AppError('IN_PROGRESS');
    throw error;
  }
}
