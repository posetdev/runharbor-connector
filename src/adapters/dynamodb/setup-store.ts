import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { installerHandoffSchema, installerSessionSchema, installerTicketSchema, setupSessionSchema, transitionSetupSession, type InstallerHandoff, type InstallerSession, type InstallerTicket, type SetupSession, type SetupState } from '../../domain/setup.js';
import { ConditionalWriteError } from '../../ports/operation-store.js';
import type { SetupStore as SetupStorePort } from '../../ports/setup-store.js';
import { DynamoStore } from './store.js';

export class DynamoSetupStore implements SetupStorePort {
  private readonly store: DynamoStore;
  constructor(client: DynamoDBDocumentClient, tableName: string) { this.store = new DynamoStore(client, tableName); }
  createSession(record: SetupSession): Promise<SetupSession> { return this.store.put<SetupSession>(setupSessionSchema, record, { notExists: true }); }
  getSession(hash: string): Promise<SetupSession | undefined> { return this.store.get<SetupSession>(setupSessionSchema, { pk: `SETUP#${hash}`, sk: '#' }); }
  updateSession(record: SetupSession, patch: Partial<Omit<SetupSession, 'pk' | 'sk' | 'kind' | 'schema' | 'revision' | 'createdAt' | 'ttl'>>): Promise<SetupSession> {
    const next = setupSessionSchema.parse({ ...record, ...patch, revision: record.revision + 1, updatedAt: patch.updatedAt ?? Date.now() });
    const set = Object.fromEntries(Object.entries(next).filter(([field, value]) => field !== 'pk' && field !== 'sk' && value !== record[field as keyof SetupSession]));
    return this.store.update<SetupSession>(setupSessionSchema, { pk: record.pk, sk: '#' }, { set, candidate: next }, { revision: record.revision });
  }
  advanceSession(record: SetupSession, to: SetupState, patch: Partial<Omit<SetupSession, 'pk' | 'sk' | 'kind' | 'schema' | 'status' | 'revision' | 'createdAt' | 'ttl'>> = {}): Promise<SetupSession> {
    const next = transitionSetupSession(record, to, { ...patch, updatedAt: (patch.updatedAt ?? Date.now()) as SetupSession['updatedAt'] });
    const set = Object.fromEntries(Object.entries(next).filter(([field, value]) => field !== 'pk' && field !== 'sk' && value !== record[field as keyof SetupSession]));
    const remove = Object.keys(record).filter((field) => !(field in next) && field !== 'pk' && field !== 'sk');
    return this.store.update<SetupSession>(setupSessionSchema, { pk: record.pk, sk: '#' }, { set, remove, candidate: next }, { revision: record.revision });
  }
  createInstallerSession(record: InstallerSession): Promise<InstallerSession> { return this.store.put<InstallerSession>(installerSessionSchema, record, { notExists: true }); }
  updateInstallerSession(record: InstallerSession, patch: Partial<Omit<InstallerSession, 'pk' | 'sk' | 'kind' | 'schema' | 'revision' | 'createdAt' | 'ttl'>>): Promise<InstallerSession> { const next = { ...record, ...patch, revision: record.revision + 1, updatedAt: patch.updatedAt ?? Date.now() }; if (Object.hasOwn(patch, 'enrollmentToken') && patch.enrollmentToken === undefined) delete next.enrollmentToken; const candidate = installerSessionSchema.parse(next); return this.store.update<InstallerSession>(installerSessionSchema, { pk: record.pk, sk: '#' }, { set: Object.fromEntries(Object.entries(candidate).filter(([field, value]) => field !== 'pk' && field !== 'sk' && value !== record[field as keyof InstallerSession])), remove: Object.keys(record).filter((field) => !(field in candidate) && field !== 'pk' && field !== 'sk'), candidate }, { revision: record.revision }); }
  getInstallerSession(hash: string): Promise<InstallerSession | undefined> { return this.store.get<InstallerSession>(installerSessionSchema, { pk: `INSTALLER#${hash}`, sk: '#' }); }
  revokeInstallerSession(record: InstallerSession, revokedAt: InstallerSession['revokedAt']): Promise<InstallerSession> { const next = installerSessionSchema.parse({ ...record, revokedAt, updatedAt: Date.now(), revision: record.revision + 1 }); return this.store.update<InstallerSession>(installerSessionSchema, { pk: record.pk, sk: '#' }, { set: { revokedAt, updatedAt: next.updatedAt, revision: next.revision }, candidate: next }, { revision: record.revision }); }
  async consumeTicket(record: InstallerTicket): Promise<void> { await this.store.put<InstallerTicket>(installerTicketSchema, record, { notExists: true }); }
  createHandoff(record: InstallerHandoff): Promise<InstallerHandoff> { return this.store.put<InstallerHandoff>(installerHandoffSchema, record, { notExists: true }); }
  async consumeHandoff(codeHash: string, now: InstallerHandoff['consumedAt']): Promise<InstallerHandoff> { const current = await this.store.get<InstallerHandoff>(installerHandoffSchema, { pk: `HANDOFF#${codeHash}`, sk: '#' }); if (current === undefined) throw new ConditionalWriteError(); const candidate = installerHandoffSchema.parse({ ...current, consumedAt: now, updatedAt: now, revision: current.revision + 1 }); return this.store.update<InstallerHandoff>(installerHandoffSchema, { pk: current.pk, sk: '#' }, { set: { consumedAt: now, updatedAt: now, revision: candidate.revision }, candidate }, { custom: { expression: 'attribute_not_exists(#consumedAt) AND #expiresAt > :now', names: { '#consumedAt': 'consumedAt', '#expiresAt': 'expiresAt' }, values: { ':now': now } } }); }
}
