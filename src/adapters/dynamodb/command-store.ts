import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { commandRecordSchema } from '../../domain/command.js';
import type { CommandRecord, CommandStore as CommandStorePort } from '../../ports/command-store.js';
import { DynamoStore } from './store.js';

export class DynamoCommandStore implements CommandStorePort {
  private readonly store: DynamoStore;

  constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.store = new DynamoStore(client, tableName);
  }

  async recordCommand(command: CommandRecord): Promise<void> {
    await this.store.put<CommandRecord>(commandRecordSchema, command, { notExists: true });
  }

  async getCommand(commandId: string): Promise<CommandRecord | undefined> {
    return this.store.get<CommandRecord>(commandRecordSchema, { pk: `CMD#${commandId}`, sk: '#' });
  }
}
