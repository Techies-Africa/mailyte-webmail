import type { ApiResult } from '../client';

/**
 * A failed API call, thrown so the query layer can see it.
 *
 * The fetch helpers in client.ts return `{ success: false }` rather than
 * throwing, which suits a component that renders the message. TanStack Query
 * needs a rejection to know a fetch failed, so query functions go through
 * `unwrap` and get one of these.
 */
export class ApiError extends Error {
  /** HTTP status; 0 when the server was never reached. */
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * The data of a successful result, or an ApiError.
 *
 * `undefined` becomes `null`: an endpoint that answers with no `data` is a
 * normal empty answer, and TanStack Query refuses `undefined` as query data.
 */
export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.success) throw new ApiError(result.message, result.status ?? 0);
  return (result.data ?? null) as T;
}

/** A session problem, which the redirect already handles -- never worth a toast. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
