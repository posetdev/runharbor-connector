import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { EpochMs } from '@runharbor/contracts';
import { operationRecordSchema, transition, type OperationPatch, type OperationRecord, type OperationState } from '../../domain/operation.js';
import { ConditionalWriteError, type ClaimedJit, type OperationListEntry, type OperationStore as OperationStorePort } from '../../ports/operation-store.js';
import { DynamoStore, type DynamoCondition } from './store.js';

export type ClaimJitConditionOptions = Readonly<{ requireJitConfig?: boolean; requireInstanceId?: boolean; requireReadyState?: boolean }>;
export function claimJitCondition(instanceId: string, options: ClaimJitConditionOptions = {}): DynamoCondition {
  const { requireJitConfig = true, requireInstanceId = true, requireReadyState = true } = options;
  const names: Record<string, string> = {}; const values: Record<string, unknown> = {};
  const clauses = [requireJitConfig ? (names['#jitConfig'] = 'jitConfig', 'attribute_exists(#jitConfig)') : '', requireInstanceId ? (names['#instanceId'] = 'instanceId', values[':caller'] = instanceId, '#instanceId = :caller') : '', requireReadyState ? (names['#state'] = 'state', values[':ready'] = 'ready', '#state = :ready') : ''].filter(Boolean);
  return { custom: { expression: clauses.join(' AND '), names, values } };
}

export class DynamoOperationStore implements OperationStorePort {
  private readonly store: DynamoStore;
  constructor(client: DynamoDBDocumentClient, private readonly tableName: string) { this.store = new DynamoStore(client, tableName); this.client = client; }
  private readonly client: DynamoDBDocumentClient;

  create(record: OperationRecord): Promise<OperationRecord> { return this.store.put<OperationRecord>(operationRecordSchema, record, { notExists: true }); }
  get(operationId: string): Promise<OperationRecord | undefined> { return this.store.get<OperationRecord>(operationRecordSchema, key(operationId)); }

  async advance(record: OperationRecord, to: OperationState, patch: OperationPatch = {}): Promise<OperationRecord> {
    const next = transition(record, to, { ...patch, updatedAt: (patch.updatedAt ?? Date.now()) as EpochMs });
    const update = changed(record, next);
    return this.store.update<OperationRecord>(operationRecordSchema, key(operationId(record)), { ...update, candidate: next }, { revision: record.revision });
  }

  async claimJit(operationId: string, instanceId: string, now: EpochMs): Promise<ClaimedJit> {
    const current = await this.get(operationId);
    if (current?.jitConfig === undefined) throw new ConditionalWriteError();
    const candidate = operationRecordSchema.parse({ ...current, jitConfig: undefined, jitClaimedAt: now, updatedAt: now, revision: current.revision + 1 });
    const next = await this.store.update<OperationRecord>(operationRecordSchema, key(operationId), { set: { jitClaimedAt: now, updatedAt: now }, remove: ['jitConfig'], add: { revision: 1 }, candidate }, claimJitCondition(instanceId));
    return { operationId, runnerName: next.runnerName, encodedJitConfig: current.jitConfig };
  }

  listRecent(limit: number): Promise<readonly OperationListEntry[]> { return this.list(limit); }
  listNonTerminal(): Promise<readonly OperationListEntry[]> { return this.list(100, true); }
  private async list(limit: number, nonTerminal = false): Promise<readonly OperationListEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid limit');
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName, IndexName: 'gsi1', KeyConditionExpression: '#gsi1pk = :operation', ExpressionAttributeNames: { '#gsi1pk': 'gsi1pk' }, ExpressionAttributeValues: { ':operation': 'OP' }, ScanIndexForward: false, Limit: limit }));
    const records = await Promise.all((response.Items ?? []).map((item) => this.store.get<OperationRecord>(operationRecordSchema, { pk: String(item.pk), sk: '#' })));
    return records.flatMap((record) => record !== undefined && (!nonTerminal || (record.state !== 'done' && record.state !== 'failed')) ? [{ operationId: operationId(record), state: record.state, instanceId: record.instanceId, timeoutAt: record.timeoutAt, createdAt: record.createdAt }] : []);
  }
}

function key(operationId: string): Record<string, string> { return { pk: `OP#${operationId}`, sk: '#' }; }
function operationId(record: OperationRecord): string { return record.pk.slice(3); }
function changed(before: OperationRecord, after: OperationRecord) {
  const ignored = new Set(['pk', 'sk']); const set: Record<string, unknown> = {}; const remove: string[] = [];
  for (const [field, value] of Object.entries(after)) if (!ignored.has(field) && value !== before[field as keyof OperationRecord]) set[field] = value;
  for (const field of Object.keys(before)) if (!(field in after) && !ignored.has(field)) remove.push(field);
  return { set, remove };
}
