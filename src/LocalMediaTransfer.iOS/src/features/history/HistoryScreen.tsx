import React from 'react';
import { Modal, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { TransferHistoryItem } from '@/api/types';
import { EmptyState, PrimaryButton, ScreenHeader, StatusBadge } from '@/components/ui';
import AppHeader from '@/components/AppHeader';
import { HistoryProblemDetailsModal } from '@/features/dashboard/components/HistoryProblemDetailsModal';
import { formatHistoryDate, historyItemKey, historyStatus } from '@/features/dashboard/hooks/useDashboardHistory';
import { useThemePalette } from '@/theme';
import { formatDuration } from '@/features/transfer/transferPresentation';

type HistoryFilter = 'all' | 'completed' | 'skipped' | 'attention';

export function formatHistoryBytes(value = 0): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

export function formatHistoryDuration(value?: number): string {
  return value === undefined ? 'Unavailable' : formatDuration(Math.max(0, Math.round(value / 1000)));
}

function matchesFilter(item: TransferHistoryItem, filter: HistoryFilter): boolean {
  const status = historyStatus(item);
  if (filter === 'completed') return status === 'Completed';
  if (filter === 'skipped') return status === 'Skipped duplicates';
  if (filter === 'attention') return status === 'Failed' || status === 'Completed with errors' || status === 'Canceled';
  return true;
}

function HistoryStat({ icon, label, value, tone = 'info' }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; tone?: 'info' | 'success' | 'warning' | 'error' }) {
  const palette = useThemePalette();
  const color = tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : tone === 'error' ? palette.error : palette.primary;
  return (
    <View className="w-1/2 p-3">
      <View className="rounded-2xl bg-surface dark:bg-surface-dark border border-border dark:border-border-dark p-3 min-h-[105px]">
        <Ionicons name={icon} size={23} color={color} />
        <Text className="text-[20px] font-bold text-on-surface dark:text-on-surface-dark mt-2">{value}</Text>
        <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-0.5">{label}</Text>
      </View>
    </View>
  );
}

export function SessionDetails({ item, onClose }: { item: TransferHistoryItem | null; onClose: () => void }) {
  const [problemFilesOpen, setProblemFilesOpen] = React.useState(false);
  if (!item) return null;
  const problemFiles = item.files?.filter(file => file.outcome !== 'uploaded') ?? [];
  const totalProblems = (item.skippedFiles ?? 0) + (item.failedFiles ?? 0);
  const details: [string, string][] = [
    ['Status', historyStatus(item)],
    ['Selected media', item.selectedAssets === undefined ? 'Unavailable' : `${item.selectedAssets.toLocaleString()} assets`],
    ['Transfer files', `${(item.expandedFiles ?? item.selectedFiles ?? 0).toLocaleString()}`],
    ['Uploaded', `${(item.uploadedFiles ?? 0).toLocaleString()} · ${formatHistoryBytes(item.uploadedBytes)}`],
    ['Duplicates skipped', `${(item.skippedFiles ?? 0).toLocaleString()} · ${formatHistoryBytes(item.avoidedBytes)} avoided`],
    ['Failed', (item.failedFiles ?? 0).toLocaleString()],
    ['Prepared size', item.selectedBytes === undefined ? 'Unavailable' : formatHistoryBytes(item.selectedBytes)],
    ['Primary media', item.selectedMediaFiles === undefined
      ? 'Unavailable'
      : `${item.selectedMediaFiles.toLocaleString()} · ${formatHistoryBytes(item.selectedMediaBytes)}`],
  ];
  if ((item.additionalComponentsFiles ?? 0) > 0 || (item.additionalComponentsBytes ?? 0) > 0) {
    details.push([
      'Additional components',
      `${(item.additionalComponentsFiles ?? 0).toLocaleString()} · ${formatHistoryBytes(item.additionalComponentsBytes)}`,
    ]);
  }
  details.push(
    ['Total duration', formatHistoryDuration(item.totalDurationMs)],
    ['Preparation & checks', formatHistoryDuration(item.checkDurationMs)],
    ['Transfer time', formatHistoryDuration(item.uploadDurationMs)],
    ['Average speed', item.averageSpeedMBps === undefined ? 'Unavailable' : `${item.averageSpeedMBps.toFixed(1)} MB/s`],
    ['Peak speed', item.peakSpeedMBps === undefined ? 'Unavailable' : `${item.peakSpeedMBps.toFixed(1)} MB/s`],
  );
  if ((item.retries ?? 0) > 0) details.push(['Retries', (item.retries ?? 0).toLocaleString()]);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View className="flex-1 bg-background dark:bg-background-dark">
          <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
            <AppHeader title="Transfer Details" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
            <View className="rounded-[20px] bg-surface dark:bg-surface-dark border border-border dark:border-border-dark p-5">
              <Text className="text-[19px] font-bold text-on-surface dark:text-on-surface-dark">iPhone upload</Text>
              <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1">{formatHistoryDate(item.completedAt)}</Text>
              {details.map(([label, value]) => (
                <View key={label} className="flex-row justify-between py-3 border-b border-border dark:border-border-dark">
                  <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark">{label}</Text>
                  <Text className="text-[13px] font-semibold text-on-surface dark:text-on-surface-dark ml-4 text-right">{value}</Text>
                </View>
              ))}
              {problemFiles.length > 0 && (
                <TouchableOpacity onPress={() => setProblemFilesOpen(true)} className="h-12 rounded-xl bg-warning/10 items-center justify-center mt-4">
                  <Text className="text-warning dark:text-warning-dark font-semibold">View problem files</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
          <HistoryProblemDetailsModal files={problemFilesOpen ? problemFiles : null} totalProblems={totalProblems} onClose={() => setProblemFilesOpen(false)} />
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

export default function HistoryScreen({
  isConnected,
  items,
  loading,
  error,
  onRefresh,
  onClear,
  onConnect,
}: {
  isConnected: boolean;
  items: TransferHistoryItem[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onClear: () => void;
  onConnect: () => void;
}) {
  const palette = useThemePalette();
  const [filter, setFilter] = React.useState<HistoryFilter>('all');
  const [selected, setSelected] = React.useState<TransferHistoryItem | null>(null);
  const filtered = items.filter(item => matchesFilter(item, filter));
  const uploadedFiles = items.reduce((sum, item) => sum + (item.uploadedFiles ?? 0), 0);
  const skippedFiles = items.reduce((sum, item) => sum + (item.skippedFiles ?? 0), 0);
  const uploadedBytes = items.reduce((sum, item) => sum + (item.uploadedBytes ?? 0), 0);

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <SafeAreaView edges={['top']} className="flex-1">
        <ScreenHeader title="History" subtitle="Recent history on this receiver" />
        <ScrollView
          refreshControl={isConnected ? <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={palette.primary} /> : undefined}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
        >
          {!isConnected ? (
            <EmptyState
              icon="desktop-outline"
              title="Connect to view history"
              message="Transfer history is stored by the receiver and is available after a secure connection."
              action={<PrimaryButton title="Open Connect" icon="link-outline" onPress={onConnect} />}
            />
          ) : (
            <>
              <View className="flex-row flex-wrap -m-3 mb-3">
                <HistoryStat icon="document-text-outline" label="Recent sessions" value={items.length.toLocaleString()} />
                <HistoryStat icon="checkmark-circle-outline" label="Uploaded files" value={uploadedFiles.toLocaleString()} tone="success" />
                <HistoryStat icon="play-skip-forward-outline" label="Duplicates skipped" value={skippedFiles.toLocaleString()} tone="warning" />
                <HistoryStat icon="server-outline" label="Uploaded data" value={formatHistoryBytes(uploadedBytes)} />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                {([
                  ['all', 'All'],
                  ['completed', 'Completed'],
                  ['skipped', 'Skipped'],
                  ['attention', 'Needs Attention'],
                ] as [HistoryFilter, string][]).map(([id, label]) => (
                  <TouchableOpacity
                    key={id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === id }}
                    onPress={() => setFilter(id)}
                    className={`h-10 px-4 mr-2 rounded-full items-center justify-center ${filter === id ? 'bg-primary dark:bg-primary-dark' : 'bg-surface dark:bg-surface-dark border border-border dark:border-border-dark'}`}
                  >
                    <Text className={`text-[13px] font-semibold ${filter === id ? 'text-white' : 'text-on-surface-variant dark:text-on-surface-variant-dark'}`}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View className="flex-row items-center justify-between mb-2 px-1">
                <Text className="text-[20px] font-bold text-on-surface dark:text-on-surface-dark">Recent Transfers</Text>
                <TouchableOpacity accessibilityRole="button" onPress={onClear} disabled={items.length === 0} className={items.length === 0 ? 'opacity-35' : ''}>
                  <Text className="text-error dark:text-error-dark text-[15px]">Clear All</Text>
                </TouchableOpacity>
              </View>

              {error && (
                <TouchableOpacity onPress={onRefresh} className="rounded-xl bg-error/10 px-4 py-3 mb-3">
                  <Text className="text-error dark:text-error-dark text-[13px]">{error} Tap to try again.</Text>
                </TouchableOpacity>
              )}
              {!loading && items.length === 0 ? (
                <EmptyState icon="time-outline" title="No receiver history" message="Completed transfers will appear here." />
              ) : filtered.length === 0 ? (
                <EmptyState icon="filter-outline" title="No matching transfers" message="Try another history filter." />
              ) : filtered.map(item => {
                const status = historyStatus(item);
                const tone = status === 'Completed' ? 'success' : status === 'Skipped duplicates' || status === 'Canceled' ? 'warning' : 'error';
                const fileCount = item.expandedFiles ?? item.selectedFiles ?? ((item.uploadedFiles ?? 0) + (item.skippedFiles ?? 0) + (item.failedFiles ?? 0));
                return (
                  <TouchableOpacity
                    key={historyItemKey(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${status.toLowerCase()} transfer from ${formatHistoryDate(item.completedAt)}`}
                    onPress={() => setSelected(item)}
                    className="rounded-[20px] bg-surface dark:bg-surface-dark border border-border dark:border-border-dark p-4 mb-3 flex-row items-center"
                  >
                    <View className="w-12 h-12 rounded-2xl bg-primary/10 dark:bg-primary-dark/20 items-center justify-center">
                      <Ionicons name="phone-portrait-outline" size={25} color={palette.primary} />
                    </View>
                    <View className="flex-1 ml-3 min-w-0">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-[16px] font-bold text-on-surface dark:text-on-surface-dark">iPhone upload</Text>
                        <StatusBadge label={status === 'Completed with errors' ? 'Mixed' : status} tone={tone} />
                      </View>
                      <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1">{formatHistoryDate(item.completedAt)}</Text>
                      <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1">{fileCount.toLocaleString()} files · {formatHistoryBytes(item.uploadedBytes)} uploaded</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={palette.onSurfaceVariant} />
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <SessionDetails item={selected} onClose={() => setSelected(null)} />
    </View>
  );
}
