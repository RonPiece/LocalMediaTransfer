import React from 'react';
import { Alert } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { connectionText } from '../content/connectionText';
import { nativeCapabilities } from '@/services/NativeCapabilities';
import {
  PairingPayload,
  UnsupportedPairingPayloadVersionError,
  parseLegacyConnectionUrl,
  parsePairingPayload,
} from '@/security/ConnectionSecurity';

type ConnectFromQr = (
  ipOrUrl: string,
  token: string,
  pairing?: PairingPayload,
) => Promise<boolean | void> | boolean | void;

export function useQrScanner({
  onConnect,
}: {
  onConnect: ConnectFromQr;
}) {
  const [isScanning, setIsScanning] = React.useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scanHandledRef = React.useRef(false);
  const onConnectRef = React.useRef(onConnect);

  React.useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  const stopScanning = React.useCallback(() => {
    setIsScanning(false);
  }, []);

  const connectFromScan = React.useCallback(async (
    ipOrUrl: string,
    token: string,
    pairing?: PairingPayload,
  ) => {
    try {
      let connected: boolean | void;
      if (pairing) {
        connected = await onConnectRef.current(ipOrUrl, token, pairing);
      } else {
        connected = await onConnectRef.current(ipOrUrl, token);
      }
      if (connected === false) {
        scanHandledRef.current = false;
      }
    } catch {
      console.error('QR connection attempt failed.');
      scanHandledRef.current = false;
      setIsScanning(false);
      Alert.alert(connectionText.connectionFailedTitle, connectionText.connectionFailedMessage);
    }
  }, []);

  const handleBarCodeScanned = React.useCallback(({ data }: { data: string }) => {
    if (scanHandledRef.current) return;
    scanHandledRef.current = true;
    setIsScanning(false);

    let pairing: PairingPayload | null;
    try {
      pairing = parsePairingPayload(data);
    } catch (error) {
      if (error instanceof UnsupportedPairingPayloadVersionError) {
        Alert.alert(
          connectionText.unsupportedPairingVersionTitle,
          connectionText.unsupportedPairingVersionMessage(error.version),
        );
        return;
      }
      Alert.alert(connectionText.unsupportedQrTitle, connectionText.unsupportedQrMessage);
      return;
    }

    if (pairing) {
      if (!nativeCapabilities.available && pairing.httpUrl) {
        void connectFromScan(pairing.httpUrl, pairing.token);
        return;
      }
      void connectFromScan(pairing.httpsUrl, pairing.token, pairing);
      return;
    }

    const legacyUrl = parseLegacyConnectionUrl(data);
    if (legacyUrl) {
      void connectFromScan(legacyUrl.baseUrl, legacyUrl.token);
      return;
    }

    Alert.alert(connectionText.unsupportedQrTitle, connectionText.unsupportedQrMessage);
  }, [connectFromScan]);

  const startScanning = React.useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      if (!permission?.granted) {
        const { granted } = await requestPermission();
        if (!granted) {
          Alert.alert(connectionText.cameraPermissionTitle, connectionText.cameraPermissionMessage);
          return;
        }
      }
      scanHandledRef.current = false;
      setIsScanning(true);
    } catch {
      Alert.alert(
        connectionText.cameraUnavailableTitle,
        connectionText.cameraUnavailableMessage,
      );
    }
  }, [permission?.granted, requestPermission]);

  return {
    isScanning,
    startScanning,
    stopScanning,
    handleBarCodeScanned,
  };
}
