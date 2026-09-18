import React from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ConnectionHealthStatus, ConnectionSecurityState } from '@/app/types';
import { TransferHistoryItem } from '@/api/types';
import { PrimaryButton, StatusBadge } from '@/components/ui';
import { ConnectionDetailsModal } from '@/features/dashboard/components/ConnectionDetailsModal';
import { ConnectionStatusCard } from '@/features/dashboard/components/ConnectionStatusCard';
import { formatHistoryDate, historyStatus } from '@/features/dashboard/hooks/useDashboardHistory';
import { SessionDetails } from '@/features/history/HistoryScreen';
import { expectedServerEnvironment } from '@/services/NativeCapabilities';
import { useThemePalette } from '@/theme';

function RecentSessionRow({ item, onPress }: { item: TransferHistoryItem; onPress: () => void }) {
  const palette = useThemePalette();
  const status = historyStatus(item);
  const tone = status === 'Skipped duplicates' || status === 'Canceled' ? 'warning' : status === 'Completed' ? 'success' : 'error';
  const count = item.expandedFiles ?? ((item.uploadedFiles ?? 0) + (item.skippedFiles ?? 0) + (item.failedFiles ?? 0));
  const compactStatus = status === 'Skipped duplicates'
    ? 'Skipped'
    : status === 'Completed with errors'
      ? 'Issues'
      : status;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${status}. Open transfer details from ${formatHistoryDate(item.completedAt)}`}
      onPress={onPress}
      activeOpacity={0.7}
      className="flex-row items-center px-3.5 py-2.5 border-b border-border dark:border-border-dark"
    >
      <View className="w-10 h-10 rounded-[11px] bg-primary/10 dark:bg-primary-dark/20 items-center justify-center">
        <Ionicons name="phone-portrait-outline" size={21} color={palette.primary} />
      </View>
      <View className="flex-1 ml-2.5 min-w-0">
        <Text className="text-[14px] font-semibold text-on-surface dark:text-on-surface-dark" numberOfLines={1}>iPhone upload</Text>
        <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-0.5" numberOfLines={1}>
          {count.toLocaleString()} {count === 1 ? 'file' : 'files'} · {formatHistoryDate(item.completedAt)}
        </Text>
      </View>
      <StatusBadge
        label={compactStatus}
        tone={tone}
        icon={tone === 'success' ? 'checkmark-circle' : tone === 'warning' ? 'play-skip-forward' : 'alert-circle'}
      />
      <Ionicons name="chevron-forward" size={17} color={palette.onSurfaceVariant} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );
}

export default function HomeScreen({
  isConnected,
  connectionSecurity,
  connectionHealthStatus,
  history,
  historyLoading,
  onOpenPicker,
  onOpenConnect,
  onOpenHistory,
  onRetryConnection,
}: {
  isConnected: boolean;
  connectionSecurity: ConnectionSecurityState;
  connectionHealthStatus: ConnectionHealthStatus;
  history: TransferHistoryItem[];
  historyLoading: boolean;
  onOpenPicker: () => void;
  onOpenConnect: () => void;
  onOpenHistory: () => void;
  onRetryConnection: () => void;
}) {
  const palette = useThemePalette();
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [selectedHistory, setSelectedHistory] = React.useState<TransferHistoryItem | null>(null);
  const chooseMedia = React.useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onOpenPicker();
  }, [onOpenPicker]);

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <SafeAreaView edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
          <View className="flex-row items-center pt-4 pb-3">
            <Image source={require('../../../assets/app-icon.png')} className="w-14 h-14 rounded-2xl" />
            <View className="flex-1 ml-3">
              <Text accessibilityRole="header" className="text-[22px] font-bold text-on-surface dark:text-on-surface-dark">Local Media Transfer</Text>
              <Text className="text-[15px] text-on-surface-variant dark:text-on-surface-variant-dark mt-0.5">Local-first file transfer</Text>
            </View>
          </View>

          {expectedServerEnvironment() === 'test' && (
            <View className="items-center mb-4">
              <StatusBadge label="TEST ENVIRONMENT" tone="warning" icon="flask-outline" />
            </View>
          )}

          <ConnectionStatusCard
            isConnected={isConnected}
            connectionSecurity={connectionSecurity}
            connectionHealthStatus={connectionHealthStatus}
            onOpenDetails={() => setDetailsOpen(true)}
            onRetryConnection={onRetryConnection}
          />

          <View className="mt-2">
            <PrimaryButton
              title="Choose Media"
              icon="images-outline"
              onPress={chooseMedia}
              disabled={!isConnected}
              className="h-16 rounded-2xl mb-2"
            />
          </View>
          <Text className="text-center text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark mb-8">
            {isConnected ? 'Select photos and videos to transfer securely.' : 'Connect to a receiver before choosing media.'}
          </Text>

          {!isConnected && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onOpenConnect}
              className="h-12 rounded-xl bg-primary/10 dark:bg-primary-dark/20 items-center justify-center flex-row mb-5"
            >
              <Ionicons name="desktop-outline" size={20} color={palette.primary} />
              <Text className="text-primary dark:text-primary-dark font-semibold ml-2">Open Connect</Text>
            </TouchableOpacity>
          )}

          <View className="flex-row items-center justify-between mb-2 px-1">
            <Text className="text-[20px] font-bold text-on-surface dark:text-on-surface-dark">Recent Receiver Activity</Text>
            <TouchableOpacity accessibilityRole="button" onPress={onOpenHistory} disabled={!isConnected} className={!isConnected ? 'opacity-35' : ''}>
              <Text className="text-primary dark:text-primary-dark text-[15px]">View All</Text>
            </TouchableOpacity>
          </View>
          <View className="rounded-[20px] bg-surface dark:bg-surface-dark border border-border dark:border-border-dark overflow-hidden">
            {!isConnected ? (
              <Text className="px-4 py-5 text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark text-center">Connect to view receiver history.</Text>
            ) : historyLoading && history.length === 0 ? (
              <Text className="px-4 py-5 text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark text-center">Loading recent activity…</Text>
            ) : history.length === 0 ? (
              <Text className="px-4 py-5 text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark text-center">Completed transfers will appear here.</Text>
            ) : history.slice(0, 2).map(item => (
              <RecentSessionRow
                key={item.sessionId || String(item.completedAt)}
                item={item}
                onPress={() => setSelectedHistory(item)}
              />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
      <ConnectionDetailsModal visible={detailsOpen} onClose={() => setDetailsOpen(false)} />
      <SessionDetails item={selectedHistory} onClose={() => setSelectedHistory(null)} />
    </View>
  );
}
