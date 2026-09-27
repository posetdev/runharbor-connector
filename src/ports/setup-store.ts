import type { InstallerHandoff, InstallerSession, InstallerTicket, SetupSession, SetupState } from '../domain/setup.js';
export interface SetupStore {
  createSession(record: SetupSession): Promise<SetupSession>;
  getSession(stateHash: string): Promise<SetupSession | undefined>;
  updateSession(record: SetupSession, patch: Partial<Omit<SetupSession, 'pk' | 'sk' | 'kind' | 'schema' | 'revision' | 'createdAt' | 'ttl'>>): Promise<SetupSession>;
  advanceSession(record: SetupSession, to: SetupState, patch?: Partial<Omit<SetupSession, 'pk' | 'sk' | 'kind' | 'schema' | 'status' | 'revision' | 'createdAt' | 'ttl'>>): Promise<SetupSession>;
  createInstallerSession(record: InstallerSession): Promise<InstallerSession>;
  updateInstallerSession(record: InstallerSession, patch: Partial<Omit<InstallerSession, 'pk' | 'sk' | 'kind' | 'schema' | 'revision' | 'createdAt' | 'ttl'>>): Promise<InstallerSession>;
  getInstallerSession(sessionHash: string): Promise<InstallerSession | undefined>;
  revokeInstallerSession(record: InstallerSession, revokedAt: InstallerSession['revokedAt']): Promise<InstallerSession>;
  consumeTicket(record: InstallerTicket): Promise<void>;
  createHandoff(record: InstallerHandoff): Promise<InstallerHandoff>;
  consumeHandoff(codeHash: string, now: InstallerHandoff['consumedAt']): Promise<InstallerHandoff>;
}
