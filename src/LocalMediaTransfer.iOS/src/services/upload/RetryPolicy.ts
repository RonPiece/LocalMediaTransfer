import { isUnauthorizedError } from '@/api/errors';
import { TransferFailure } from './errors';

/** Owns each compatibility chunk attempt, timeout and bounded linear backoff. */
export async function retryChunkRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  options: {
    retries: number;
    timeoutMs: number;
    isCancelled: () => boolean;
    activeRequests: Set<AbortController>;
  },
): Promise<T> {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (options.isCancelled()) throw new TransferFailure('upload', 'cancelled');
      options.activeRequests.add(controller);
      timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      return await request(controller.signal);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      if (attempt >= options.retries || options.isCancelled() || error instanceof TransferFailure) {
        if (controller.signal.aborted && !options.isCancelled()) {
          throw new TransferFailure('network', 'request-timeout');
        }
        throw error;
      }
      attempt += 1;
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    } finally {
      if (timeout) clearTimeout(timeout);
      options.activeRequests.delete(controller);
    }
  }
}
