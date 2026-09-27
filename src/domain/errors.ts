import { errorDefinitions, type ErrorCode } from '@runharbor/contracts';

export class AppError extends Error {
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly publicReason: string | undefined;

  constructor(readonly code: ErrorCode, options: { cause?: unknown; publicReason?: string } = {}) {
    super(code, options);
    this.name = 'AppError';
    const definition = errorDefinitions[code];
    this.httpStatus = definition.httpStatus;
    this.retryable = definition.retryable;
    this.publicReason = options.publicReason;
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) return error;
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code : undefined;
    return code === 'TimeoutError' || code === 'NetworkingError'
      ? new AppError('UPSTREAM_UNAVAILABLE', { cause: error })
      : new AppError('INTERNAL', { cause: error });
  }
}
