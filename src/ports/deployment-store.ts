import type { DeploymentRecord } from '../domain/deployment.js';
export interface DeploymentStore {
  create(record: DeploymentRecord): Promise<DeploymentRecord>;
  get(): Promise<DeploymentRecord | undefined>;
  update(record: DeploymentRecord, patch: Partial<Omit<DeploymentRecord, 'pk' | 'sk' | 'kind' | 'schema' | 'revision' | 'createdAt'>>): Promise<DeploymentRecord>;
}
