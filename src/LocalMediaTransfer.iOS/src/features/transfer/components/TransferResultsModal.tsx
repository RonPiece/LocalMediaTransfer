import React from 'react';
import { FlatList, Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { transferText } from '../content/transferText';
import { FileState, TransferFailureGroup, groupFailureResults } from '../transferPresentation';
import { TransferFileItem } from './TransferFileItem';

const emptyResults: FileState[] = [];
const resultsListContentStyle = { paddingHorizontal: 20, paddingBottom: 24 };
const renderTransferFile = ({ item }: { item: FileState }) => <TransferFileItem item={item} />;

const renderFailureGroup = ({ item }: { item: TransferFailureGroup }) => (
  <View className="py-4 border-b border-border">
    <View className="flex-row items-start">
      <View className="px-2.5 py-1 rounded-full bg-error/10">
        <Text className="text-error text-[12px] font-bold">{item.count.toLocaleString()}</Text>
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-on-surface text-[14px] font-semibold">
          {item.count === 1 ? 'File affected' : 'Files affected'}
        </Text>
        <Text className="text-on-surface-variant text-[13px] leading-5 mt-1">{item.message}</Text>
        <Text className="text-on-surface-variant text-[11px] mt-2" numberOfLines={2}>
          Examples: {item.sampleFilenames.join(', ')}
        </Text>
      </View>
    </View>
  </View>
);

type TransferResultsModalProps = {
  visible: boolean;
  showOnlyErrors: boolean;
  errorCount: number;
  results: FileState[];
  onClose: () => void;
};

export const TransferResultsModal = React.memo(function TransferResultsModal({
  visible,
  showOnlyErrors,
  errorCount,
  results,
  onClose,
}: TransferResultsModalProps) {
  const visibleResults = React.useMemo(
    () => visible ? results : emptyResults,
    [results, visible],
  );
  const failureGroups = React.useMemo(
    () => visible && showOnlyErrors ? groupFailureResults(results) : [],
    [results, showOnlyErrors, visible],
  );
  const count = showOnlyErrors ? errorCount : results.length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-background" accessibilityViewIsModal>
        <View className="h-16 px-5 flex-row items-center justify-between border-b border-border bg-surface">
          <View>
            <Text className="text-on-surface text-lg font-bold">{showOnlyErrors ? transferText.transferErrors : transferText.allTransferResults}</Text>
            <Text className="text-on-surface-variant text-xs">
              {showOnlyErrors
                ? `${count.toLocaleString()} files · ${failureGroups.length.toLocaleString()} reason groups`
                : transferText.virtualizedListLabel(count.toLocaleString())}
            </Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close transfer results" onPress={onClose} className="h-10 px-4 rounded-full bg-background items-center justify-center">
            <Text className="text-primary font-semibold">{transferText.close}</Text>
          </TouchableOpacity>
        </View>
        {showOnlyErrors ? (
          <FlatList
            data={failureGroups}
            keyExtractor={item => item.id}
            renderItem={renderFailureGroup}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            contentContainerStyle={resultsListContentStyle}
          />
        ) : (
          <FlatList
            data={visibleResults}
            keyExtractor={item => item.id}
            renderItem={renderTransferFile}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={7}
            contentContainerStyle={resultsListContentStyle}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
});
