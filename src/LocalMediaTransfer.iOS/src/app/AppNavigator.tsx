import React from 'react';
import { Animated, Easing, useAnimatedValue } from 'react-native';
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

export type NavigationProps = {
  appState: ScreenState;
  selectedAssets: MediaAsset[];
  scanRequestId: number;
  onOpenPicker: () => void;
  onTransfer: (assets: MediaAsset[]) => void;
  onCancelPicker: () => void;
  onCancelTransfer: () => void;
  onCompleteTransfer: () => void;
};

export type ConnectionProps = {
  isServerConnected: boolean;
  isConnecting: boolean;
  pairingDesktopName: string | null;
  connectionSecurity: ConnectionSecurityState;
  connectionHealthStatus: ConnectionHealthStatus;
  onConnect: (ipOrUrl: string, token?: string, pairing?: PairingPayload, silent?: boolean) => Promise<boolean>;
  onConnectDiscovered: (server: DiscoveredServer) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRetryConnection: () => void;
};

export type PreferenceProps = {
  nearbyDiscoveryEnabled: boolean;
  allowInsecureHttp: boolean;
  nativeHttpsAvailable: boolean;
  preparationMode: PreparationMode;
  skipExactDuplicates: boolean;
  includeAdditionalMediaComponents: boolean;
  onAllowInsecureHttpChange: (enabled: boolean) => Promise<void>;
  onExplainUnencryptedHttp: () => void;
  onExplainNearbyDiscovery: () => void;
  onNearbyDiscoveryChange: (enabled: boolean) => void;
  onPreparationModeChange: (mode: PreparationMode) => void;
  onSkipExactDuplicatesChange: (enabled: boolean) => void;
  onIncludeAdditionalMediaComponentsChange: (enabled: boolean) => void;
};

export type DiscoveryProps = {
  discoveredServers: DiscoveredServer[];
  isDiscovering: boolean;
  discoveryFailed: boolean;
  onEnableNearbyDiscovery: () => void;
  onRefreshDiscovery: () => void | Promise<void>;
};

export type AppNavigatorProps = {
  navigation: NavigationProps;
  connection: ConnectionProps;
  preferences: PreferenceProps;
  discovery: DiscoveryProps;
};

export default function AppNavigator({ navigation, connection, preferences, discovery }: AppNavigatorProps) {
  const {
    appState,
    selectedAssets,
    scanRequestId,
    onOpenPicker,
    onTransfer,
    onCancelPicker,
    onCancelTransfer,
    onCompleteTransfer,
  } = navigation;
  const {
    isServerConnected,
    isConnecting,
    pairingDesktopName,
    connectionSecurity,
    connectionHealthStatus,
    onConnect,
    onConnectDiscovered,
    onDisconnect,
    onRetryConnection,
  } = connection;
  const {
    nearbyDiscoveryEnabled,
    allowInsecureHttp,
    nativeHttpsAvailable,
    preparationMode,
    skipExactDuplicates,
    includeAdditionalMediaComponents,
    onAllowInsecureHttpChange,
    onExplainUnencryptedHttp,
    onExplainNearbyDiscovery,
    onNearbyDiscoveryChange,
    onPreparationModeChange,
    onSkipExactDuplicatesChange,
    onIncludeAdditionalMediaComponentsChange,
  } = preferences;
  const {
    discoveredServers,
    isDiscovering,
    discoveryFailed,
    onEnableNearbyDiscovery,
    onRefreshDiscovery,
  } = discovery;
  const transition = useAnimatedValue(1);
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
