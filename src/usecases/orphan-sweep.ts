import type { Clock } from '../domain/clock.js';
import { AppError } from '../domain/errors.js';
import { isTerminal } from '../domain/operation.js';
import type { Ec2Port } from '../ports/ec2.js';
import type { OperationStore } from '../ports/operation-store.js';
import { errorFields, silentLogger, type UsecaseLogger } from './log.js';
import { timeoutOperation } from './timeout-operation.js';

/** `deploymentId` comes from config, not from table records: instances with no record at all are the costliest orphans. */
export type SweepContext = Clock & Readonly<{ deploymentId: string }>;

/**
 * Hourly second line of defence (D3). Non-terminal operations past timeoutAt
 * go through timeout; instances tagged with this deployment whose operation
 * is missing or terminal are terminated. Each instance is terminated at most
 * once per sweep. A failure does not stop the rest of the sweep; the first
 * one is rethrown at the end so the invocation is retried.
 */
export async function orphanSweep(
  operationStore: OperationStore,
  ec2: Ec2Port,
  context: SweepContext,
  log: UsecaseLogger = silentLogger,
): Promise<void> {
  const now = context.now();
  const terminated = new Set<string>();
  const once = terminatingOnce(ec2, terminated);
  const attempted = new Set<string>();
  const failures: unknown[] = [];
  let timedOut = 0;

  const timeout = async (operationId: string) => {
    if (attempted.has(operationId)) return;
    attempted.add(operationId);
    try {
      await timeoutOperation(operationId, operationStore, once, context, log);
      timedOut += 1;
    } catch (error) {
      failures.push(error);
      log.info('sweep_timeout_failed', { operationId, ...errorFields(error) });
    }
  };

  for (const entry of await operationStore.listNonTerminal()) {
    if (entry.timeoutAt <= now) await timeout(entry.operationId);
  }
  for (const instance of await ec2.listManaged(context.deploymentId)) {
    if (terminated.has(instance.instanceId)) continue;
    try {
      const record = await operationStore.get(instance.operationId);
      if (record !== undefined && !isTerminal(record.state)) {
        // listNonTerminal only sees recent operations; the instance tag reaches the rest.
        if (record.timeoutAt <= now) await timeout(instance.operationId);
        continue;
      }
      await once.terminate(instance.instanceId, context.deploymentId);
      log.info('orphan_instance_terminated', { instanceId: instance.instanceId, operationId: instance.operationId, state: record?.state ?? 'missing' });
    } catch (error) {
      failures.push(error);
      log.info('sweep_terminate_failed', { instanceId: instance.instanceId, ...errorFields(error) });
    }
  }
  log.info('orphan_sweep_done', { timedOut, terminated: terminated.size, failures: failures.length });
  if (failures.length > 0) throw AppError.from(failures[0]);
}

function terminatingOnce(ec2: Ec2Port, terminated: Set<string>): Ec2Port {
  return {
    runInstances: (clientToken, runnerLabel, instanceType) => ec2.runInstances(clientToken, runnerLabel, instanceType),
    describeByClientToken: (clientToken) => ec2.describeByClientToken(clientToken),
    describeByInstanceId: (instanceId) => ec2.describeByInstanceId(instanceId),
    listManaged: (deploymentId) => ec2.listManaged(deploymentId),
    terminate: async (instanceId, deploymentId) => {
      if (terminated.has(instanceId)) return;
      await ec2.terminate(instanceId, deploymentId);
      terminated.add(instanceId);
    },
  };
}
