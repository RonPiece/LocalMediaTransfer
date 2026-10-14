/** HTTP failure identity shared by transport and upload policy. */
export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Deliberately HTTP 401 only; native error codes have their own parser. */
export function isUnauthorizedError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 401;
}
