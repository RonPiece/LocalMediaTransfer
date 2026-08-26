import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseSavedConnection, usePairingController } from './usePairingController';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
}));

jest.mock('@/api/ApiClient', () => ({
  api: {},
}));

jest.mock('@/services/NativeCapabilities', () => ({
  expectedServerEnvironment: () => 'production',
  nativeCapabilities: { available: true },
}));

describe('parseSavedConnection', () => {
  const valid = {
    version: 3,
    environment: 'production',
    serverId: 'desktop-1',
    httpsUrl: 'https://192.0.2.1:8443',
    certificateFingerprint: 'ab'.repeat(32),
  };

  it('accepts a complete saved trust record', () => {
    expect(parseSavedConnection(JSON.stringify(valid))).toEqual(valid);
  });

  it.each([
    ['invalid JSON', '{broken'],
    ['missing identifier', JSON.stringify({ ...valid, serverId: '' })],
    ['wrong scheme', JSON.stringify({ ...valid, httpsUrl: 'http://192.0.2.1:8080' })],
    ['short fingerprint', JSON.stringify({ ...valid, certificateFingerprint: 'ab' })],
    ['wrong environment', JSON.stringify({ ...valid, environment: 'staging' })],
  ])('rejects %s without throwing', (_label, value) => {
    expect(parseSavedConnection(value)).toBeNull();
  });
});

describe('usePairingController nearby discovery', () => {
  it('claims the connection attempt before awaiting storage so repeated taps do not race', async () => {
    let resolveStoredValue: (value: string | null) => void = () => undefined;
    (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise(resolve => {
      resolveStoredValue = resolve;
    }));
    const connectionAttemptRef = { current: false } as React.MutableRefObject<boolean>;
    const setIsConnecting = jest.fn();
    const { result } = renderHook(() => usePairingController({
      nativeHttpsAvailable: true,
      effectiveAllowInsecureHttp: false,
      connectionSecurity: { mode: 'disconnected', certificateVerified: false },
      setAppState: jest.fn(),
      setIsConnecting,
      setPairingDesktopName: jest.fn(),
      markDisconnected: jest.fn(),
      markHttpConnected: jest.fn(),
      markSecureConnected: jest.fn(),
      getDeviceIdentity: jest.fn(),
      connectTrusted: jest.fn(),
      showAlertOnce: jest.fn(),
      confirmOnce: jest.fn(),
      requestQrScan: jest.fn(),
      persistAllowInsecureHttp: jest.fn(),
      connectionAttemptRef,
    }));
    const server = {
      serverId: 'desktop-1',
      name: 'Desktop',
      address: '192.0.2.1',
      httpsPort: 8443,
      environment: 'production' as const,
      certificateFingerprint: 'ab'.repeat(32),
      approvalRequired: false,
    };

    const first = result.current.handleDiscoveredServer(server);
    const second = result.current.handleDiscoveredServer(server);

    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveStoredValue(null);
      await Promise.all([first, second]);
    });
    expect(setIsConnecting).toHaveBeenNthCalledWith(1, true);
    expect(setIsConnecting).toHaveBeenLastCalledWith(false);
    expect(connectionAttemptRef.current).toBe(false);
  });
});
