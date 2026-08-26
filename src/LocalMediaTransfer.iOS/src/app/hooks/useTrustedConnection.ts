import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { api } from '@/api/ApiClient';
import { connectionStorageKeys } from '@/config/storageKeys';
import { expectedServerEnvironment, nativeCapabilities } from '@/services/NativeCapabilities';
import { ConnectionSecurityState, SavedConnection, ScreenState } from '../types';

function isLegacyDeviceIdentity(value: unknown): value is { deviceId: string; credential: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.deviceId === 'string' && candidate.deviceId.length > 0 &&
    typeof candidate.credential === 'string' && candidate.credential.length > 0;
}

export function useTrustedConnection({
  setAppState,
  setConnectionSecurity,
  setIsServerConnected,
  setIsConnecting,
  setPairingDesktopName,
  showAlertOnce,
  requestQrScan,
  resetConnectionAttempt,
}: {
  setAppState: React.Dispatch<React.SetStateAction<ScreenState>>;
  setConnectionSecurity: (value: ConnectionSecurityState) => void;
  setIsServerConnected: (value: boolean) => void;
  setIsConnecting: (value: boolean) => void;
  setPairingDesktopName: (value: string | null) => void;
  showAlertOnce: (title: string, message?: string, buttons?: Parameters<typeof Alert.alert>[2]) => void;
  requestQrScan: () => void;
  resetConnectionAttempt: () => void;
}) {
  const getDeviceIdentity = React.useCallback(async () => {
    const legacy = await AsyncStorage.getItem(connectionStorageKeys.deviceIdentity());
    if (legacy) {
      try {
        const parsed: unknown = JSON.parse(legacy);
        if (isLegacyDeviceIdentity(parsed)) {
          await AsyncStorage.setItem(connectionStorageKeys.deviceId(), parsed.deviceId);
          await SecureStore.setItemAsync(connectionStorageKeys.deviceCredential(), parsed.credential);
          await AsyncStorage.removeItem(connectionStorageKeys.deviceIdentity());
          return parsed;
        }
      } catch {
        // Corrupt legacy state is discarded below and replaced with a new identity.
      }
      await AsyncStorage.removeItem(connectionStorageKeys.deviceIdentity()).catch(() => undefined);
    }
    const existingId = await AsyncStorage.getItem(connectionStorageKeys.deviceId());
    const existingCredential = await SecureStore.getItemAsync(connectionStorageKeys.deviceCredential());
    if (existingId && existingCredential) return { deviceId: existingId, credential: existingCredential };
    const randomHex = async (bytes: number) => Array.from(await Crypto.getRandomBytesAsync(bytes), value => value.toString(16).padStart(2, '0')).join('');
    const identity = { deviceId: existingId || await randomHex(16), credential: await randomHex(32) };
    await AsyncStorage.setItem(connectionStorageKeys.deviceId(), identity.deviceId);
    await SecureStore.setItemAsync(connectionStorageKeys.deviceCredential(), identity.credential);
    return identity;
  }, []);

  const connectTrusted = React.useCallback(async (saved: SavedConnection, credential: string, silent: boolean): Promise<boolean> => {
    try {
      if (saved.version !== 3 || saved.environment !== expectedServerEnvironment()) {
        throw new Error(
          `Saved trust belongs to the ${saved.environment || 'unknown'} environment, not ${expectedServerEnvironment()}.`,
        );
      }
      await nativeCapabilities.configureSecureConnection(saved.httpsUrl, saved.certificateFingerprint);
      api.setConfig(saved.httpsUrl, credential);
      const ok = await api.pingServer({ notifyUnauthorized: false });
      if (!ok) {
        throw new Error(api.connectionError || 'The trusted desktop did not accept this device credential.');
      }
      const state = await nativeCapabilities.securityState();
      if (!state.certificateVerified) throw new Error('The desktop certificate was not verified.');
      setConnectionSecurity({ mode: 'https', tlsVersion: state.tlsVersion, certificateVerified: true });
      setIsServerConnected(true);
      setAppState('dashboard');
      return true;
    } catch (error) {
      console.warn('Trusted reconnect failed; saved trust was preserved.');
      api.setConfig('', '');
      nativeCapabilities.clearSecureConnection();
      setIsServerConnected(false);
      setIsConnecting(false);
      setPairingDesktopName(null);
      setConnectionSecurity({ mode: 'disconnected', certificateVerified: false });
      resetConnectionAttempt();
      if (!silent) {
        showAlertOnce(
          'Could not reconnect',
          error instanceof Error
            ? `${error.message} Your saved trust was kept. Try this desktop again, or scan its current QR code if trust was revoked.`
            : 'The trusted desktop could not be reached. Your saved trust was kept.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => {
                resetConnectionAttempt();
                setAppState('connection');
                setIsConnecting(false);
                setPairingDesktopName(null);
              },
            },
            {
              text: 'Scan QR',
              onPress: () => {
                resetConnectionAttempt();
                setAppState('connection');
                setIsConnecting(false);
                setPairingDesktopName(null);
                setTimeout(requestQrScan, 500);
              },
            },
          ],
        );
      }
      return false;
    }
  }, [requestQrScan, resetConnectionAttempt, setAppState, setConnectionSecurity, setIsConnecting, setIsServerConnected, setPairingDesktopName, showAlertOnce]);

  return { getDeviceIdentity, connectTrusted };
}
