import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { api } from '@/api/ApiClient';
import { connectionStorageKeys } from '@/config/storageKeys';
import {
  DiscoveredServer,
  expectedServerEnvironment,
  nativeCapabilities,
} from '@/services/NativeCapabilities';
import { PairingPayload, normalizeFingerprint } from '@/security/ConnectionSecurity';
import { ConnectionSecurityState, SavedConnection, ScreenState } from '../types';

type ConfirmOnce = (
  title: string,
  message: string,
  confirmText: string,
  style?: 'default' | 'cancel' | 'destructive',
) => Promise<boolean>;

type ShowAlertOnce = (
  title: string,
  message?: string,
  buttons?: Parameters<typeof import('react-native').Alert.alert>[2],
) => void;

export type UsePairingControllerOptions = {
  nativeHttpsAvailable: boolean;
  effectiveAllowInsecureHttp: boolean;
  connectionSecurity: ConnectionSecurityState;
  setAppState: React.Dispatch<React.SetStateAction<ScreenState>>;
  setIsConnecting: (value: boolean) => void;
  setPairingDesktopName: (value: string | null) => void;
  markDisconnected: () => void;
  markHttpConnected: () => void;
  markSecureConnected: (security: { tlsVersion?: string; certificateVerified: boolean }) => void;
  getDeviceIdentity: () => Promise<{ deviceId: string; credential: string }>;
  connectTrusted: (saved: SavedConnection, credential: string, silent: boolean) => Promise<boolean>;
  showAlertOnce: ShowAlertOnce;
  confirmOnce: ConfirmOnce;
  requestQrScan: () => void;
  persistAllowInsecureHttp: (enabled: boolean) => Promise<void>;
  connectionAttemptRef: React.MutableRefObject<boolean>;
};

export function parseSavedConnection(value: string | null): SavedConnection | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<SavedConnection>;
    if (
      candidate.version !== 3 ||
      (candidate.environment !== 'production' && candidate.environment !== 'test') ||
      typeof candidate.serverId !== 'string' || candidate.serverId.length === 0 ||
      typeof candidate.httpsUrl !== 'string' || !candidate.httpsUrl.startsWith('https://') ||
      typeof candidate.certificateFingerprint !== 'string' ||
      normalizeFingerprint(candidate.certificateFingerprint).length !== 64 ||
      (candidate.httpUrl !== undefined && !candidate.httpUrl.startsWith('http://'))
    ) {
      return null;
    }
    return candidate as SavedConnection;
  } catch {
    return null;
  }
}

export function usePairingController({
  nativeHttpsAvailable,
  effectiveAllowInsecureHttp,
  connectionSecurity,
  setAppState,
  setIsConnecting,
  setPairingDesktopName,
  markDisconnected,
  markHttpConnected,
  markSecureConnected,
  getDeviceIdentity,
  connectTrusted,
  showAlertOnce,
  confirmOnce,
  requestQrScan,
  persistAllowInsecureHttp,
  connectionAttemptRef,
}: UsePairingControllerOptions) {
  const httpConfirmedRef = React.useRef(false);

  const confirmHttpFallback = React.useCallback(() => confirmOnce(
    'Use unencrypted HTTP?',
    nativeHttpsAvailable
      ? 'Only use HTTP for older desktop builds on a private Wi-Fi network. Files and access credentials are not protected by HTTPS.'
      : 'Expo Go cannot use the native pinned-HTTPS or native upload module, so development uses HTTP plus the compatibility uploader. This has more overhead and can be slower. Use the installed IPA for encrypted, faster native transfers.',
    'Continue with HTTP',
    'destructive',
  ), [confirmOnce, nativeHttpsAvailable]);

  const explainUnencryptedHttp = React.useCallback(() => {
    showAlertOnce(
      'What is unencrypted HTTP?',
      nativeHttpsAvailable
        ? 'HTTPS encrypts transfers and verifies the desktop certificate. HTTP does not encrypt files or access credentials, so keep it off unless you need compatibility with an older desktop build.'
        : 'Expo Go cannot load the native module that verifies the Windows certificate or streams files through the native uploader. For development, HTTP is turned on automatically and uploads use the compatibility path, which has more overhead. Build and install the IPA for encrypted, faster native transfers.',
    );
  }, [nativeHttpsAvailable, showAlertOnce]);

  const explainNearbyDiscovery = React.useCallback(() => {
    showAlertOnce(
      'What is nearby discovery?',
      nativeHttpsAvailable
        ? 'Nearby discovery helps the iPhone find your Windows desktop on this Wi-Fi network. Turn it on here and in Local Media Transfer Settings on Windows. It does not send passwords; first connection still requires QR pairing and Windows approval.'
        : 'Nearby discovery requires the installed iOS app because Expo Go cannot load the native local-network discovery module. In Expo Go, use the Windows QR code or enter the HTTP address manually.',
    );
  }, [nativeHttpsAvailable, showAlertOnce]);

  const openQrScanner = React.useCallback(() => {
    connectionAttemptRef.current = false;
    setAppState('connection');
    setIsConnecting(false);
    setPairingDesktopName(null);
    setTimeout(requestQrScan, 500);
  }, [connectionAttemptRef, requestQrScan, setAppState, setIsConnecting, setPairingDesktopName]);

  const handleConnect = React.useCallback(async (
    ipOrUrl: string,
    token = '',
    pairing?: PairingPayload,
    silent = false,
  ) => {
    if (connectionAttemptRef.current) return false;
    connectionAttemptRef.current = true;
    setIsConnecting(true);
    try {
      const expectedEnvironment = expectedServerEnvironment();
      if (pairing && pairing.environment !== expectedEnvironment) {
        if (!silent) {
          showAlertOnce(
            'Wrong desktop environment',
            `This app expects the ${expectedEnvironment} Windows environment, but the QR code is for ${pairing.environment}. Open the matching Windows app and scan its QR code.`,
          );
        }
        return false;
      }
      let url = ipOrUrl.trim();
      if (!url.startsWith('http')) url = `https://${url}:8443`;
      if (url.startsWith('http://')) {
        const needsHttpConfirmation = nativeHttpsAvailable && !httpConfirmedRef.current;
        if (silent || !effectiveAllowInsecureHttp || (needsHttpConfirmation && !(await confirmHttpFallback()))) {
          if (!silent && !effectiveAllowInsecureHttp) {
            showAlertOnce('HTTP disabled', 'Turn on unencrypted HTTP in iOS settings before connecting to an older desktop build.');
          }
          return false;
        }
        httpConfirmedRef.current = true;
      } else {
        if (!pairing?.certificateFingerprint || !token) {
          if (!silent) showAlertOnce('Fingerprint and token required', 'Scan the Windows pairing QR or enter its SHA-256 fingerprint and session token.');
          return false;
        }
        try {
          await nativeCapabilities.configureSecureConnection(url, pairing.certificateFingerprint);
        } catch (error) {
          console.warn('HTTPS pairing failed while configuring pinned certificate trust.');
          if (!silent) showAlertOnce('Secure connection unavailable', error instanceof Error ? error.message : 'Use the installed app for pinned HTTPS.');
          return false;
        }
      }

      api.setConfig(url, token);
      const ok = await api.pingServer({ notifyUnauthorized: false });
      if (!ok) {
        console.warn('HTTPS pairing failed while validating the QR session token.');
        void api.logClientEvent('WARN', 'ios_https_pairing_failed', 'QR session token validation failed during HTTPS pairing.', {
          stage: 'qr_token_validation',
        });
        api.setConfig('', '');
        nativeCapabilities.clearSecureConnection();
        markDisconnected();
        if (!silent) {
          showAlertOnce(
            'Connection Failed',
            api.connectionError || 'The app reached the desktop, but the QR session token was not accepted. Scan the current Windows QR code again.',
          );
        }
        return false;
      }

      if (url.startsWith('https://') && pairing) {
        const identity = await getDeviceIdentity();
        let status = await api.requestPairing(url, identity.deviceId, 'iPhone', identity.credential);
        if (status === 'pending') {
          setPairingDesktopName(pairing.name || 'the desktop');
          for (let attempt = 0; attempt < 24 && status === 'pending'; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 2500));
            status = await api.pairingStatus(url, identity.deviceId, identity.credential);
          }
        }
        if (status !== 'approved') {
          console.warn('HTTPS pairing did not reach approved status:', status);
          void api.logClientEvent('WARN', 'ios_https_pairing_failed', 'Windows approval did not complete during HTTPS pairing.', {
            stage: 'pairing_approval',
            status,
          });
          api.setConfig('', '');
          nativeCapabilities.clearSecureConnection();
          markDisconnected();
          if (!silent) showAlertOnce('Connection not approved', 'The desktop denied the request or the approval timed out.');
          return false;
        }
        api.setConfig(url, identity.credential);
        let credentialActivated = false;
        for (let attempt = 0; attempt < 3 && !credentialActivated; attempt += 1) {
          credentialActivated = await api.pingServer({ notifyUnauthorized: false });
          if (!credentialActivated) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        if (!credentialActivated) {
          console.warn('HTTPS pairing approved, but trusted credential verification did not become ready.');
          void api.logClientEvent('WARN', 'ios_https_pairing_failed', 'Windows approved pairing, but trusted credential verification did not become ready.', {
            stage: 'trusted_credential_activation',
          });
          api.setConfig('', '');
          nativeCapabilities.clearSecureConnection();
          markDisconnected();
          if (!silent) showAlertOnce('Pairing Verification Failed', 'Windows approved this iPhone, but the desktop did not accept the trusted credential in time. Scan the current Windows QR code again.');
          return false;
        }
        const saved: SavedConnection = {
          version: 3,
          environment: pairing.environment,
          serverId: pairing.serverId,
          httpsUrl: url,
          httpUrl: pairing.httpUrl,
          certificateFingerprint: normalizeFingerprint(pairing.certificateFingerprint),
        };
        await AsyncStorage.setItem(connectionStorageKeys.lastServer(), JSON.stringify(saved));
        const state = await nativeCapabilities.securityState();
        markSecureConnected({ tlsVersion: state.tlsVersion, certificateVerified: state.certificateVerified });
      } else {
        markHttpConnected();
      }
      setAppState('dashboard');
      return true;
    } catch (error) {
      api.setConfig('', '');
      nativeCapabilities.clearSecureConnection();
      markDisconnected();
      if (!silent) showAlertOnce('Connection Failed', error instanceof Error ? error.message : 'The connection could not be completed.');
      return false;
    } finally {
      connectionAttemptRef.current = false;
      setIsConnecting(false);
      setPairingDesktopName(null);
    }
  }, [
    connectionAttemptRef,
    confirmHttpFallback,
    effectiveAllowInsecureHttp,
    getDeviceIdentity,
    markDisconnected,
    markHttpConnected,
    markSecureConnected,
    nativeHttpsAvailable,
    setAppState,
    setIsConnecting,
    setPairingDesktopName,
    showAlertOnce,
  ]);

  const handleDiscoveredServer = React.useCallback(async (server: DiscoveredServer) => {
    if (connectionAttemptRef.current) return;
    connectionAttemptRef.current = true;
    setIsConnecting(true);
    try {
      const storedValue = await AsyncStorage.getItem(connectionStorageKeys.lastServer());
      const saved = parseSavedConnection(storedValue);
      if (storedValue && !saved) {
        await AsyncStorage.removeItem(connectionStorageKeys.lastServer()).catch(() => undefined);
      }
      if (!saved || saved.environment !== server.environment ||
          server.environment !== expectedServerEnvironment() || saved.serverId !== server.serverId ||
          normalizeFingerprint(saved.certificateFingerprint) !== normalizeFingerprint(server.certificateFingerprint)) {
        showAlertOnce(
          'Scan QR to trust this desktop',
          'Discovery can find a desktop, but the first secure connection requires its pairing QR code.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Scan QR', onPress: openQrScanner },
          ],
        );
        return;
      }
      const credential = await SecureStore.getItemAsync(connectionStorageKeys.deviceCredential());
      if (!credential) {
        await AsyncStorage.removeItem(connectionStorageKeys.lastServer());
        showAlertOnce(
          'Pairing required',
          'The approved-device credential is missing. Scan the Windows QR again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Scan QR', onPress: openQrScanner },
          ],
        );
        return;
      }
      const refreshed = { ...saved, httpsUrl: `https://${server.address}:${server.httpsPort}` };
      if (await connectTrusted(refreshed, credential, false)) {
        await AsyncStorage.setItem(connectionStorageKeys.lastServer(), JSON.stringify(refreshed));
      }
    } catch {
      showAlertOnce(
        'Could not use nearby discovery',
        'The saved connection could not be read. Scan the Windows QR code to reconnect securely.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Scan QR', onPress: openQrScanner },
        ],
      );
    } finally {
      connectionAttemptRef.current = false;
      setIsConnecting(false);
    }
  }, [connectTrusted, connectionAttemptRef, openQrScanner, setIsConnecting, showAlertOnce]);

  const updateAllowInsecureHttp = React.useCallback(async (enabled: boolean) => {
    if (!nativeHttpsAvailable) {
      showAlertOnce('Expo Go uses HTTP', 'Expo Go cannot use pinned HTTPS because the native module is not loaded. Install the IPA to use encrypted HTTPS.');
      return;
    }
    if (enabled) {
      const confirmed = await confirmOnce(
        'Allow unencrypted HTTP?',
        'Keep this off unless you need compatibility with an older desktop build. HTTPS stays preferred, and each HTTP session still asks for confirmation.',
        'Allow HTTP',
        'destructive',
      );
      if (!confirmed) return;
    }
    if (!enabled) httpConfirmedRef.current = false;
    await persistAllowInsecureHttp(enabled);
    if (!enabled && connectionSecurity.mode === 'http') {
      api.setConfig('', '');
      nativeCapabilities.clearSecureConnection();
      markDisconnected();
      setAppState('connection');
      showAlertOnce('HTTP connection closed', 'Unencrypted HTTP was turned off, so the current HTTP desktop connection was disconnected. Reconnect with encrypted HTTPS or enable HTTP again for compatibility.');
    }
  }, [confirmOnce, connectionSecurity.mode, markDisconnected, nativeHttpsAvailable, persistAllowInsecureHttp, setAppState, showAlertOnce]);

  const resetHttpSessionApproval = React.useCallback(() => {
    httpConfirmedRef.current = false;
  }, []);

  return {
    isConnectingRef: connectionAttemptRef,
    handleConnect,
    handleDiscoveredServer,
    updateAllowInsecureHttp,
    explainUnencryptedHttp,
    explainNearbyDiscovery,
    resetHttpSessionApproval,
  };
}
