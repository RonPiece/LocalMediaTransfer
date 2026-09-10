import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/api/ApiClient';

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
  api: {
    setConfig: jest.fn(), pingServer: jest.fn(), requestPairing: jest.fn(),
    pairingStatus: jest.fn(), logClientEvent: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/services/NativeCapabilities', () => ({
  expectedServerEnvironment: () => 'production',
  nativeCapabilities: { available: true, clearSecureConnection: jest.fn() },
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

describe('HTTP pairing-only capability', () => {
  it.each(['approved', 'denied'] as const)('requires Windows approval in Expo Go: %s', async status => {
    jest.clearAllMocks();
    (api.pingServer as jest.Mock).mockResolvedValue(true);
    (api.requestPairing as jest.Mock).mockResolvedValue(status);
    const markHttpConnected = jest.fn();
    const { result } = renderHook(() => usePairingController({
      nativeHttpsAvailable: false, effectiveAllowInsecureHttp: true,
      connectionSecurity: { mode: 'disconnected', certificateVerified: false },
      setAppState: jest.fn(), setIsConnecting: jest.fn(), setPairingDesktopName: jest.fn(),
      markDisconnected: jest.fn(), markHttpConnected, markSecureConnected: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'test-device', credential: 'approved-secret' }),
      connectTrusted: jest.fn(), showAlertOnce: jest.fn(), confirmOnce: jest.fn(),
      requestQrScan: jest.fn(), persistAllowInsecureHttp: jest.fn(),
      connectionAttemptRef: { current: false },
    }));
    await act(async () => {
      await result.current.handleConnect('http://192.0.2.1:8080', 'pair-test');
    });
    expect(api.requestPairing).toHaveBeenCalledWith(
      'http://192.0.2.1:8080', 'test-device', 'iPhone', 'approved-secret');
    if (status === 'approved') {
      expect(api.setConfig).toHaveBeenCalledWith('http://192.0.2.1:8080', 'approved-secret');
      expect(markHttpConnected).toHaveBeenCalledTimes(1);
    } else expect(markHttpConnected).not.toHaveBeenCalled();
  });
});
