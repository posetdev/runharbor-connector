import { AppError } from '../domain/errors.js';
import { resolveInstanceCaller } from '../identity/instance-caller.js';
import { composeRunner } from '../runtime/runner-compose.js';
import { errorResponse, json, parseFunctionUrlEvent, parseJsonBody, type FunctionUrlResponse } from '../runtime/http.js';
import { causeFields, log } from '../runtime/logger.js';
import { jitClaimRequestSchema, jitClaimResponseSchema, jitReadinessResponseSchema, operationIdSchema, type EpochMs } from '@runharbor/contracts';

export async function handler(event: unknown): Promise<FunctionUrlResponse> {
  try {
    const request = parseFunctionUrlEvent(event);
    const { config, readiness, claim } = composeRunner();
    const instanceId = resolveInstanceCaller(request.caller, config.runnerRoleArn);
    if (request.method === 'GET' && request.path === '/jit/readiness') {
      if (Object.keys(request.query).length !== 1) throw new AppError('BAD_REQUEST');
      const operationId = parseOperationId(request.query.operationId);
      const value = await readiness(instanceId, operationId);
      return json(200, jitReadinessResponseSchema.parse(value));
    }
    if (request.method === 'POST' && request.path === '/jit/claim') {
      const parsed = jitClaimRequestSchema.safeParse(parseJsonBody(request));
      if (!parsed.success) throw new AppError('BAD_REQUEST');
      const value = await claim(instanceId, parsed.data.operationId, Date.now() as EpochMs);
      return json(200, jitClaimResponseSchema.parse(value));
    }
    throw new AppError('NOT_FOUND');
  } catch (error) {
    const appError = AppError.from(error);
    // The bootstrap only ever prints `secure JIT claim failed` and then powers the instance off, so
    // this is the single place a refusal can be named. Without it a 500 left nothing but
    // START/END/REPORT, which is how a composition-root failure survived a live deployment.
    if (appError.httpStatus >= 500) log.info('runner_error', { errorCode: appError.code, ...causeFields(appError.cause) });
    return errorResponse(appError);
  }
}

function parseOperationId(value: unknown): string {
  const parsed = operationIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError('BAD_REQUEST');
  return parsed.data;
}
