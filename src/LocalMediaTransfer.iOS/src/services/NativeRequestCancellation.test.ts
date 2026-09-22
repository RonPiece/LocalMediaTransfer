import { nativeCapabilities } from './NativeCapabilities';

const mockPrepare = jest.fn();
const mockCancel = jest.fn();
const mockRequest = jest.fn();
jest.mock('expo-modules-core', () => ({
  requireNativeModule: () => ({
    prepareRequest: (...args: unknown[]) => mockPrepare(...args),
    cancelRequest: (...args: unknown[]) => mockCancel(...args),
    request: (...args: unknown[]) => mockRequest(...args),
  }),
  EventEmitter: jest.fn(),
}));

describe('native control request cancellation', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
  afterEach(() => { jest.useRealTimers(); });

  it('rejects an already aborted request without scheduling native work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(nativeCapabilities.request({}, controller.signal)).rejects.toThrow('aborted');
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each(['abort', 'deadline'])('cancels the matching native task on %s', async cause => {
    const controller = new AbortController();
    mockRequest.mockImplementationOnce(() => new Promise((_, reject) => {
      mockCancel.mockImplementationOnce(() => reject(new Error('native cancelled')));
    }));
    const pending = nativeCapabilities.request({ url: 'https://receiver.invalid/health' }, controller.signal);
    const rejected = expect(pending).rejects.toThrow('native cancelled');
    const requestId = mockPrepare.mock.calls[0][0];
    expect(mockRequest.mock.calls[0][0].requestId).toBe(requestId);
    if (cause === 'abort') controller.abort();
    else jest.advanceTimersByTime(30_000);
    await rejected;
    expect(mockCancel).toHaveBeenCalledWith(requestId);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('removes cancellation hooks after successful completion', async () => {
    const controller = new AbortController();
    mockRequest.mockResolvedValueOnce({ status: 200, body: '{}', headers: {} });
    await nativeCapabilities.request({}, controller.signal);
    controller.abort();
    jest.advanceTimersByTime(30_000);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
