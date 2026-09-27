import type { EpochMs } from '@runharbor/contracts';

export interface Clock {
  now(): EpochMs;
}

export const systemClock: Clock = {
  now: () => Date.now() as EpochMs,
};
