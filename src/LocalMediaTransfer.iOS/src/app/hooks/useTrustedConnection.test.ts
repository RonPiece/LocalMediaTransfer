import { renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { useTrustedConnection } from './useTrustedConnection';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/api/ApiClient', () => ({
  api: {
    setConfig: jest.fn(),
    pingServer: jest.fn(),
  },
}));

jest.mock('@/services/NativeCapabilities', () => ({
  expectedServerEnvironment: () => 'production',
  nativeCapabilities: {
    configureSecureConnection: jest.fn(),
    clearSecureConnection: jest.fn(),
    securityState: jest.fn(),
  },
}));

describe('useTrustedConnection identity migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key.includes('device_identity') ? '{invalid-json' : null
    );
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (Crypto.getRandomBytesAsync as jest.Mock).mockImplementation(async (length: number) =>
      new Uint8Array(length).fill(7)
    );
  });

  it('discards corrupt legacy identity state and creates a valid replacement', async () => {
    const { result } = renderHook(() => useTrustedConnection({
      setAppState: jest.fn(),
      setConnectionSecurity: jest.fn(),
      setIsServerConnected: jest.fn(),
      setIsConnecting: jest.fn(),
      setPairingDesktopName: jest.fn(),
      showAlertOnce: jest.fn(),
      requestQrScan: jest.fn(),
      resetConnectionAttempt: jest.fn(),
    }));

    const identity = await result.current.getDeviceIdentity();

    expect(identity.deviceId).toHaveLength(32);
    expect(identity.credential).toHaveLength(64);
    expect(AsyncStorage.removeItem).toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(expect.any(String), identity.deviceId);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), identity.credential);
  });
});
