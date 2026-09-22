import { ApiRequestError } from '@/api/errors';
import { retryChunkRequest } from './RetryPolicy';
import { TransferFailure } from './errors';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const options = () => ({ retries: 2, timeoutMs: 10_000,
  isCancelled: () => false, activeRequests: new Set<AbortController>() });

it('uses the original bounded linear backoff and releases request ownership', async () => {
  const request = jest.fn().mockRejectedValueOnce(new Error('temporary'))
    .mockRejectedValueOnce(new Error('temporary')).mockResolvedValue('ok');
  const config = options();
  const result = retryChunkRequest(request, config);
  await jest.advanceTimersByTimeAsync(499);
  expect(request).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toBe('ok');
  expect(config.activeRequests.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

it.each([new ApiRequestError('unauthorized', 401), new TransferFailure('server', 'server-rejected')])(
  'does not retry permanent failures', async error => {
    const request = jest.fn().mockRejectedValue(error);
    const config = options();
    await expect(retryChunkRequest(request, config)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(config.activeRequests.size).toBe(0);
  },
);

it('aborts a stalled attempt and reports timeout after the retry budget', async () => {
  const config = { ...options(), retries: 0, timeoutMs: 100 };
  const result = retryChunkRequest(signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), config);
  const assertion = expect(result).rejects.toMatchObject({ code: 'request-timeout' });
  await jest.advanceTimersByTimeAsync(100);
  await assertion;
  expect(config.activeRequests.size).toBe(0);
});

it('never starts a cancelled transfer', async () => {
  const request = jest.fn();
  await expect(retryChunkRequest(request, { ...options(), isCancelled: () => true }))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(request).not.toHaveBeenCalled();
});

it('supports immediate external cancellation of the currently owned request', async () => {
  let cancelled = false;
  const config = { ...options(), isCancelled: () => cancelled };
  const request = jest.fn((signal: AbortSignal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled-by-owner')));
  }));
  const result = retryChunkRequest(request, config);
  const assertion = expect(result).rejects.toThrow('cancelled-by-owner');
  cancelled = true;
  for (const controller of config.activeRequests) controller.abort();
  await assertion;
  expect(request).toHaveBeenCalledTimes(1);
  expect(config.activeRequests.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
