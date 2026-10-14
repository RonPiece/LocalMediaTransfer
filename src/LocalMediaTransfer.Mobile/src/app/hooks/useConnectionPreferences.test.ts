import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useConnectionPreferences } from './useConnectionPreferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('useConnectionPreferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  it('keeps a session choice and reports when nearby discovery cannot be saved', async () => {
    const onPersistenceError = jest.fn();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
    const { result } = renderHook(() => useConnectionPreferences({ onPersistenceError }));

    act(() => result.current.persistNearbyDiscovery(true));

    expect(result.current.nearbyDiscoveryEnabled).toBe(true);
    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledTimes(1));
  });

  it('reports hydration failures and uses safe defaults', async () => {
    const onPersistenceError = jest.fn();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
    const { result } = renderHook(() => useConnectionPreferences({ onPersistenceError }));

    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledTimes(2));
    expect(result.current.nearbyDiscoveryEnabled).toBe(false);
    expect(result.current.allowInsecureHttp).toBe(false);
  });
});
