import React from 'react';
import { Animated, Easing } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { TestEnvironmentBanner } from '@/components/TestEnvironmentBanner';
import ConnectionScreen from '@/features/connection/ConnectionScreen';
import DashboardScreen from '@/features/dashboard/DashboardScreen';
import MediaPickerScreen from '@/features/media/MediaPickerScreen';
import TransferProgressScreen from '@/features/transfer/TransferProgressScreen';
import { MediaAsset } from '@/services/MediaScanner';
import { DiscoveredServer } from '@/services/NativeCapabilities';
import { PairingPayload } from '@/security/ConnectionSecurity';
import { ConnectionHealthStatus, ConnectionSecurityState, ScreenState } from './types';
import { PreparationMode } from '@/services/upload/types';

export type AppNavigatorProps = {
  appState: ScreenState;
  selectedAssets: MediaAsset[];
  isServerConnected: boolean;
  isConnecting: boolean;
  pairingDesktopName: string | null;
  connectionSecurity: ConnectionSecurityState;
  connectionHealthStatus: ConnectionHealthStatus;
  discoveredServers: DiscoveredServer[];
  isDiscovering: boolean;
  discoveryFailed: boolean;
  nearbyDiscoveryEnabled: boolean;
  allowInsecureHttp: boolean;
  nativeHttpsAvailable: boolean;
  preparationMode: PreparationMode;
  skipExactDuplicates: boolean;
  includeAdditionalMediaComponents: boolean;
  scanRequestId: number;
  onConnect: (ipOrUrl: string, token?: string, pairing?: PairingPayload, silent?: boolean) => Promise<boolean>;
  onConnectDiscovered: (server: DiscoveredServer) => Promise<void>;
  onAllowInsecureHttpChange: (enabled: boolean) => Promise<void>;
  onExplainUnencryptedHttp: () => void;
  onExplainNearbyDiscovery: () => void;
  onEnableNearbyDiscovery: () => void;
  onRefreshDiscovery: () => void | Promise<void>;
  onNearbyDiscoveryChange: (enabled: boolean) => void;
  onPreparationModeChange: (mode: PreparationMode) => void;
  onSkipExactDuplicatesChange: (enabled: boolean) => void;
  onIncludeAdditionalMediaComponentsChange: (enabled: boolean) => void;
  onOpenPicker: () => void;
  onTransfer: (assets: MediaAsset[]) => void;
  onCancelPicker: () => void;
  onCancelTransfer: () => void;
  onCompleteTransfer: () => void;
  onDisconnect: () => Promise<void>;
  onRetryConnection: () => void;
};

export default function AppNavigator({
  appState,
  selectedAssets,
  isServerConnected,
  isConnecting,
  pairingDesktopName,
  connectionSecurity,
  connectionHealthStatus,
  discoveredServers,
  isDiscovering,
  discoveryFailed,
  nearbyDiscoveryEnabled,
  allowInsecureHttp,
  nativeHttpsAvailable,
  preparationMode,
  skipExactDuplicates,
  includeAdditionalMediaComponents,
  scanRequestId,
  onConnect,
  onConnectDiscovered,
  onAllowInsecureHttpChange,
  onExplainUnencryptedHttp,
  onExplainNearbyDiscovery,
  onEnableNearbyDiscovery,
  onRefreshDiscovery,
  onNearbyDiscoveryChange,
  onPreparationModeChange,
  onSkipExactDuplicatesChange,
  onIncludeAdditionalMediaComponentsChange,
  onOpenPicker,
  onTransfer,
  onCancelPicker,
  onCancelTransfer,
  onCompleteTransfer,
  onDisconnect,
  onRetryConnection,
}: AppNavigatorProps) {
  const transition = React.useRef(new Animated.Value(1)).current;
  const previousState = React.useRef(appState);

  React.useLayoutEffect(() => {
    if (previousState.current === appState) return;
    previousState.current = appState;
    transition.stopAnimation();
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [appState, transition]);

  const transitionStyle = React.useMemo(() => ({
    flex: 1,
    opacity: transition,
    transform: [{
      translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
    }],
  }), [transition]);

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <TestEnvironmentBanner />
        <Animated.View style={transitionStyle}>
          {appState === 'connection' && (
            <ConnectionScreen
              onConnect={onConnect}
              onConnectDiscovered={onConnectDiscovered}
              discoveredServers={discoveredServers}
              isDiscovering={isDiscovering}
              discoveryFailed={discoveryFailed}
              isConnecting={isConnecting}
              nearbyDiscoveryEnabled={nearbyDiscoveryEnabled}
              allowInsecureHttp={allowInsecureHttp}
              nativeHttpsAvailable={nativeHttpsAvailable}
              onAllowInsecureHttpChange={onAllowInsecureHttpChange}
              onExplainUnencryptedHttp={onExplainUnencryptedHttp}
              onExplainNearbyDiscovery={onExplainNearbyDiscovery}
              onEnableNearbyDiscovery={onEnableNearbyDiscovery}
              onRefreshDiscovery={onRefreshDiscovery}
              scanRequestId={scanRequestId}
              pairingDesktopName={pairingDesktopName}
            />
          )}
          {appState === 'dashboard' && (
            <DashboardScreen
              isConnected={isServerConnected}
              connectionSecurity={connectionSecurity}
              connectionHealthStatus={connectionHealthStatus}
              allowInsecureHttp={allowInsecureHttp}
              nativeHttpsAvailable={nativeHttpsAvailable}
              onAllowInsecureHttpChange={onAllowInsecureHttpChange}
              onExplainUnencryptedHttp={onExplainUnencryptedHttp}
              nearbyDiscoveryEnabled={nearbyDiscoveryEnabled}
              onNearbyDiscoveryChange={onNearbyDiscoveryChange}
              preparationMode={preparationMode}
              onPreparationModeChange={onPreparationModeChange}
              skipExactDuplicates={skipExactDuplicates}
              onSkipExactDuplicatesChange={onSkipExactDuplicatesChange}
              includeAdditionalMediaComponents={includeAdditionalMediaComponents}
              onIncludeAdditionalMediaComponentsChange={onIncludeAdditionalMediaComponentsChange}
              onTransferMedia={onOpenPicker}
              onDisconnect={onDisconnect}
              onRetryConnection={onRetryConnection}
            />
          )}
          {appState === 'picker' && <MediaPickerScreen onTransfer={onTransfer} onDisconnect={onCancelPicker} />}
          {appState === 'transfer' && (
            <TransferProgressScreen
              assets={selectedAssets}
              preparationMode={preparationMode}
              skipExactDuplicates={skipExactDuplicates}
              includeAdditionalMediaComponents={includeAdditionalMediaComponents}
              onCancel={onCancelTransfer}
              onComplete={onCompleteTransfer}
            />
          )}
        </Animated.View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
