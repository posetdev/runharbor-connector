import type { EpochMs } from '@runharbor/contracts';

export interface SchedulerPort {
  /** 04-data-model.md §1: create the one-time at(timeoutAt) timeout schedule in the configured group and role. */
  createOneTimeSchedule(
    operationId: string,
    at: EpochMs,
    timeoutFunctionArn: string,
    schedulerRoleArn: string,
    scheduleGroupName: string,
  ): Promise<string>;

  /** 04-data-model.md §1: remove the operation's one-time timeout schedule when cleanup requires it. */
  deleteSchedule(scheduleName: string): Promise<void>;
}
