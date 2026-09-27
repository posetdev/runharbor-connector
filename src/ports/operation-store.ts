import type { EpochMs } from '@runharbor/contracts';
import type { OperationPatch, OperationRecord, OperationState } from '../domain/operation.js';

export type OperationListEntry = Readonly<{ operationId: string; state: OperationState; instanceId?: string; timeoutAt: EpochMs; createdAt: EpochMs }>;
export type ClaimedJit = Readonly<{ operationId: string; runnerName: string; encodedJitConfig: string }>;
export interface OperationStore {
  create(record: OperationRecord): Promise<OperationRecord>;
  get(operationId: string): Promise<OperationRecord | undefined>;
  advance(record: OperationRecord, to: OperationState, patch?: OperationPatch): Promise<OperationRecord>;
  claimJit(operationId: string, instanceId: string, now: EpochMs): Promise<ClaimedJit>;
  listRecent(limit: number): Promise<readonly OperationListEntry[]>;
  listNonTerminal(): Promise<readonly OperationListEntry[]>;
}

export class ConditionalWriteError extends Error { constructor() { super('conditional write failed'); this.name = 'ConditionalWriteError'; } }
