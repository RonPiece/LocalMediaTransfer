import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { connectionText } from './content/connectionText';
import { ConnectionOptionsSection } from './components/ConnectionOptionsSection';
import { NearbyDesktopSection } from './components/NearbyDesktopSection';
import { PairingApprovalBanner } from './components/PairingApprovalBanner';
import { QrScannerOverlay } from './components/QrScannerOverlay';
import { Card, IconTile, ScreenHeader, SectionLabel, StatusBadge } from '@/components/ui';
import { useManualConnection } from './hooks/useManualConnection';
import { useQrScanner } from './hooks/useQrScanner';
import { DiscoveredServer, nativeCapabilities } from '@/services/NativeCapabilities';
import { PairingPayload } from '@/security/ConnectionSecurity';
import { SavedConnection } from '@/app/types';
import { useThemePalette } from '@/theme';

function savedReceiverLabel(savedReceiver: SavedConnection): string {
  if (savedReceiver.name?.trim()) return savedReceiver.name.trim();
  try {
    return new URL(savedReceiver.httpsUrl).hostname || 'Trusted receiver';
  } catch {
    return 'Trusted receiver';
  }
}

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
  isConnected?: boolean;
  savedReceiver?: SavedConnection | null;
  onConnectTrusted?: () => Promise<void> | void;
  onDisconnect?: () => Promise<void> | void;
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
  isConnected = false,
  savedReceiver = null,
  onConnectTrusted = () => undefined,
  onDisconnect = () => undefined,
}: ConnectionScreenProps) {
  const palette = useThemePalette();
  const qrScanner = useQrScanner({ onConnect });
  const manualConnection = useManualConnection({ onConnect, nativeHttpsAvailable });
  const { startScanning } = qrScanner;
  const qrDisabled = isConnecting || isConnected;

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
    <SafeAreaView edges={['top']} className="flex-1 bg-background dark:bg-background-dark">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <ScreenHeader title="Connect" subtitle="Pair with a receiver on your local network" />
          <View className="flex-1 px-5 pb-8">

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Scan Receiver QR"
              disabled={qrDisabled}
              onPress={qrScanner.startScanning}
              activeOpacity={0.82}
              className={`rounded-[18px] px-4 py-4 flex-row items-center mb-4 border ${qrDisabled ? 'bg-surface dark:bg-surface-dark border-border dark:border-border-dark opacity-70' : 'bg-primary dark:bg-primary-dark border-primary dark:border-primary-dark'}`}
            >
              <View className={`w-12 h-12 rounded-2xl items-center justify-center ${qrDisabled ? 'bg-primary/10 dark:bg-primary-dark/20' : 'bg-white/20'}`}>
                <Ionicons name="qr-code-outline" size={29} color={qrDisabled ? palette.onSurfaceVariant : '#FFFFFF'} />
              </View>
              <View className="flex-1 ml-3">
                <Text className={`text-[18px] font-bold ${qrDisabled ? 'text-on-surface dark:text-on-surface-dark' : 'text-white'}`}>Scan Receiver QR</Text>
                <Text className={`text-[13px] mt-0.5 ${qrDisabled ? 'text-on-surface-variant dark:text-on-surface-variant-dark' : 'text-white/80'}`}>Point your camera at the QR code shown on Windows.</Text>
              </View>
              <Ionicons name="chevron-forward" size={23} color={qrDisabled ? palette.onSurfaceVariant : '#FFFFFF'} />
            </TouchableOpacity>

            {pairingDesktopName && <PairingApprovalBanner desktopName={pairingDesktopName} />}

            {isConnected && (
              <View className="rounded-xl bg-success/10 px-4 py-3 mb-4 flex-row items-center">
                <Ionicons name="checkmark-circle" size={20} color={palette.success} />
                <Text className="text-[13px] text-success dark:text-success-dark font-semibold ml-2 flex-1">Disconnect before pairing with another receiver.</Text>
              </View>
            )}

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
              isConnected={isConnected}
              onDisconnect={onDisconnect}
            />

            <ConnectionOptionsSection
              ip={manualConnection.ip}
              fingerprint={manualConnection.fingerprint}
              manualToken={manualConnection.manualToken}
              manualEntryOpen={manualConnection.manualEntryOpen}
              isConnecting={isConnecting || isConnected}
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

            <View className="w-full mb-5">
              <SectionLabel>{connectionText.trustedReceiversTitle}</SectionLabel>
              <Card className="dark:bg-surface-dark border border-border dark:border-border-dark">
                {savedReceiver ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Reconnect to trusted receiver"
                    disabled={isConnecting || isConnected}
                    onPress={() => void onConnectTrusted()}
                    className={`p-4 flex-row items-center ${isConnecting || isConnected ? 'opacity-40' : ''}`}
                  >
                    <IconTile icon="star-outline" />
                    <View className="flex-1 min-w-0">
                      <Text className="text-[16px] font-semibold text-on-surface dark:text-on-surface-dark" numberOfLines={1}>{savedReceiverLabel(savedReceiver)}</Text>
                      <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-0.5" numberOfLines={1}>{savedReceiver.httpsUrl}</Text>
                    </View>
                    <StatusBadge label="Trusted" tone="success" icon="checkmark-circle" />
                    <Ionicons name="chevron-forward" size={18} color={palette.onSurfaceVariant} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                ) : (
                  <View className="p-4 flex-row items-center">
                    <IconTile icon="star-outline" />
                    <Text className="text-[14px] leading-5 text-on-surface-variant dark:text-on-surface-variant-dark flex-1">A receiver appears here after secure QR pairing and Windows approval.</Text>
                  </View>
                )}
              </Card>
            </View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
