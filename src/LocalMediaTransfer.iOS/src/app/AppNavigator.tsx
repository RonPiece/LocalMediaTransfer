import React from 'react';
import { Animated, Easing, Text, useAnimatedValue, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { BottomTabBar, EmptyState, PrimaryButton, ScreenHeader } from '@/components/ui';
import ConnectionScreen from '@/features/connection/ConnectionScreen';
import HistoryScreen from '@/features/history/HistoryScreen';
import HomeScreen from '@/features/home/HomeScreen';
import MediaPickerScreen from '@/features/media/MediaPickerScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';
import TransferProgressScreen from '@/features/transfer/TransferProgressScreen';
import { TransferHistoryItem } from '@/api/types';
import { MediaAsset } from '@/services/MediaScanner';
import { DiscoveredServer } from '@/services/NativeCapabilities';
import { PairingPayload } from '@/security/ConnectionSecurity';
import { ConnectionHealthStatus, ConnectionSecurityState, MainTab, SavedConnection, ScreenState } from './types';
import { PreparationMode } from '@/services/upload/types';
import { useReduceMotionEnabled } from '@/theme';

export type NavigationProps = {
  appState: ScreenState;
  selectedAssets: MediaAsset[];
  scanRequestId: number;
  onOpenPicker: () => void;
  onTransfer: (assets: MediaAsset[]) => void;
  onCancelPicker: () => void;
  onCancelTransfer: () => void;
  onCompleteTransfer: () => void;
  onSelectTab: (tab: MainTab) => void;
};

export type ConnectionProps = {
  isServerConnected: boolean;
  isConnecting: boolean;
  pairingDesktopName: string | null;
  connectionSecurity: ConnectionSecurityState;
  connectionHealthStatus: ConnectionHealthStatus;
  savedReceiver: SavedConnection | null;
  onConnect: (ipOrUrl: string, token?: string, pairing?: PairingPayload, silent?: boolean) => Promise<boolean>;
  onConnectDiscovered: (server: DiscoveredServer) => Promise<void>;
  onConnectTrusted: () => Promise<void>;
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

export type HistoryProps = {
  items: TransferHistoryItem[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onClear: () => void;
};

export type AppNavigatorProps = {
  navigation: NavigationProps;
  connection: ConnectionProps;
  preferences: PreferenceProps;
  discovery: DiscoveryProps;
  history: HistoryProps;
};

export function pageTransitionMotion(reduceMotionEnabled: boolean) {
  return {
    duration: reduceMotionEnabled ? 120 : 180,
    translateY: reduceMotionEnabled ? 0 : 5,
  };
}

function IdleTransfers({ isConnected, onChooseMedia, onConnect }: { isConnected: boolean; onChooseMedia: () => void; onConnect: () => void }) {
  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <SafeAreaView edges={['top']} className="flex-1">
        <ScreenHeader title="Transfers" subtitle="Prepare, send, and review the active session" />
        <View className="px-5 pt-3">
          <EmptyState
            icon="swap-vertical-outline"
            title="No active transfer"
            message={isConnected ? 'Choose photos and videos when you are ready to send.' : 'Connect to a receiver before starting a transfer.'}
            action={<PrimaryButton title={isConnected ? 'Choose Media' : 'Open Connect'} icon={isConnected ? 'images-outline' : 'desktop-outline'} onPress={isConnected ? onChooseMedia : onConnect} />}
          />
          <View className="rounded-[18px] bg-surface dark:bg-surface-dark border border-border dark:border-border-dark p-4 mt-5">
            <Text className="text-[16px] font-bold text-on-surface dark:text-on-surface-dark">How transfers appear</Text>
            <Text className="text-[13px] leading-5 text-on-surface-variant dark:text-on-surface-variant-dark mt-1">Preparation and transfer progress stay separate, while duplicate skips and file results remain visible.</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

export default function AppNavigator({ navigation, connection, preferences, discovery, history }: AppNavigatorProps) {
  const transition = useAnimatedValue(1);
  const reduceMotionEnabled = useReduceMotionEnabled();
  const transitionMotion = pageTransitionMotion(reduceMotionEnabled);
  const previousState = React.useRef(navigation.appState);
  const [finishedTransferAssets, setFinishedTransferAssets] = React.useState<MediaAsset[] | null>(null);
  const transferFinished = navigation.appState === 'transfer' && finishedTransferAssets === navigation.selectedAssets;
  const handleTerminalStateChange = React.useCallback((finished: boolean) => {
    setFinishedTransferAssets(finished ? navigation.selectedAssets : null);
  }, [navigation.selectedAssets]);

  React.useLayoutEffect(() => {
    if (previousState.current === navigation.appState) return;
    previousState.current = navigation.appState;
    transition.stopAnimation();
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: transitionMotion.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [navigation.appState, transition, transitionMotion.duration]);

  const transitionStyle = React.useMemo(() => ({
    flex: 1,
    opacity: transition,
    transform: [{ translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [transitionMotion.translateY, 0] }) }],
  }), [transition, transitionMotion.translateY]);

  const activeTab: MainTab = navigation.appState === 'transfer' ? 'transfers' : navigation.appState as MainTab;
  const selectTab = React.useCallback((tab: MainTab) => {
    if (navigation.appState === 'transfer' && transferFinished) {
      navigation.onCompleteTransfer();
      if (tab !== 'home') navigation.onSelectTab(tab);
      return;
    }
    navigation.onSelectTab(tab);
  }, [navigation, transferFinished]);

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <StatusBar style="auto" />
        {navigation.appState === 'picker' ? (
          <MediaPickerScreen onTransfer={navigation.onTransfer} onDisconnect={navigation.onCancelPicker} />
        ) : (
          <View className="flex-1 bg-background dark:bg-background-dark">
            <Animated.View style={transitionStyle}>
              {navigation.appState === 'home' && (
                <HomeScreen
                  isConnected={connection.isServerConnected}
                  connectionSecurity={connection.connectionSecurity}
                  connectionHealthStatus={connection.connectionHealthStatus}
                  history={history.items}
                  historyLoading={history.loading}
                  onOpenPicker={navigation.onOpenPicker}
                  onOpenConnect={() => navigation.onSelectTab('connect')}
                  onOpenHistory={() => navigation.onSelectTab('history')}
                  onRetryConnection={connection.onRetryConnection}
                />
              )}
              {navigation.appState === 'transfers' && <IdleTransfers isConnected={connection.isServerConnected} onChooseMedia={navigation.onOpenPicker} onConnect={() => navigation.onSelectTab('connect')} />}
              {navigation.appState === 'connect' && (
                <ConnectionScreen
                  onConnect={connection.onConnect}
                  onConnectDiscovered={connection.onConnectDiscovered}
                  discoveredServers={discovery.discoveredServers}
                  isDiscovering={discovery.isDiscovering}
                  discoveryFailed={discovery.discoveryFailed}
                  isConnecting={connection.isConnecting}
                  nearbyDiscoveryEnabled={preferences.nearbyDiscoveryEnabled}
                  allowInsecureHttp={preferences.allowInsecureHttp}
                  nativeHttpsAvailable={preferences.nativeHttpsAvailable}
                  onAllowInsecureHttpChange={preferences.onAllowInsecureHttpChange}
                  onExplainUnencryptedHttp={preferences.onExplainUnencryptedHttp}
                  onExplainNearbyDiscovery={preferences.onExplainNearbyDiscovery}
                  onEnableNearbyDiscovery={discovery.onEnableNearbyDiscovery}
                  onRefreshDiscovery={discovery.onRefreshDiscovery}
                  scanRequestId={navigation.scanRequestId}
                  pairingDesktopName={connection.pairingDesktopName}
                  isConnected={connection.isServerConnected}
                  savedReceiver={connection.savedReceiver}
                  onConnectTrusted={connection.onConnectTrusted}
                  onDisconnect={connection.onDisconnect}
                />
              )}
              {navigation.appState === 'history' && (
                <HistoryScreen isConnected={connection.isServerConnected} items={history.items} loading={history.loading} error={history.error} onRefresh={() => void history.onRefresh()} onClear={history.onClear} onConnect={() => navigation.onSelectTab('connect')} />
              )}
              {navigation.appState === 'settings' && (
                <SettingsScreen
                  isConnected={connection.isServerConnected}
                  connectionSecurity={connection.connectionSecurity}
                  nativeHttpsAvailable={preferences.nativeHttpsAvailable}
                  nearbyDiscoveryEnabled={preferences.nearbyDiscoveryEnabled}
                  allowInsecureHttp={preferences.allowInsecureHttp}
                  preparationMode={preferences.preparationMode}
                  skipExactDuplicates={preferences.skipExactDuplicates}
                  includeAdditionalMediaComponents={preferences.includeAdditionalMediaComponents}
                  onNearbyDiscoveryChange={preferences.onNearbyDiscoveryChange}
                  onAllowInsecureHttpChange={enabled => void preferences.onAllowInsecureHttpChange(enabled)}
                  onExplainUnencryptedHttp={preferences.onExplainUnencryptedHttp}
                  onPreparationModeChange={preferences.onPreparationModeChange}
                  onSkipExactDuplicatesChange={preferences.onSkipExactDuplicatesChange}
                  onIncludeAdditionalMediaComponentsChange={preferences.onIncludeAdditionalMediaComponentsChange}
                />
              )}
              {navigation.appState === 'transfer' && (
                <TransferProgressScreen assets={navigation.selectedAssets} preparationMode={preferences.preparationMode} skipExactDuplicates={preferences.skipExactDuplicates} includeAdditionalMediaComponents={preferences.includeAdditionalMediaComponents} onCancel={navigation.onCancelTransfer} onComplete={navigation.onCompleteTransfer} onTerminalStateChange={handleTerminalStateChange} />
              )}
            </Animated.View>
            <BottomTabBar activeTab={activeTab} onSelect={selectTab} locked={navigation.appState === 'transfer' && !transferFinished} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
