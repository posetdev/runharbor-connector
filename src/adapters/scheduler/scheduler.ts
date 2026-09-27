import { CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import type { EpochMs } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import { scheduleName } from '../../domain/operation.js';
import type { SchedulerPort } from '../../ports/scheduler.js';

export interface SchedulerClientLike {
  send(command: CreateScheduleCommand | DeleteScheduleCommand): Promise<unknown>;
}

export type SchedulerSettings = Readonly<{ scheduleGroupName?: string }>;

/** One-time EventBridge Scheduler schedules that invoke `timeout` at an operation's timeoutAt (D3). */
export class SchedulerAdapter implements SchedulerPort {
  constructor(private readonly client: SchedulerClientLike, private readonly settings: SchedulerSettings) {}

  async createOneTimeSchedule(operationId: string, at: EpochMs, timeoutFunctionArn: string, schedulerRoleArn: string, scheduleGroupName: string): Promise<string> {
    if (timeoutFunctionArn === '' || schedulerRoleArn === '' || scheduleGroupName === '') throw new AppError('INTERNAL');
    const name = scheduleName(operationId);
    try {
      await this.client.send(new CreateScheduleCommand({
        Name: name,
        GroupName: scheduleGroupName,
        ScheduleExpression: `at(${atExpression(at)})`,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: { Arn: timeoutFunctionArn, RoleArn: schedulerRoleArn, Input: JSON.stringify({ operationId }) },
      }));
    } catch (error) {
      // The name is derived from the operation id, so an existing schedule is this one.
      if (errorName(error) !== 'ConflictException') throw new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
    }
    return name;
  }

  async deleteSchedule(name: string): Promise<void> {
    if (this.settings.scheduleGroupName === undefined) throw new AppError('INTERNAL');
    try {
      await this.client.send(new DeleteScheduleCommand({ Name: name, GroupName: this.settings.scheduleGroupName }));
    } catch (error) {
      if (errorName(error) === 'ResourceNotFoundException') return;
      throw new AppError('UPSTREAM_UNAVAILABLE', { cause: error });
    }
  }
}

/** `at()` has one-second resolution; rounding up keeps the schedule from firing before timeoutAt. */
function atExpression(at: EpochMs): string {
  return new Date(Math.ceil(at / 1_000) * 1_000).toISOString().slice(0, 19);
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : undefined;
}
