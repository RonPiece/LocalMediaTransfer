import React from 'react';
import { FlatList, Modal, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import type { TransferHistoryFile } from '@/api/types';
import { useReduceMotionEnabled } from '@/theme';
import { ProblemFileThumbnail, ProblemThumbnails } from '@/features/history/components/ProblemFileThumbnail';
import { useUiPreview } from '@lmt/ui-preview';

type Props = {
  files: TransferHistoryFile[] | null;
  totalProblems: number;
  sessionId?: string;
  onClose: () => void;
  thumbnails?: ProblemThumbnails;
};

/** Android history has receiver results but no PhotoKit original lookup. */
export function HistoryProblemDetailsModal({ files, totalProblems, thumbnails, onClose }: Props) {
  const reduceMotion = useReduceMotionEnabled();
  const previewIntegration = useUiPreview();
  if (!files) return null;
  return (
    <Modal visible animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
          <AppHeader title="Problem Files" onClose={onClose} closeStyle="back" />
          <Text className="px-5 py-3 text-on-surface-variant dark:text-on-surface-variant-dark">
            Showing {files.length.toLocaleString()} of {totalProblems.toLocaleString()} skipped or failed files.
          </Text>
          <FlatList
            data={files}
            keyExtractor={(file, index) => `${file.id}:${index}`}
            renderItem={({ item }) => (
              <View className="mx-5 py-3 flex-row border-b border-border dark:border-border-dark">
                <ProblemFileThumbnail id={item.id} name={item.name} skipped={item.outcome === 'skipped'} thumbnail={(thumbnails ?? previewIntegration.problemThumbnails)?.get(item.id)} />
                <View className="flex-1 ml-3">
                <Text className="text-on-surface dark:text-on-surface-dark">{item.name}</Text>
                <Text className="text-on-surface-variant dark:text-on-surface-variant-dark">
                  {item.outcome === 'skipped' ? 'Exact duplicate skipped' : item.error || 'Transfer failed'}
                </Text>
                </View>
              </View>
            )}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
