import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { deploymentRecordSchema, type DeploymentRecord } from '../../domain/deployment.js';
import type { DeploymentStore as DeploymentStorePort } from '../../ports/deployment-store.js';
import { DynamoStore } from './store.js';

export class DynamoDeploymentStore implements DeploymentStorePort {
  private readonly store: DynamoStore;
  constructor(client: DynamoDBDocumentClient, tableName: string) { this.store = new DynamoStore(client, tableName); }
  create(record: DeploymentRecord): Promise<DeploymentRecord> { return this.store.put<DeploymentRecord>(deploymentRecordSchema, record, { notExists: true }); }
  get(): Promise<DeploymentRecord | undefined> { return this.store.get<DeploymentRecord>(deploymentRecordSchema, { pk: 'DEPLOYMENT', sk: '#' }); }
  update(record: DeploymentRecord, patch: Partial<Omit<DeploymentRecord, 'pk' | 'sk' | 'kind' | 'schema' | 'revision' | 'createdAt'>>): Promise<DeploymentRecord> {
    const next = deploymentRecordSchema.parse({ ...record, ...patch, revision: record.revision + 1, updatedAt: patch.updatedAt ?? Date.now() });
    const set = Object.fromEntries(Object.entries(next).filter(([field, value]) => field !== 'pk' && field !== 'sk' && value !== record[field as keyof DeploymentRecord]));
    return this.store.update<DeploymentRecord>(deploymentRecordSchema, { pk: 'DEPLOYMENT', sk: '#' }, { set, candidate: next }, { revision: record.revision });
  }
}
