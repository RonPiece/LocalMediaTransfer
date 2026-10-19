import React from 'react';
import { FlatList, Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { transferText } from '../content/transferText';
import { FileState, TransferFailureGroup, groupFailureResults } from '../transferPresentation';
import { TransferFileItem } from './TransferFileItem';
import { outlinedActionAppearance, useReduceMotionEnabled, useThemePalette } from '@/theme';
import AppHeader from '@/components/AppHeader';

const emptyResults: FileState[] = [];
const resultsListContentStyle = { paddingHorizontal: 20, paddingBottom: 24 };
const renderTransferFile = ({ item }: { item: FileState }) => <TransferFileItem item={item} />;

const renderFailureGroup = ({ item }: { item: TransferFailureGroup }) => (
  <View className="p-4 mt-3 rounded-2xl bg-surface dark:bg-surface-dark border border-border dark:border-border-dark">
    <View className="flex-row items-start">
      <View className="px-2.5 py-1 rounded-full bg-error-soft dark:bg-error-soft-dark">
        <Text className="text-error dark:text-error-dark text-[12px] font-bold">{item.count.toLocaleString()}</Text>
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-on-surface dark:text-on-surface-dark text-[14px] font-semibold">
          {item.count === 1 ? 'File affected' : 'Files affected'}
        </Text>
        <Text className="text-on-surface dark:text-on-surface-dark text-[14px] leading-5 mt-2">{item.message}</Text>
        <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[11px] mt-2">
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
  const reduceMotion = useReduceMotionEnabled();
  const palette = useThemePalette();
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
  const errorListHeader = showOnlyErrors && (!byteTotalComplete || hasTemporaryStorageFailures || (!showingIndividualErrors && errorResults.length > 0)) ? (
    <View className="mt-4 p-4 rounded-[14px] bg-surface dark:bg-surface-dark border border-border dark:border-border-dark">
      {!byteTotalComplete && (
        <Text className="text-on-surface dark:text-on-surface-dark text-[13px] leading-5">
          File-size totals include only media that could be prepared. The affected files below are excluded.
        </Text>
      )}
      {hasTemporaryStorageFailures && (
        <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[12px] leading-5 mt-2">
          To retry a smaller selection with less temporary storage: tap Done, open Settings, and turn on Transfer while preparing. Selections above 250 items now use that storage-saving mode automatically.
        </Text>
      )}
      {!showingIndividualErrors && errorResults.length > 0 && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setShowIndividualErrors(true)}
          style={{ ...outlinedActionAppearance(palette).container, backgroundColor: palette.surface, borderWidth: 1 }}
          className="min-h-[48px] p-3 rounded-xl items-center justify-center"
        >
          <Text className="text-primary dark:text-primary-dark text-[13px] font-semibold">
            View all {errorResults.length.toLocaleString()} affected filenames
          </Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-background dark:bg-background-dark" accessibilityViewIsModal>
        <AppHeader
          title={showingIndividualErrors ? 'Affected files' : showOnlyErrors ? transferText.transferErrors : transferText.allTransferResults}
          subtitle={showingIndividualErrors ? `${errorResults.length.toLocaleString()} filenames`
            : showOnlyErrors ? `${count.toLocaleString()} files \u00b7 ${failureGroups.length.toLocaleString()} ${failureGroups.length === 1 ? 'reason group' : 'reason groups'}`
              : transferText.virtualizedListLabel(count.toLocaleString())}
          onClose={showingIndividualErrors ? () => setShowIndividualErrors(false) : undefined}
          closeStyle="back" backLabel="Back to grouped error reasons"
          onDone={onClose} doneText="Close" />
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
