import { systemClock } from '../domain/clock.js';
import { AppError } from '../domain/errors.js';
import { composeTimeout } from '../runtime/compose.js';
import { config } from '../runtime/config.js';
import { log } from '../runtime/logger.js';
import { parseScheduledEvent, type ScheduledEvent } from '../runtime/scheduled.js';
import { orphanSweep } from '../usecases/orphan-sweep.js';
import { timeoutOperation } from '../usecases/timeout-operation.js';

/** Scheduler delivers `{operationId}`; the hourly rule delivers `{mode:"sweep"}`. A throw lets Lambda retry. */
export async function handler(event: unknown): Promise<void> {
  let scheduled: ScheduledEvent;
  try {
    scheduled = parseScheduledEvent(event);
  } catch {
    // A malformed event never becomes valid on retry.
    log.info('timeout_invalid_event');
    return;
  }
  const deps = composeTimeout();
  if (!('operationId' in scheduled)) {
    await orphanSweep(deps.operations, deps.ec2, { now: () => systemClock.now(), deploymentId: config.deploymentId }, log);
    return;
  }
  const { operationId } = scheduled;
  try {
    const record = await timeoutOperation(operationId, deps.operations, deps.ec2, systemClock, log);
    log.info('timeout_handled', { operationId, state: record.state });
  } catch (error) {
    // No operation will ever appear under this id; retrying cannot help. IN_PROGRESS and the rest are retried.
    if (error instanceof AppError && error.code === 'NOT_FOUND') {
      log.info('timeout_operation_missing', { operationId });
      return;
    }
    throw error;
  }
}
