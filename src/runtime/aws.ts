import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EC2Client } from '@aws-sdk/client-ec2';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { SSMClient } from '@aws-sdk/client-ssm';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { config } from './config.js';

const clientOptions = { region: config.awsRegion, maxAttempts: 3, requestHandler: new NodeHttpHandler({ requestTimeout: 10_000, connectionTimeout: 1_000 }) };
let dynamo: DynamoDBClient | undefined;
let ec2: EC2Client | undefined;
let scheduler: SchedulerClient | undefined;
let ssm: SSMClient | undefined;
export const aws = {
  dynamo: () => (dynamo ??= new DynamoDBClient(clientOptions)),
  ec2: () => (ec2 ??= new EC2Client(clientOptions)),
  scheduler: () => (scheduler ??= new SchedulerClient(clientOptions)),
  ssm: () => (ssm ??= new SSMClient(clientOptions)),
};
