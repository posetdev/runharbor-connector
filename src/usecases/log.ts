import { AppError } from '../domain/errors.js';

/** How usecases log without depending on runtime: the handler passes its logger; the default drops everything. */
export type UsecaseLogger = Readonly<{ info(event: string, fields?: Record<string, string | number | boolean>): void }>;

export const silentLogger: UsecaseLogger = { info() {} };

/** Error code and cause name only; messages and payloads can carry secrets. */
export function errorFields(error: unknown): Record<string, string> {
  const appError = AppError.from(error);
  const cause = appError.cause as { name?: unknown } | undefined;
  return { errorCode: appError.code, ...(typeof cause?.name === 'string' ? { causeName: cause.name } : {}) };
}
