import { act, renderHook, waitFor } from '@testing-library/react-native';

import { nativeCapabilities } from '@/services/NativeCapabilities';
import { useDiscoveryController } from './useDiscoveryController';

jest.mock('@/services/NativeCapabilities', () => ({
  nativeCapabilities: {
    available: true,
    discover: jest.fn(),
  },
}));

describe('useDiscoveryController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes a recoverable failure state and clears it on retry', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (nativeCapabilities.discover as jest.Mock)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() => useDiscoveryController({ enabled: true }));

    await act(async () => result.current.performDiscovery());
    expect(result.current.discoveryFailed).toBe(true);

    await act(async () => result.current.performDiscovery());
    await waitFor(() => expect(result.current.discoveryFailed).toBe(false));
  });
});
