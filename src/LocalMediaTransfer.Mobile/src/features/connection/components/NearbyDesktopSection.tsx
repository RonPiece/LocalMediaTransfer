import React from 'react';
import { Alert, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { connectionText } from '../content/connectionText';
import { DiscoveredServer } from '@/services/NativeCapabilities';
import { useThemePalette } from '@/theme';
import { Card, ControlGroup, GroupAction, HelpButton, SecondaryButton, SectionLabel } from '@/components/ui';
import { ActiveConnection, discoveredReceiverAddress } from '../connectionPresentation';
import { ReceiverRow } from './ReceiverRow';

export function nearbyHeaderUsesIconOnlyActions(width: number, fontScale: number): boolean {
  return width < 370 || fontScale > 1.2;
}

export function NearbyDesktopSection({
  discoveredServers,
  isDiscovering,
  discoveryFailed,
  isConnecting,
  nearbyDiscoveryEnabled,
  nativeHttpsAvailable,
  onConnectDiscovered,
  onEnableNearbyDiscovery,
  onExplainNearbyDiscovery,
  onRefreshDiscovery,
  isConnected,
  onDisconnect,
  activeConnection,
  onOpenDetails,
}: {
  discoveredServers: DiscoveredServer[];
  isDiscovering: boolean;
  discoveryFailed: boolean;
  isConnecting: boolean;
  nearbyDiscoveryEnabled: boolean;
  nativeHttpsAvailable: boolean;
  onConnectDiscovered: (server: DiscoveredServer) => Promise<void> | void;
  onEnableNearbyDiscovery: () => void;
  onExplainNearbyDiscovery: () => void;
  onRefreshDiscovery: () => void;
  isConnected: boolean;
  onDisconnect: () => Promise<void> | void;
  activeConnection: ActiveConnection | null;
  onOpenDetails: () => void;
}) {
  const palette = useThemePalette();
  const { width, fontScale } = useWindowDimensions();
  const iconOnlyActions = nearbyHeaderUsesIconOnlyActions(width, fontScale);
  return (
    <View className="w-full mb-6">
      <View
        testID="nearby-receivers-header"
        className="flex-row items-center mb-2 px-1"
        style={{ gap: 8 }}
      >
        <SectionLabel className="flex-1 min-w-0 mb-0 px-0">{connectionText.nearbyTitle}</SectionLabel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <HelpButton className="ml-0" label={connectionText.explainNearbyDiscovery} onPress={onExplainNearbyDiscovery} />
          <ControlGroup>
            {nearbyDiscoveryEnabled && <GroupAction accessibilityLabel="Refresh nearby receivers" label={isDiscovering ? connectionText.searching : connectionText.refresh}
              icon="refresh" compact={iconOnlyActions} disabled={isDiscovering || isConnected || isConnecting} busy={isDiscovering}
              onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); onRefreshDiscovery(); }} />}
            <GroupAction label="Disconnect" icon="power-outline" destructive compact={iconOnlyActions}
              disabled={!isConnected || isConnecting}
              onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); void onDisconnect(); }} />
          </ControlGroup>
        </View>
      </View>

      <Card className="dark:bg-surface-dark border border-border dark:border-border-dark">
        {!nearbyDiscoveryEnabled ? (
          <View className="p-4">
            <View className="flex-row items-center mb-3">
              <Ionicons name="wifi-outline" size={22} color={palette.onSurfaceVariant} />
              <Text className="text-on-surface-variant dark:text-on-surface-variant-dark ml-2.5 flex-1 text-[15px] leading-5">
                {nativeHttpsAvailable ? connectionText.nearbyDisabledNative : connectionText.nearbyDisabledExpo}
              </Text>
            </View>
            <SecondaryButton
              title={nativeHttpsAvailable ? connectionText.enableNearby : connectionText.installedAppRequired}
              disabled={!nativeHttpsAvailable}
              onPress={onEnableNearbyDiscovery}
            />
          </View>
        ) : discoveryFailed ? (
          <View className="p-4">
            <View className="flex-row items-center mb-3">
              <Ionicons name="warning-outline" size={22} color={palette.error} />
              <Text accessibilityRole="alert" className="text-on-surface-variant dark:text-on-surface-variant-dark ml-2.5 flex-1 text-[15px] leading-5">
                {connectionText.discoveryFailed}
              </Text>
            </View>
            <SecondaryButton
              title={connectionText.refresh}
              disabled={isDiscovering || isConnected || isConnecting}
              onPress={onRefreshDiscovery}
            />
          </View>
        ) : discoveredServers.length === 0 ? (
          <View className="p-4 flex-row items-center">
            <Ionicons name="wifi-outline" size={22} color={palette.onSurfaceVariant} />
            <Text className="text-on-surface-variant dark:text-on-surface-variant-dark ml-2.5 flex-1 text-[15px] leading-5">
              {isDiscovering
                ? connectionText.looking
                : nativeHttpsAvailable
                  ? connectionText.noDesktopFound
                  : connectionText.discoveryRequiresInstalledApp}
            </Text>
          </View>
        ) : (
          discoveredServers.map((server, index) => (
            <React.Fragment key={server.serverId}>
              {index > 0 && <View className="h-[0.5px] bg-separator dark:bg-separator-dark ml-14" />}
              <ReceiverRow name={server.name} address={discoveredReceiverAddress(server)}
                activeConnection={activeConnection} isConnected={isConnected} isConnecting={isConnecting}
                onOpenDetails={onOpenDetails} onConnect={() => {
                  void (async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                    try { await onConnectDiscovered(server); }
                    catch { Alert.alert(connectionText.connectionFailedTitle, connectionText.connectionFailedMessage); }
                  })();
                }} />
            </React.Fragment>
          ))
        )}
      </Card>
    </View>
  );
}
