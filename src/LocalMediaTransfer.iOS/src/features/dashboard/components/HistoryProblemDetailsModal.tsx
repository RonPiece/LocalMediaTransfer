import React from 'react';
import { FlatList, Modal, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import { TransferHistoryFile } from '@/api/types';
import { theme } from '@/theme';

function formatBytes(value = 0): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

function HistoryProblemFile({ file }: { file: TransferHistoryFile }) {
  const skipped = file.outcome === 'skipped';
  return (
    <View className="flex-row py-3 border-b border-border">
      <Ionicons
        name={skipped ? 'play-skip-forward-outline' : 'alert-circle-outline'}
        size={20}
        color={skipped ? theme.colors.warning : theme.colors.error}
      />
      <View className="ml-3 flex-1">
        <Text className="text-[14px] text-on-surface" numberOfLines={2}>
          {skipped
            ? `${file.name} matched ${file.matchedName || file.savedName || 'an existing file'}`
            : file.name}
        </Text>
        <Text className="text-[12px] text-on-surface-variant mt-1">
          {skipped
            ? `${formatBytes(file.avoidedBytes)} avoided · ${file.duplicateStage === 'finalization' ? 'verified after upload' : 'found before upload'}`
            : `Failed${file.error ? ` · ${file.error}` : ''}`}
        </Text>
      </View>
    </View>
  );
}

export function HistoryProblemDetailsModal({
  files,
  totalProblems,
  onClose,
}: {
  files: TransferHistoryFile[] | null;
  totalProblems: number;
  onClose: () => void;
}) {
  if (!files) return null;
  const omitted = Math.max(0, totalProblems - files.length);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View className="flex-1 bg-background">
          <SafeAreaView edges={['top']} className="bg-surface">
            <AppHeader title="Problem Files" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <FlatList
            data={files}
            keyExtractor={(file, index) => `${file.id}:${index}`}
            renderItem={({ item }) => <HistoryProblemFile file={item} />}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={7}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}
            ListHeaderComponent={omitted > 0 ? (
              <View className="my-3 rounded-xl border border-border bg-surface p-3">
                <Text className="text-[13px] text-on-surface-variant">
                  Showing {files.length.toLocaleString()} of {totalProblems.toLocaleString()} problem files. The transfer totals above remain complete.
                </Text>
              </View>
            ) : null}
          />
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
