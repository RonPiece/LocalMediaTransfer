import React from 'react';
import { Alert, LayoutAnimation } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PairingPayload, normalizeFingerprint } from '@/security/ConnectionSecurity';
import { expectedServerEnvironment } from '@/services/NativeCapabilities';
import { useReduceMotionEnabled } from '@/theme';

type ConnectManually = (
  ipOrUrl: string,
  token: string,
  pairing?: PairingPayload,
) => Promise<boolean | void> | boolean | void;

export function manualAddressUrl(input: string, nativeHttpsAvailable: boolean): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const value = trimmed.includes('://')
      ? trimmed
      : `${nativeHttpsAvailable ? 'https' : 'http'}://${trimmed}${/:[0-9]+$/.test(trimmed) ? '' : `:${nativeHttpsAvailable ? 8443 : 8080}`}`;
    const parsed = new URL(value);
    if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function useManualConnection({
  onConnect,
  nativeHttpsAvailable,
}: {
  onConnect: ConnectManually;
  nativeHttpsAvailable: boolean;
}) {
  const [ip, setIp] = React.useState('');
  const [fingerprint, setFingerprint] = React.useState('');
  const [manualToken, setManualToken] = React.useState('');
  const [manualEntryOpen, setManualEntryOpen] = React.useState(false);
  const reduceMotion = useReduceMotionEnabled();
  const onConnectRef = React.useRef(onConnect);
  const address = manualAddressUrl(ip, nativeHttpsAvailable);
  const securePairingRequired = nativeHttpsAvailable && address?.startsWith('https://') === true;
  const fingerprintValid = /^[0-9a-f]{64}$/.test(normalizeFingerprint(fingerprint));
  const [fingerprintTouched, setFingerprintTouched] = React.useState(false);
  const [tokenTouched, setTokenTouched] = React.useState(false);
  const changeFingerprint = React.useCallback((value: string) => {
    setFingerprintTouched(true);
    setFingerprint(value);
  }, []);
  const changeManualToken = React.useCallback((value: string) => {
    setTokenTouched(true);
    setManualToken(value);
  }, []);

  React.useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  const toggleManualEntry = React.useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setManualEntryOpen(value => !value);
  }, [reduceMotion]);

  const connectManually = React.useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    const normalized = normalizeFingerprint(fingerprint);
    const secureUrl = manualAddressUrl(ip, nativeHttpsAvailable);
    if (!secureUrl || (securePairingRequired && (!fingerprintValid || !manualToken.trim()))) return;
    if (!nativeHttpsAvailable && secureUrl.startsWith('https://')) {
      Alert.alert(
        'Expo Go requires HTTP',
        'Enter the desktop as http://address:8080. Pinned HTTPS is available in the installed mobile app.',
      );
      return;
    }
    const manualPairing = secureUrl.startsWith('https://') && normalized.length === 64
      ? {
        type: 'lmt-pair' as const,
        version: 3 as const,
        environment: expectedServerEnvironment(),
        serverId: '',
        name: 'Manual desktop',
        httpsUrl: secureUrl,
        certificateFingerprint: normalized,
        token: manualToken.trim(),
      }
      : undefined;
    try {
      void Promise.resolve(
        onConnectRef.current(secureUrl, manualToken.trim(), manualPairing),
      ).catch(() => {
        Alert.alert(
          'Connection failed',
          'The connection attempt could not be completed. Check that Windows is running and try again.',
        );
      });
    } catch {
      Alert.alert(
        'Connection failed',
        'The connection attempt could not be completed. Check that Windows is running and try again.',
      );
    }
  }, [fingerprint, fingerprintValid, ip, manualToken, nativeHttpsAvailable, securePairingRequired]);

  return {
    ip,
    setIp,
    fingerprint,
    setFingerprint: changeFingerprint,
    manualToken,
    setManualToken: changeManualToken,
    manualEntryOpen,
    toggleManualEntry,
    connectManually,
    canConnectManually: !!address && (!securePairingRequired || (fingerprintValid && !!manualToken.trim())),
    addressError: ip.trim() && !address ? 'Enter a valid receiver address without a path or query.' : null,
    fingerprintError: securePairingRequired && (fingerprintTouched || fingerprint.trim()) && !fingerprintValid
      ? 'Enter the complete 64-character SHA-256 fingerprint.' : null,
    tokenError: securePairingRequired && tokenTouched && !manualToken.trim()
      ? 'Enter the session token shown in Windows.' : null,
  };
}
