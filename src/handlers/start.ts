import { startResponseSchema, workflowDispatchResponseSchema, type StartRequest } from '@runharbor/contracts';
import { systemClock } from '../domain/clock.js';
import { AppError } from '../domain/errors.js';
import { BOOTSTRAP_BUDGET_MS, isTerminal } from '../domain/operation.js';
import { config } from '../runtime/config.js';
import { composeStart } from '../runtime/compose.js';
import { errorResponse, json, parseFunctionUrlEvent, parseJsonBody, type FunctionUrlResponse } from '../runtime/http.js';
import { causeFields, log } from '../runtime/logger.js';
import { authorizeStart } from '../usecases/authorize-start.js';
import { startOperation } from '../usecases/start-operation.js';
import { dispatchWorkflow } from '../usecases/dispatch-workflow.js';
import { verifySignedCommand } from '../usecases/verify-signed-command.js';

const MAX_REQUEST_BYTES = 16 * 1024;

export function createStartHandler(
  compose: () => ReturnType<typeof composeStart> = composeStart,
  clock: typeof systemClock = systemClock,
  appConfig: typeof config = config,
) {
  return async function startHandler(event: unknown): Promise<FunctionUrlResponse> {
    try {
      const request = parseFunctionUrlEvent(event);
      if (request.method !== 'POST' || (request.path !== '/' && request.path !== '' && request.path !== '/commands')) {
        throw new AppError('NOT_FOUND');
      }
      if (request.body.length > MAX_REQUEST_BYTES) throw new AppError('PAYLOAD_TOO_LARGE');

      const deps = compose();
      const now = clock.now();
      const verified = await verifySignedCommand(
        parseJsonBody(request),
        deps.commands,
        deps.commandKeys,
        { deploymentId: appConfig.deploymentId },
        now,
      );

      log.info('command_accepted', { deploymentId: verified.envelope.deploymentId });

      if (verified.type === 'start_runner') {
        const startRequest: StartRequest = {
          apiVersion: 'runharbor.start.v1',
          deploymentId: verified.envelope.deploymentId,
          idempotencyKey: verified.payload.idempotencyKey,
          runnerLabel: verified.payload.runnerLabel,
          instanceType: verified.payload.instanceType,
          job: verified.payload.job,
        };
        const image = await authorizeStart(startRequest, deps.deployments, appConfig);
        const body = await startOperation(
          startRequest,
          deps.operations,
          deps.ec2,
          deps.github,
          deps.secrets,
          deps.scheduler,
          clock,
          appConfig.githubAppParameterName,
          image.maxDurationMs + BOOTSTRAP_BUDGET_MS,
          appConfig.timeoutFunctionArn ?? '',
          appConfig.schedulerRoleArn ?? '',
          appConfig.scheduleGroupName ?? '',
          log,
        );
        return json(isTerminal(body.state) ? 200 : 202, startResponseSchema.parse(body));
      }

      if (verified.type === 'dispatch_workflow') {
        const response = await dispatchWorkflow(
          {
            apiVersion: 'runharbor.workflow-dispatch.v2',
            deploymentId: verified.envelope.deploymentId,
            idempotencyKey: verified.payload.idempotencyKey,
            target: verified.payload.target,
            source: verified.payload.source,
          },
          deps.deployments,
          deps.github,
          deps.secrets,
          appConfig,
        );
        return json(202, workflowDispatchResponseSchema.parse(response));
      }

      throw new AppError('BAD_REQUEST');
    } catch (error) {
      const appError = AppError.from(error);
      if (appError.httpStatus >= 500) log.info('start_error', { errorCode: appError.code, ...causeFields(appError.cause) });
      return errorResponse(appError);
    }
  };
}

export const handler = createStartHandler();
