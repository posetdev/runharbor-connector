import { GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import { AppCredentials, type AppCredentialsData } from '../../ports/secrets.js';

export interface SsmClientLike {
  send(command: GetParameterCommand | PutParameterCommand): Promise<unknown>;
}

const appCredentialsSchema = z
  .object({
    appId: z.string().regex(/^[1-9][0-9]{0,15}$/),
    slug: z.string().min(1).max(100),
    pem: z.string().min(1),
    clientId: z.string().min(1),
    webhookSecret: z.string().min(1),
  })
  .strict();

/** Reads and validates the GitHub App credential JSON stored at 04 §3's SSM parameter. */
export async function readAppCredentials(parameterName: string, client: SsmClientLike): Promise<AppCredentials> {
  let response: unknown;
  try {
    response = await client.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
  } catch (error) {
    throw AppError.from(error);
  }
  const value = (response as { Parameter?: { Value?: string } }).Parameter?.Value;
  if (typeof value !== 'string') throw new AppError('NOT_FOUND');
  try {
    const data = appCredentialsSchema.parse(JSON.parse(value));
    return new AppCredentials(data);
  } catch (error) {
    throw AppError.from(error);
  }
}

/** Overwrites the SecureString parameter with the validated credential JSON. */
export async function writeAppCredentials(parameterName: string, data: AppCredentialsData, client: SsmClientLike): Promise<void> {
  let validated: AppCredentialsData;
  try {
    validated = appCredentialsSchema.parse(data);
  } catch (error) {
    throw AppError.from(error);
  }
  try {
    await client.send(new PutParameterCommand({ Name: parameterName, Value: JSON.stringify(validated), Type: 'SecureString', Overwrite: true }));
  } catch (error) {
    throw AppError.from(error);
  }
}
