import React from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { connectionText } from './content/connectionText';
import { ConnectionOptionsSection } from './components/ConnectionOptionsSection';
import { NearbyDesktopSection } from './components/NearbyDesktopSection';
import { PairingApprovalBanner } from './components/PairingApprovalBanner';
import { QrScannerOverlay } from './components/QrScannerOverlay';
import { PrimaryButton } from '@/components/ui';
import { useManualConnection } from './hooks/useManualConnection';
import { useQrScanner } from './hooks/useQrScanner';
import { DiscoveredServer, nativeCapabilities } from '@/services/NativeCapabilities';
import { PairingPayload } from '@/security/ConnectionSecurity';

interface ConnectionScreenProps {
  onConnect: (ipOrUrl: string, token: string, pairing?: PairingPayload) => Promise<boolean | void> | boolean | void;
  onConnectDiscovered?: (server: DiscoveredServer) => Promise<void> | void;
  discoveredServers?: DiscoveredServer[];
  isDiscovering?: boolean;
  discoveryFailed?: boolean;
  isConnecting?: boolean;
  nearbyDiscoveryEnabled?: boolean;
  allowInsecureHttp?: boolean;
  nativeHttpsAvailable?: boolean;
  onAllowInsecureHttpChange?: (enabled: boolean) => void;
  onExplainUnencryptedHttp?: () => void;
  onExplainNearbyDiscovery?: () => void;
  onEnableNearbyDiscovery?: () => void;
  onRefreshDiscovery?: () => void;
  scanRequestId?: number;
  pairingDesktopName?: string | null;
}

export default function ConnectionScreen({
  onConnect,
  onConnectDiscovered = () => undefined,
  discoveredServers = [],
  isDiscovering = false,
  discoveryFailed = false,
  isConnecting = false,
  nearbyDiscoveryEnabled = false,
  allowInsecureHttp = false,
  nativeHttpsAvailable = nativeCapabilities.available,
  onAllowInsecureHttpChange = () => undefined,
  onExplainUnencryptedHttp = () => undefined,
  onExplainNearbyDiscovery = () => undefined,
  onEnableNearbyDiscovery = () => undefined,
  onRefreshDiscovery = () => undefined,
  scanRequestId = 0,
  pairingDesktopName = null,
}: ConnectionScreenProps) {
  const qrScanner = useQrScanner({ onConnect });
  const manualConnection = useManualConnection({ onConnect, nativeHttpsAvailable });
  const { startScanning } = qrScanner;

  React.useEffect(() => {
    if (scanRequestId > 0) startScanning();
  }, [scanRequestId, startScanning]);

  if (qrScanner.isScanning) {
    return (
      <QrScannerOverlay
        onClose={qrScanner.stopScanning}
        onBarcodeScanned={qrScanner.handleBarCodeScanned}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 items-center px-5 pb-10 pt-6">
            <View className="w-20 h-20 mb-4 items-center justify-center">
              <Image
                source={require('../../../assets/app-icon.png')}
                className="w-20 h-20 rounded-[18px]"
              />
            </View>

            <Text className="text-[28px] font-bold text-on-surface mb-2 text-center">
              {connectionText.title}
            </Text>
            <Text className="text-[15px] text-on-surface-variant text-center max-w-[280px] mb-8 leading-5">
              {connectionText.subtitle}
            </Text>

            {pairingDesktopName && <PairingApprovalBanner desktopName={pairingDesktopName} />}

            <NearbyDesktopSection
              discoveredServers={discoveredServers}
              isDiscovering={isDiscovering}
              discoveryFailed={discoveryFailed}
              isConnecting={isConnecting}
              nearbyDiscoveryEnabled={nearbyDiscoveryEnabled}
              nativeHttpsAvailable={nativeHttpsAvailable}
              onConnectDiscovered={onConnectDiscovered}
              onEnableNearbyDiscovery={onEnableNearbyDiscovery}
              onExplainNearbyDiscovery={onExplainNearbyDiscovery}
              onRefreshDiscovery={onRefreshDiscovery}
            />

            <PrimaryButton
              title={connectionText.scanQr}
              icon="qr-code-outline"
              onPress={qrScanner.startScanning}
              disabled={isConnecting}
              className="mb-6"
            />

            <View className="flex-row items-center w-full mb-4">
              <View className="flex-1 h-[0.5px] bg-border" />
              <Text className="text-on-surface-variant mx-3 text-[13px] font-medium uppercase tracking-wide">
                {connectionText.otherOptions}
              </Text>
              <View className="flex-1 h-[0.5px] bg-border" />
            </View>

            <ConnectionOptionsSection
              ip={manualConnection.ip}
              fingerprint={manualConnection.fingerprint}
              manualToken={manualConnection.manualToken}
              manualEntryOpen={manualConnection.manualEntryOpen}
              isConnecting={isConnecting}
              canConnectManually={manualConnection.canConnectManually}
              nativeHttpsAvailable={nativeHttpsAvailable}
              allowInsecureHttp={allowInsecureHttp}
              onIpChange={manualConnection.setIp}
              onFingerprintChange={manualConnection.setFingerprint}
              onManualTokenChange={manualConnection.setManualToken}
              onToggleManualEntry={manualConnection.toggleManualEntry}
              onConnectManually={manualConnection.connectManually}
              onAllowInsecureHttpChange={onAllowInsecureHttpChange}
              onExplainUnencryptedHttp={onExplainUnencryptedHttp}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
