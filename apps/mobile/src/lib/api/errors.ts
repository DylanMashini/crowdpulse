import type { ErrorCode } from '@triagecam/contracts';

export type ApiFailure =
  /** No answer: the server is down, the tunnel is closed or the phone is offline. */
  | 'network'
  /** The server answered with a status outside 2xx. */
  | 'http'
  /** A 2xx answer whose body does not match the contract. */
  | 'invalid_response';

export class ApiError extends Error {
  readonly kind: ApiFailure;
  /** The contract's error code, when the server sent one. */
  readonly code: ErrorCode | null;
  readonly status: number | null;

  constructor(kind: ApiFailure, message: string, options: { code?: ErrorCode | null; status?: number | null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.code = options.code ?? null;
    this.status = options.status ?? null;
  }

  /** True when sending the same request again later can succeed. */
  get retryable(): boolean {
    if (this.kind === 'network') return true;
    if (this.kind === 'invalid_response') return false;
    return this.status === 408 || this.status === 429 || (this.status !== null && this.status >= 500);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A sentence for the screen, whatever was thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
