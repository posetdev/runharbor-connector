import { z } from 'zod';
import { commandRecordSchema } from '../domain/command.js';

export type CommandRecord = z.infer<typeof commandRecordSchema>;

export interface CommandStore {
  /**
   * Idempotently record a command ID as processed. Throws an error if the
   * command ID already exists in the store.
   */
  recordCommand(command: CommandRecord): Promise<void>;

  /**
   * Retrieve a command record by its command ID.
   */
  getCommand(commandId: string): Promise<CommandRecord | undefined>;
}
