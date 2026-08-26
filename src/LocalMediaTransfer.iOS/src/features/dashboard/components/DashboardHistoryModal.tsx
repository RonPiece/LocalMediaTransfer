import React from 'react';
import { FlatList, Modal, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import { theme } from '@/theme';
import { formatHistoryDate, historyItemKey, historyStatus } from '../hooks/useDashboardHistory';
import { HistoryItem } from '../types';
import { HistoryProblemDetailsModal } from './HistoryProblemDetailsModal';

function formatBytes(value = 0): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

export function DashboardHistoryModal({
  visible,
  historyData,
  onClose,
  onClear,
}: {
  visible: boolean;
  historyData: HistoryItem[];
  onClose: () => void;
  onClear: () => void;
}) {
  const [details, setDetails] = React.useState<{ files: NonNullable<HistoryItem['files']>; total: number } | null>(null);
  React.useEffect(() => {
    if (!visible) setDetails(null);
  }, [visible]);
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View className="flex-1 bg-background">
          <SafeAreaView edges={['top']} className="bg-surface">
            <AppHeader
              title="Transfer History"
              onClose={onClose}
              closeStyle="back"
              onDone={historyData.length > 0 ? onClear : undefined}
              doneText="Clear"
              doneColor={theme.colors.error}
            />
          </SafeAreaView>
          {historyData.length === 0 ? (
            <View className="p-5">
              <View className="bg-surface rounded-xl p-10 items-center">
                <Ionicons name="time-outline" size={32} color={theme.colors.onSurfaceVariant} />
                <Text className="text-[17px] font-semibold text-on-surface mt-3">No Transfer History</Text>
                <Text className="text-[15px] text-on-surface-variant text-center mt-1">Completed transfers will appear here.</Text>
              </View>
            </View>
          ) : (
            <FlatList
              data={historyData}
              keyExtractor={historyItemKey}
              contentContainerStyle={{ padding: 20 }}
              renderItem={({ item }) => {
              const status = historyStatus(item);
              const isError = status.includes('error') || status === 'Failed';
              const problemFiles = item.files?.filter(file => file.outcome !== 'uploaded') ?? [];
              const totalProblems = (item.skippedFiles ?? 0) + (item.failedFiles ?? 0);
              const selectedMediaBytes = (item.selectedMediaBytes ?? 0) > 0 || (item.selectedBytes ?? 0) === 0
                ? (item.selectedMediaBytes ?? 0)
                : (item.selectedBytes ?? 0);
              const hasAdditionalComponents =
                (item.additionalComponentsBytes ?? 0) > 0 ||
                (item.additionalComponentsFiles ?? 0) > 0;
              return (
                <View className="bg-surface rounded-xl p-4 mb-2.5">
                  <Text className="text-[16px] font-semibold text-on-surface">{formatHistoryDate(item.completedAt)}</Text>
                  <Text className="text-[14px] text-on-surface-variant mt-1">
                    Status:{' '}
                    <Text className={`font-semibold ${isError ? 'text-error' : 'text-success'}`}>{status}</Text>
                  </Text>
                  <Text className="text-[13px] text-on-surface-variant mt-1">
                    {item.uploadedFiles ?? 0} uploaded · {item.skippedFiles ?? 0} skipped · {item.failedFiles ?? 0} failed
                  </Text>
                  {(item.selectedAssets !== undefined || item.expandedFiles !== undefined) && (
                    <Text className="text-[13px] text-on-surface-variant mt-1">
                      {item.selectedAssets ?? 0} selected assets · {item.expandedFiles ?? 0} files
                    </Text>
                  )}
                  {item.selectedBytes !== undefined && (
                    <Text className="text-[13px] text-on-surface-variant mt-1">
                      {formatBytes(selectedMediaBytes)} selected media
                      {hasAdditionalComponents
                        ? ` · +${formatBytes(item.additionalComponentsBytes)} in ${(item.additionalComponentsFiles ?? 0).toLocaleString()} additional components · ${formatBytes(item.selectedBytes)} total content`
                        : ''}
                    </Text>
                  )}
                  {(item.uploadedBytes !== undefined || item.avoidedBytes !== undefined) && (
                    <Text className="text-[13px] text-on-surface-variant mt-1">
                      {formatBytes(item.uploadedBytes)} stored · {formatBytes(item.avoidedBytes)} avoided before upload
                    </Text>
                  )}
                  {(item.finalizationDuplicateBytes ?? 0) > 0 && (
                    <Text className="text-[13px] text-on-surface-variant mt-1">
                      {formatBytes(item.finalizationDuplicateBytes)} uploaded, then verified as duplicate
                    </Text>
                  )}
                  {problemFiles.length > 0 && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`View ${problemFiles.length} problem file details`}
                      onPress={() => setDetails({ files: problemFiles, total: totalProblems })}
                      className="mt-3 rounded-lg border border-border bg-background px-3 py-2 flex-row items-center justify-between"
                    >
                      <Text className="text-[13px] font-semibold text-primary">
                        View {problemFiles.length < totalProblems
                          ? `${problemFiles.length.toLocaleString()} of ${totalProblems.toLocaleString()}`
                          : problemFiles.length.toLocaleString()} problem files
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
                    </TouchableOpacity>
                  )}
                  {totalProblems > 0 && problemFiles.length === 0 && (
                    <Text className="text-[12px] text-on-surface-variant mt-2">
                      Per-file details are unavailable for this saved record.
                    </Text>
                  )}
                </View>
              );
            }}
            />
          )}
          <HistoryProblemDetailsModal
            files={details?.files ?? null}
            totalProblems={details?.total ?? 0}
            onClose={() => setDetails(null)}
          />
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
