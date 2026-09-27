import { GetCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { z } from 'zod';
import { ConditionalWriteError } from '../../ports/operation-store.js';

export type DynamoCondition = Readonly<{ notExists: true } | { revision: number } | { custom: Readonly<{ expression: string; names?: Record<string, string>; values?: Record<string, unknown> }> }>;
export type DynamoUpdate = Readonly<{ set?: Record<string, unknown>; remove?: readonly string[]; add?: Record<string, number>; candidate?: unknown }>;

export class DynamoStore {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async put<Item>(schema: z.ZodTypeAny, item: Item, condition: DynamoCondition): Promise<Item> {
    const parsed = schema.parse(item) as Item;
    try { await this.client.send(new PutCommand({ TableName: this.tableName, Item: parsed as Record<string, unknown>, ...conditionInput(condition) })); return parsed; }
    catch (error) { throw conditionError(error); }
  }

  async get<Item>(schema: z.ZodTypeAny, key: Record<string, string>): Promise<Item | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
    return result.Item === undefined ? undefined : schema.parse(result.Item);
  }

  async update<Item>(schema: z.ZodTypeAny, key: Record<string, string>, patch: DynamoUpdate, condition: DynamoCondition): Promise<Item> {
    if (patch.candidate !== undefined) schema.parse(patch.candidate);
    const entries = Object.entries(patch.set ?? {});
    const removed = patch.remove ?? [];
    const added = Object.entries(patch.add ?? {});
    if (entries.length === 0 && removed.length === 0 && added.length === 0) throw new Error('empty update');
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const set = entries.map(([field, value], index) => { const name = `#s${index}`; const valueName = `:s${index}`; names[name] = field; values[valueName] = value; return `${name} = ${valueName}`; });
    const remove = removed.map((field, index) => { const name = `#r${index}`; names[name] = field; return name; });
    const add = added.map(([field, value], index) => { const name = `#a${index}`; const valueName = `:a${index}`; names[name] = field; values[valueName] = value; return `${name} ${valueName}`; });
    const conditionInputValue = conditionInput(condition);
    try {
      const result = await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: key, UpdateExpression: [set.length ? `SET ${set.join(', ')}` : '', remove.length ? `REMOVE ${remove.join(', ')}` : '', add.length ? `ADD ${add.join(', ')}` : ''].filter(Boolean).join(' '), ExpressionAttributeNames: { ...names, ...conditionInputValue.ExpressionAttributeNames }, ExpressionAttributeValues: { ...values, ...conditionInputValue.ExpressionAttributeValues }, ConditionExpression: conditionInputValue.ConditionExpression, ReturnValues: 'ALL_NEW' }));
      return schema.parse(result.Attributes) as Item;
    } catch (error) { throw conditionError(error); }
  }
}

function conditionInput(condition: DynamoCondition): Pick<PutCommand['input'], 'ConditionExpression' | 'ExpressionAttributeNames' | 'ExpressionAttributeValues'> {
  if ('notExists' in condition) return { ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } };
  if ('revision' in condition) return { ConditionExpression: '#revision = :expectedRevision', ExpressionAttributeNames: { '#revision': 'revision' }, ExpressionAttributeValues: { ':expectedRevision': condition.revision } };
  return { ConditionExpression: condition.custom.expression, ExpressionAttributeNames: condition.custom.names, ExpressionAttributeValues: condition.custom.values };
}

function conditionError(error: unknown): unknown { return typeof error === 'object' && error !== null && 'name' in error && error.name === 'ConditionalCheckFailedException' ? new ConditionalWriteError() : error; }
