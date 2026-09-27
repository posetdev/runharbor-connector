export const errorCodes = [
  'BAD_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'PAYLOAD_TOO_LARGE', 'INVALID_SIGNATURE',
  'UNSUPPORTED_EVENT', 'AMBIGUOUS_RUNNER_LABEL', 'INVALID_RUNNER_LABEL', 'UNSATISFIABLE_RUNNER_LABEL', 'DUPLICATE_DELIVERY', 'ENQUEUE_FAILED', 'IN_PROGRESS',
  'IDEMPOTENCY_MISMATCH', 'JOB_NOT_ELIGIBLE', 'ALREADY_CLAIMED', 'ALREADY_ACTIVATED', 'TOKEN_EXPIRED',
  'NOT_FOUND', 'NOT_IMPLEMENTED', 'INVALID_TRANSITION', 'UPSTREAM_UNAVAILABLE', 'RATE_LIMITED', 'INTERNAL',
  'STATE_CONFLICT',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export type ErrorDefinition = Readonly<{ httpStatus: number; retryable: boolean }>;
export const errorDefinitions: Readonly<Record<ErrorCode, ErrorDefinition>> = {
  BAD_REQUEST: { httpStatus: 400, retryable: false }, UNAUTHENTICATED: { httpStatus: 401, retryable: false },
  FORBIDDEN: { httpStatus: 403, retryable: false }, PAYLOAD_TOO_LARGE: { httpStatus: 413, retryable: false },
  INVALID_SIGNATURE: { httpStatus: 401, retryable: false }, UNSUPPORTED_EVENT: { httpStatus: 400, retryable: false },
  AMBIGUOUS_RUNNER_LABEL: { httpStatus: 422, retryable: false }, INVALID_RUNNER_LABEL: { httpStatus: 422, retryable: false }, UNSATISFIABLE_RUNNER_LABEL: { httpStatus: 422, retryable: false }, DUPLICATE_DELIVERY: { httpStatus: 200, retryable: false },
  ENQUEUE_FAILED: { httpStatus: 500, retryable: true }, IN_PROGRESS: { httpStatus: 409, retryable: true },
  IDEMPOTENCY_MISMATCH: { httpStatus: 409, retryable: false }, JOB_NOT_ELIGIBLE: { httpStatus: 422, retryable: false },
  ALREADY_CLAIMED: { httpStatus: 409, retryable: false }, ALREADY_ACTIVATED: { httpStatus: 409, retryable: false },
  TOKEN_EXPIRED: { httpStatus: 401, retryable: false }, NOT_FOUND: { httpStatus: 404, retryable: false },
  NOT_IMPLEMENTED: { httpStatus: 501, retryable: false },
  // A domain transition table refused a move our own code asked for: a programming error, so it stays a 5xx.
  INVALID_TRANSITION: { httpStatus: 500, retryable: false },
  UPSTREAM_UNAVAILABLE: { httpStatus: 503, retryable: true }, RATE_LIMITED: { httpStatus: 429, retryable: true },
  INTERNAL: { httpStatus: 500, retryable: true },
  // The caller is at the wrong step for the current stored state (e.g. setup after DEPLOYMENT exists): expected and recoverable.
  // Do not merge this with INVALID_TRANSITION; that would hide real transition bugs from 5xx alarms or show customers a 500.
  STATE_CONFLICT: { httpStatus: 409, retryable: false },
};
