import React from 'react';
import { FlatList, Modal, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import type { TransferHistoryFile } from '@/api/types';
import { useReduceMotionEnabled } from '@/theme';

type Props = {
  files: TransferHistoryFile[] | null;
  totalProblems: number;
  sessionId?: string;
  onClose: () => void;
};

/** Android history has receiver results but no PhotoKit original lookup. */
export function HistoryProblemDetailsModal({ files, totalProblems, onClose }: Props) {
  const reduceMotion = useReduceMotionEnabled();
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
              <View className="mx-5 py-3 border-b border-border dark:border-border-dark">
                <Text className="text-on-surface dark:text-on-surface-dark">{item.name}</Text>
                <Text className="text-on-surface-variant dark:text-on-surface-variant-dark">
                  {item.outcome === 'skipped' ? 'Exact duplicate skipped' : item.error || 'Transfer failed'}
                </Text>
              </View>
            )}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
