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
        <Text className="text-on-surface-variant text-[11px] mt-2">
          Affected files include: {item.sampleFilenames.join(', ')}
        </Text>
      </View>
    </View>
  </View>
);

type TransferResultsModalProps = {
  visible: boolean;
  showOnlyErrors: boolean;
  errorCount: number;
  byteTotalComplete: boolean;
  results: FileState[];
  onClose: () => void;
};

export const TransferResultsModal = React.memo(function TransferResultsModal({
  visible,
  showOnlyErrors,
  errorCount,
  byteTotalComplete,
  results,
  onClose,
}: TransferResultsModalProps) {
  const [showIndividualErrors, setShowIndividualErrors] = React.useState(false);
  React.useEffect(() => {
    if (!visible || !showOnlyErrors) setShowIndividualErrors(false);
  }, [showOnlyErrors, visible]);
  const visibleResults = React.useMemo(
    () => visible ? results : emptyResults,
    [results, visible],
  );
  const failureGroups = React.useMemo(
    () => visible && showOnlyErrors ? groupFailureResults(results) : [],
    [results, showOnlyErrors, visible],
  );
  const errorResults = React.useMemo(
    () => visible && showOnlyErrors ? results.filter(item => item.status === 'error') : emptyResults,
    [results, showOnlyErrors, visible],
  );
  const hasTemporaryStorageFailures = React.useMemo(
    () => errorResults.some(item => item.errorCode === 'temporary-storage-limit'),
    [errorResults],
  );
  const renderFullError = React.useCallback(
    ({ item }: { item: FileState }) => <TransferFileItem item={item} showFullFilename />,
    [],
  );
  const count = showOnlyErrors ? errorCount : results.length;
  const showingIndividualErrors = showOnlyErrors && showIndividualErrors;
  const errorListHeader = showOnlyErrors ? (
    <View className="mt-4 p-4 rounded-[14px] bg-surface border border-border">
      {!byteTotalComplete && (
        <Text className="text-on-surface text-[13px] leading-5">
          File-size totals include only media that could be prepared. The affected files below are excluded.
        </Text>
      )}
      {hasTemporaryStorageFailures && (
        <Text className="text-on-surface-variant text-[12px] leading-5 mt-2">
          To retry a smaller selection with less temporary storage: tap Done, open Settings, and turn on Transfer while preparing. Selections above 250 items now use that storage-saving mode automatically.
        </Text>
      )}
      {!showingIndividualErrors && errorResults.length > 0 && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setShowIndividualErrors(true)}
          className="h-11 mt-3 rounded-xl bg-primary/10 items-center justify-center"
        >
          <Text className="text-primary text-[13px] font-semibold">
            View all {errorResults.length.toLocaleString()} affected filenames
          </Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-background" accessibilityViewIsModal>
        <View className="h-16 px-5 flex-row items-center justify-between border-b border-border bg-surface">
          <View className="flex-1 flex-row items-center">
            {showingIndividualErrors && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Back to grouped error reasons"
                onPress={() => setShowIndividualErrors(false)}
                className="h-10 pr-3 items-center justify-center"
              >
                <Text className="text-primary font-semibold">Back</Text>
              </TouchableOpacity>
            )}
            <View className="flex-1">
              <Text className="text-on-surface text-lg font-bold">
                {showingIndividualErrors
                  ? 'Affected files'
                  : showOnlyErrors
                    ? transferText.transferErrors
                    : transferText.allTransferResults}
              </Text>
              <Text className="text-on-surface-variant text-xs">
                {showingIndividualErrors
                  ? `${errorResults.length.toLocaleString()} filenames`
                  : showOnlyErrors
                    ? `${count.toLocaleString()} files · ${failureGroups.length.toLocaleString()} ${failureGroups.length === 1 ? 'reason group' : 'reason groups'}`
                    : transferText.virtualizedListLabel(count.toLocaleString())}
              </Text>
            </View>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close transfer results" onPress={onClose} className="h-10 px-4 rounded-full bg-background items-center justify-center">
            <Text className="text-primary font-semibold">{transferText.close}</Text>
          </TouchableOpacity>
        </View>
        {showingIndividualErrors ? (
          <FlatList
            data={errorResults}
            keyExtractor={item => item.id}
            renderItem={renderFullError}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={7}
            ListHeaderComponent={errorListHeader}
            contentContainerStyle={resultsListContentStyle}
          />
        ) : showOnlyErrors ? (
          <FlatList
            data={failureGroups}
            keyExtractor={item => item.id}
            renderItem={renderFailureGroup}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            ListHeaderComponent={errorListHeader}
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
