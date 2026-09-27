import type { CommandKeysDocument, EpochMs } from '@runharbor/contracts';

export type LoadedCommandKeySet = Readonly<{
  document: CommandKeysDocument;
  cacheMaxAgeSeconds: number;
}>;

export interface CommandKeySource {
  load(): Promise<LoadedCommandKeySet>;
}

export interface CommandKeyResolver {
  resolve(keyId: string, now: EpochMs): Promise<string>;
}
