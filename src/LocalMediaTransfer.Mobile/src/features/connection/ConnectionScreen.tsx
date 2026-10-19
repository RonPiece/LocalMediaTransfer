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
import { Card, IconTile, ScreenHeader, SectionLabel } from '@/components/ui';
import { useManualConnection } from './hooks/useManualConnection';
import { useQrScanner } from './hooks/useQrScanner';
import { DiscoveredServer, nativeCapabilities } from '@/services/NativeCapabilities';
import { PairingPayload } from '@/security/ConnectionSecurity';
import { SavedConnection } from '@/app/types';
import { actionAppearance, useThemePalette } from '@/theme';
import { ActiveConnection } from './connectionPresentation';
import { ReceiverRow } from './components/ReceiverRow';
import { useConnectionDetails } from './hooks/useConnectionDetails';
import { ConnectionDetailsModal } from '@/features/dashboard/components/ConnectionDetailsModal';

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
  activeConnection?: ActiveConnection | null;
  savedReceiver?: SavedConnection | null;
  onConnectTrusted?: () => Promise<void> | void;
  onDisconnect?: () => Promise<void> | void;
}

export default function ConnectionScreen(props: ConnectionScreenProps) {
  const nativeHttpsAvailable = props.nativeHttpsAvailable ?? (nativeCapabilities.capabilities?.pinnedHttps ?? nativeCapabilities.available);
  const qrScanner = useQrScanner({ onConnect: props.onConnect });
  const manualConnection = useManualConnection({ onConnect: props.onConnect, nativeHttpsAvailable });
  return <ConnectionScreenView {...props} nativeHttpsAvailable={nativeHttpsAvailable} qrScanner={qrScanner} manualConnection={manualConnection} />;
}

export function ConnectionScreenView({
  onConnectDiscovered = () => undefined,
  discoveredServers = [],
  isDiscovering = false,
  discoveryFailed = false,
  isConnecting = false,
  nearbyDiscoveryEnabled = false,
  allowInsecureHttp = false,
  nativeHttpsAvailable = nativeCapabilities.capabilities?.pinnedHttps ?? nativeCapabilities.available,
  onAllowInsecureHttpChange = () => undefined,
  onExplainUnencryptedHttp = () => undefined,
  onExplainNearbyDiscovery = () => undefined,
  onEnableNearbyDiscovery = () => undefined,
  onRefreshDiscovery = () => undefined,
  scanRequestId = 0,
  pairingDesktopName = null,
  isConnected = false,
  activeConnection = null,
  savedReceiver = null,
  onConnectTrusted = () => undefined,
  onDisconnect = () => undefined,
  qrScanner,
  manualConnection,
  cameraContent,
}: ConnectionScreenProps & {
  qrScanner: ReturnType<typeof useQrScanner>;
  manualConnection: ReturnType<typeof useManualConnection>;
  cameraContent?: React.ReactNode;
}) {
  const palette = useThemePalette();
  const details = useConnectionDetails(activeConnection);
  const { startScanning } = qrScanner;
  const qrDisabled = isConnecting || isConnected;

  React.useEffect(() => {
    if (scanRequestId > 0 && !qrDisabled) startScanning();
  }, [scanRequestId, startScanning, qrDisabled]);

  const qrAppearance = actionAppearance(palette, 'primary', { disabled: qrDisabled });

  if (qrScanner.isScanning) {
    return (
      <QrScannerOverlay
        cameraContent={cameraContent}
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
              accessibilityLabel={isConnected ? "Disconnect before pairing with another receiver" : "Scan Receiver QR"}
              accessibilityState={{ disabled: qrDisabled }}
              disabled={qrDisabled}
              onPress={qrScanner.startScanning}
              activeOpacity={qrAppearance.activeOpacity}
              style={qrAppearance.container}
              className="rounded-[18px] px-4 py-4 flex-row items-center mb-4 border"
            >
              <View className={`w-12 h-12 rounded-2xl items-center justify-center ${qrDisabled ? 'bg-primary-soft dark:bg-primary-soft-dark' : 'bg-white/20'}`}>
                <Ionicons name="qr-code-outline" size={29} color={qrAppearance.foreground} />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-[18px] font-bold" style={{ color: qrAppearance.foreground }}>{isConnected ? "Disconnect before pairing with another receiver" : "Scan Receiver QR"}</Text>
                {!isConnected && <Text className={`text-[13px] mt-0.5 ${qrDisabled ? 'text-on-surface-variant dark:text-on-surface-variant-dark' : 'text-white/80'}`}>Point your camera at the QR code shown on Windows.</Text>}
              </View>
              {!qrDisabled && <Ionicons name="chevron-forward" size={23} color={qrAppearance.foreground} />}
            </TouchableOpacity>

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
              isConnected={isConnected}
              onDisconnect={onDisconnect}
              activeConnection={activeConnection}
              onOpenDetails={details.open}
            />

            <ConnectionOptionsSection
              ip={manualConnection.ip}
              fingerprint={manualConnection.fingerprint}
              manualToken={manualConnection.manualToken}
              manualEntryOpen={manualConnection.manualEntryOpen}
              isConnecting={isConnecting || isConnected}
              canConnectManually={manualConnection.canConnectManually}
              addressError={manualConnection.addressError}
              fingerprintError={manualConnection.fingerprintError}
              tokenError={manualConnection.tokenError}
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
                  <ReceiverRow name={savedReceiverLabel(savedReceiver)} address={savedReceiver.httpsUrl} trusted
                    activeConnection={activeConnection} isConnected={isConnected} isConnecting={isConnecting}
                    onConnect={() => void onConnectTrusted()} onOpenDetails={details.open} />
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
      <ConnectionDetailsModal visible={details.visible} connection={activeConnection} onClose={details.close} />
    </SafeAreaView>
  );
}
