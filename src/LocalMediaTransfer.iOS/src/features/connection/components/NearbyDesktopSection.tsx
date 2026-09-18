import React from 'react';
import { Alert, Pressable, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { connectionText } from '../content/connectionText';
import { DiscoveredServer } from '@/services/NativeCapabilities';
import { useReduceMotionEnabled, useThemePalette } from '@/theme';
import { Card, HelpButton, IconTile, SecondaryButton, SectionLabel } from '@/components/ui';

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
}) {
  const palette = useThemePalette();
  const reduceMotionEnabled = useReduceMotionEnabled();
  const { width, fontScale } = useWindowDimensions();
  const iconOnlyActions = nearbyHeaderUsesIconOnlyActions(width, fontScale);
  return (
    <View className="w-full mb-6">
      <View
        testID="nearby-receivers-header"
        className="flex-row items-center mb-2 px-1"
      >
        <View className="flex-1 min-w-0 flex-row items-center">
          <SectionLabel className="flex-shrink mb-0 px-0">{connectionText.nearbyTitle}</SectionLabel>
          <HelpButton label={connectionText.explainNearbyDiscovery} onPress={onExplainNearbyDiscovery} />
        </View>
        <View className="flex-row items-center ml-1">
          {nearbyDiscoveryEnabled && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh nearby receivers"
              accessibilityState={{ disabled: isDiscovering || isConnected }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                onRefreshDiscovery();
              }}
              disabled={isDiscovering || isConnected}
              className={`${iconOnlyActions ? 'w-8' : 'px-2'} h-8 rounded-full flex-row items-center justify-center bg-primary/10 dark:bg-primary-dark/20 border border-primary/15 dark:border-primary-dark/25`}
              style={({ pressed }) => ({
                borderRadius: 999,
                opacity: isDiscovering || isConnected ? 0.35 : pressed ? 0.55 : 1,
                transform: [{ scale: pressed && !isDiscovering && !isConnected && !reduceMotionEnabled ? 0.97 : 1 }],
              })}
            >
              <Ionicons name="refresh" size={14} color={palette.primary} />
              {!iconOnlyActions && (
                <Text className="text-[11px] text-primary dark:text-primary-dark font-semibold ml-1">{isDiscovering ? connectionText.searching : connectionText.refresh}</Text>
              )}
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Disconnect"
            accessibilityState={{ disabled: !isConnected }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              void onDisconnect();
            }}
            disabled={!isConnected}
            className={`${iconOnlyActions ? 'w-8' : 'px-2'} h-8 rounded-full flex-row items-center justify-center bg-error/10 dark:bg-error-dark/15 border border-error/15 dark:border-error-dark/25 ml-1.5`}
            style={({ pressed }) => ({
              borderRadius: 999,
              opacity: !isConnected ? 0.35 : pressed ? 0.55 : 1,
              transform: [{ scale: pressed && isConnected && !reduceMotionEnabled ? 0.97 : 1 }],
            })}
          >
            <Ionicons name="power-outline" size={14} color={isConnected ? palette.error : palette.onSurfaceVariant} />
            {!iconOnlyActions && (
              <Text className={`text-[11px] font-semibold ml-1 ${isConnected ? 'text-error dark:text-error-dark' : 'text-on-surface-variant dark:text-on-surface-variant-dark'}`}>Disconnect</Text>
            )}
          </Pressable>
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
              <Text className="text-on-surface-variant dark:text-on-surface-variant-dark ml-2.5 flex-1 text-[15px] leading-5">
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
              {index > 0 && <View className="h-[0.5px] bg-border dark:bg-border-dark ml-14" />}
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
                disabled={isConnecting || isConnected}
                className={`flex-row items-center p-3 ${isConnected ? 'opacity-40' : ''}`}
                activeOpacity={0.7}
              >
                <IconTile icon="desktop-outline" />
                <View className="flex-1">
                  <Text className="text-[17px] font-normal text-on-surface dark:text-on-surface-dark">{server.name}</Text>
                  <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark mt-[2px]">
                    {server.address}:{server.httpsPort} · {connectionText.tapToConnect}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.onSurfaceVariant} />
              </TouchableOpacity>
            </React.Fragment>
          ))
        )}
      </Card>
    </View>
  );
}
