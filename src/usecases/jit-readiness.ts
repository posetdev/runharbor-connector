import type { OperationStore } from '../ports/operation-store.js';
import { AppError } from '../domain/errors.js';

export type JitReadiness = Readonly<{ operationId: string; status: 'pending' | 'ready' | 'terminal' }>;

export async function getJitReadiness(store: OperationStore, instanceId: string, operationId: string): Promise<JitReadiness> {
  const record = await store.get(operationId);
  if (record !== undefined && record.instanceId !== instanceId) throw new AppError('NOT_FOUND');
  const status = record?.state === 'ready' && record.jitConfig !== undefined
    ? 'ready'
    : record?.state === 'accepted' || record?.state === 'launched'
      ? 'pending'
      : 'terminal';
  return { operationId, status };
}
