import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { ConnectionHealthStatus, ConnectionSecurityState } from '@/app/types';
import { api } from '@/api/ApiClient';
import { useThemePalette } from '@/theme';
import { dashboardText } from '../content/dashboardText';

export function ConnectionStatusCard({
  isConnected,
  connectionSecurity,
  connectionHealthStatus,
  onOpenDetails,
  onRetryConnection,
}: {
  isConnected: boolean;
  connectionSecurity: ConnectionSecurityState;
  connectionHealthStatus: ConnectionHealthStatus;
  onOpenDetails: () => void;
  onRetryConnection: () => void;
}) {
  const palette = useThemePalette();
  const copyAddress = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      await Clipboard.setStringAsync(api.url);
      Alert.alert(dashboardText.copiedTitle, dashboardText.copiedAddressMessage);
    } catch {
      console.error('Failed to copy dashboard server address.');
      Alert.alert(dashboardText.copyFailedTitle, dashboardText.copyFailedMessage);
    }
  };

  const statusText = connectionHealthStatus === 'checking' || connectionHealthStatus === 'retrying'
    ? dashboardText.reconnectingStatus
    : isConnected && connectionSecurity.mode === 'https' && connectionSecurity.certificateVerified
      ? dashboardText.encryptedStatus(connectionSecurity.tlsVersion || 'TLS')
      : isConnected && connectionSecurity.mode === 'http'
        ? dashboardText.httpStatus
        : dashboardText.disconnectedStatus;

  const statusColor = !isConnected
    ? palette.warning
    : connectionSecurity.mode === 'http'
      ? palette.error
      : palette.connected;

  const dotClass = !isConnected ? 'bg-warning' : connectionSecurity.mode === 'http' ? 'bg-error' : 'bg-success';
  return (
    <View className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-2xl p-4 mb-5">
      <View className="mb-3">
        <View className="flex-row items-center">
          <View className={`w-2 h-2 rounded-full mr-2 ${dotClass}`} />
          <Text className="text-[12px] font-bold uppercase tracking-[0.6px]" style={{ color: statusColor }}>
            {statusText}
          </Text>
        </View>
        {isConnected && connectionSecurity.mode === 'http' && (
          <Text className="text-error text-[12px] mt-1.5 ml-4 leading-4 pr-2">
            {dashboardText.httpWarning}
          </Text>
        )}
      </View>

      {connectionHealthStatus === 'disconnected' && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={dashboardText.retryConnection}
          onPress={onRetryConnection}
          className="self-start mb-3 px-3 py-2 rounded-lg bg-primary/15 flex-row items-center"
        >
          <Ionicons name="refresh-outline" size={15} color={palette.primary} />
          <Text className="text-primary text-[13px] font-semibold ml-1.5">{dashboardText.retryConnection}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onOpenDetails}
        disabled={!isConnected}
        className={`bg-background dark:bg-background-dark rounded-xl px-[14px] py-3 flex-row items-center justify-between mb-3 ${!isConnected ? 'opacity-55' : ''}`}
      >
        <View className="flex-1 mr-3">
          <Text className="text-on-surface dark:text-on-surface-dark text-[15px] font-semibold" numberOfLines={1}>{api.url || 'No receiver connected'}</Text>
          <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[13px] mt-[3px]">{dashboardText.tapSecurityDetails}</Text>
        </View>
        <View className="bg-surface w-7 h-7 rounded-full items-center justify-center shadow-sm shadow-black/5 elevation-1">
          <Ionicons name="chevron-forward" size={16} color={palette.onSurfaceVariant} />
        </View>
      </TouchableOpacity>

      <View className="flex-row items-center justify-between">
        <View className="bg-background dark:bg-background-dark rounded-lg px-2.5 py-1.5 flex-row items-center">
          <Ionicons name="wifi" size={12} color={isConnected ? palette.connected : palette.warning} style={{ marginRight: 6 }} />
          <Text className="text-[12px] font-medium" style={{ color: isConnected ? palette.connected : palette.warning }}>
            {dashboardText.localNetwork}
          </Text>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Copy server address"
          onPress={copyAddress}
          disabled={!isConnected}
          className={`px-3 py-1.5 rounded-lg bg-primary/15 flex-row items-center ${!isConnected ? 'opacity-35' : ''}`}
        >
          <Ionicons name="copy-outline" size={14} color={palette.primary} />
          <Text className="text-primary text-[13px] font-semibold ml-1.5">{dashboardText.copyLink}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
