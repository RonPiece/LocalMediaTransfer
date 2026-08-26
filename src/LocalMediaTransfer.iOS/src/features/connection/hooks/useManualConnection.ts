import React from 'react';
import { Alert, LayoutAnimation } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PairingPayload, normalizeFingerprint } from '@/security/ConnectionSecurity';
import { expectedServerEnvironment } from '@/services/NativeCapabilities';

type ConnectManually = (
  ipOrUrl: string,
  token: string,
  pairing?: PairingPayload,
) => Promise<boolean | void> | boolean | void;

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
  const onConnectRef = React.useRef(onConnect);

  React.useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  const toggleManualEntry = React.useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setManualEntryOpen(value => !value);
  }, []);

  const connectManually = React.useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    const normalized = normalizeFingerprint(fingerprint);
    const input = ip.trim();
    const secureUrl = input.startsWith('http')
      ? input
      : nativeHttpsAvailable
        ? `https://${input}:8443`
        : `http://${input}:8080`;
    if (!nativeHttpsAvailable && secureUrl.startsWith('https://')) {
      Alert.alert(
        'Expo Go requires HTTP',
        'Enter the desktop as http://address:8080. Pinned HTTPS is available in the installed iOS app.',
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
  }, [fingerprint, ip, manualToken, nativeHttpsAvailable]);

  return {
    ip,
    setIp,
    fingerprint,
    setFingerprint,
    manualToken,
    setManualToken,
    manualEntryOpen,
    toggleManualEntry,
    connectManually,
    canConnectManually: ip.trim().length > 0,
  };
}
