import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { connectionText } from '../content/connectionText';
import { DiscoveredServer } from '@/services/NativeCapabilities';
import { theme } from '@/theme';
import { Card, HelpButton, IconTile, SecondaryButton, SectionLabel } from '@/components/ui';

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
}) {
  return (
    <View className="w-full mb-6">
      <View className="flex-row justify-between items-center mb-2 px-1">
        <View className="flex-row items-center">
          <SectionLabel className="">{connectionText.nearbyTitle}</SectionLabel>
          <HelpButton label={connectionText.explainNearbyDiscovery} onPress={onExplainNearbyDiscovery} />
        </View>
        {nearbyDiscoveryEnabled && (
          <TouchableOpacity onPress={onRefreshDiscovery} disabled={isDiscovering}>
            <Text className="text-[15px] text-primary font-normal">
              {isDiscovering ? connectionText.searching : connectionText.refresh}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Card>
        {!nearbyDiscoveryEnabled ? (
          <View className="p-4">
            <View className="flex-row items-center mb-3">
              <Ionicons name="wifi-outline" size={22} color={theme.colors.onSurfaceVariant} />
              <Text className="text-on-surface-variant ml-2.5 flex-1 text-[15px] leading-5">
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
              <Ionicons name="warning-outline" size={22} color={theme.colors.error} />
              <Text className="text-on-surface-variant ml-2.5 flex-1 text-[15px] leading-5">
                {connectionText.discoveryFailed}
              </Text>
            </View>
            <SecondaryButton
              title={connectionText.refresh}
              disabled={isDiscovering}
              onPress={onRefreshDiscovery}
            />
          </View>
        ) : discoveredServers.length === 0 ? (
          <View className="p-4 flex-row items-center">
            <Ionicons name="wifi-outline" size={22} color={theme.colors.onSurfaceVariant} />
            <Text className="text-on-surface-variant ml-2.5 flex-1 text-[15px] leading-5">
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
              {index > 0 && <View className="h-[0.5px] bg-border ml-14" />}
              <TouchableOpacity
                onPress={async () => {
                  if (isConnecting) return;
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                  try {
                    await onConnectDiscovered(server);
                  } catch {
                    Alert.alert(
                      connectionText.connectionFailedTitle,
                      connectionText.connectionFailedMessage,
                    );
                  }
                }}
                disabled={isConnecting}
                className="flex-row items-center p-3"
                activeOpacity={0.7}
              >
                <IconTile icon="desktop-outline" />
                <View className="flex-1">
                  <Text className="text-[17px] font-normal text-on-surface">{server.name}</Text>
                  <Text className="text-[13px] text-on-surface-variant mt-[2px]">
                    {server.address}:{server.httpsPort} · {connectionText.tapToConnect}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceVariant} />
              </TouchableOpacity>
            </React.Fragment>
          ))
        )}
      </Card>
    </View>
  );
}
