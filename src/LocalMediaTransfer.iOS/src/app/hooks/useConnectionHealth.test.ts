import { act, renderHook, waitFor } from '@testing-library/react-native';

import { api } from '@/api/ApiClient';
import { useConnectionHealth } from './useConnectionHealth';

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('@/api/ApiClient', () => ({
  api: { pingServer: jest.fn().mockResolvedValue(true) },
}));

describe('useConnectionHealth', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not connect while the user is on the connection screen', async () => {
    const { result } = renderHook(() => useConnectionHealth({
      appState: 'connection',
      setIsServerConnected: jest.fn(),
    }));

    await Promise.resolve();
    expect(api.pingServer).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('uses a non-destructive authenticated check for an open dashboard', async () => {
    const setIsServerConnected = jest.fn();
    const { result } = renderHook(() => useConnectionHealth({ appState: 'dashboard', setIsServerConnected }));

    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(api.pingServer).toHaveBeenCalledWith({ notifyUnauthorized: false });
    expect(setIsServerConnected).toHaveBeenCalledWith(true);
  });

  it('stops after bounded failures and reconnects only on manual retry', async () => {
    const scheduled: (() => void)[] = [];
    const scheduler = {
      schedule: (callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: jest.fn(),
    };
    (api.pingServer as jest.Mock).mockResolvedValue(false);
    const setIsServerConnected = jest.fn();
    const { result } = renderHook(() => useConnectionHealth({
      appState: 'dashboard',
      setIsServerConnected,
      scheduler,
    }));

    await act(async () => { await Promise.resolve(); });
    expect(api.pingServer).toHaveBeenCalledTimes(1);
    await act(async () => {
      scheduled.shift()?.();
      await Promise.resolve();
    });
    expect(api.pingServer).toHaveBeenCalledTimes(2);
    await act(async () => {
      scheduled.shift()?.();
      await Promise.resolve();
    });
    expect(api.pingServer).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe('disconnected');
    expect(scheduled).toHaveLength(0);
    expect(api.pingServer).toHaveBeenCalledTimes(3);

    (api.pingServer as jest.Mock).mockResolvedValue(true);
    await act(async () => {
      result.current.retryConnection();
      await Promise.resolve();
    });
    expect(api.pingServer).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe('connected');
  });
});
