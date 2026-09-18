import React from 'react';
import { ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';

import AppHeader from '@/components/AppHeader';
import { MediaAsset } from '@/services/MediaScanner';
import { useThemePalette } from '@/theme';
import { RecentActivityPanel } from './components/RecentActivityPanel';
import { ConcurrentTransferProgress } from './components/ConcurrentTransferProgress';
import { TransferProgressRing } from './components/TransferProgressRing';
import { TransferResultsModal } from './components/TransferResultsModal';
import { TransferStatsBar } from './components/TransferStatsBar';
import { TransferSummaryCard } from './components/TransferSummaryCard';
import { transferText } from './content/transferText';
import { useTransferController } from './useTransferController';
import { PreparationMode } from '@/services/upload/types';
import { formatDuration } from './transferPresentation';

export function transferProgressLayout(width: number, height: number) {
  return {
    compactHeight: height < 700,
    ringSize: Math.min(height < 700 ? 190 : 240, Math.max(176, width * 0.56)),
  };
}

interface TransferProgressScreenProps {
  assets: MediaAsset[];
  onCancel: () => void;
  onComplete: () => void;
  preparationMode?: PreparationMode;
  skipExactDuplicates?: boolean;
  includeAdditionalMediaComponents?: boolean;
  onTerminalStateChange?: (finished: boolean) => void;
}

const ActiveTransferKeepAwake = React.memo(function ActiveTransferKeepAwake() {
  useKeepAwake();
  return null;
});

export default function TransferProgressScreen({
  assets,
  onCancel,
  onComplete,
  preparationMode = 'prepare-first',
  skipExactDuplicates = true,
  includeAdditionalMediaComponents = false,
  onTerminalStateChange,
}: TransferProgressScreenProps) {
  const palette = useThemePalette();
  const {
    currentProgress,
    currentMediaMBps,
    averageMediaMBps,
    peakMediaMBps,
    etaText,
    completionSummary,
    isFinished,
    phase,
    hasUploadStarted,
    preparedFiles,
    preparationComplete,
    activePreparationMode,
    totalTransferFiles,
    duplicateCheck,
    summary,
    recentFiles,
    showAllResults,
    setShowAllResults,
    showOnlyErrors,
    setShowOnlyErrors,
    elapsedSeconds,
    resultList,
    cancelTransfer,
  } = useTransferController({
    assets,
    onCancel,
    preparationMode,
    skipExactDuplicates,
    includeAdditionalMediaComponents,
  });
  const { width, height } = useWindowDimensions();
  const { compactHeight, ringSize } = transferProgressLayout(width, height);

  const errorCount = summary.failed;
  const skipCount = summary.skipped;
  const successCount = summary.success;
  const processedCount = successCount + skipCount + errorCount;
  const displayedTotalFiles = Math.max(
    completionSummary?.expandedFiles ?? totalTransferFiles,
    processedCount,
  );
  const transferPhaseActive = preparationComplete || isFinished;
  const ringCompleted = transferPhaseActive ? processedCount : preparedFiles;
  const ringTotal = transferPhaseActive ? displayedTotalFiles : assets.length;
  const itemsRemaining = preparationComplete
    ? Math.max(0, displayedTotalFiles - processedCount)
    : Math.max(0, assets.length - preparedFiles);
  const progressBytes = currentProgress?.acknowledgedMediaBytes || 0;
  const streamingOverlapActive = !isFinished
    && !preparationComplete
    && activePreparationMode === 'streaming'
    && hasUploadStarted;
  const selectedBytes = completionSummary?.selectedBytes ?? currentProgress?.totalBytes ?? 0;
  const transferredBytes = completionSummary?.uploadedBytes ?? progressBytes;
  const showRemainingTime = preparationComplete && hasUploadStarted;
  const timeLabel = showRemainingTime ? 'Time remaining' : 'Elapsed';
  const timeText = showRemainingTime ? etaText : formatDuration(elapsedSeconds);
  const timeHint = !preparationComplete
    ? 'Final transfer size is still being determined.'
    : undefined;
  const finalColor = errorCount === 0
    ? palette.success
    : (successCount + skipCount > 0 ? palette.warning : palette.error);

  const showAllResultsModal = React.useCallback(() => {
    setShowOnlyErrors(false);
    setShowAllResults(true);
  }, [setShowAllResults, setShowOnlyErrors]);
  const showErrorResultsModal = React.useCallback(() => {
    setShowOnlyErrors(true);
    setShowAllResults(true);
  }, [setShowAllResults, setShowOnlyErrors]);
  const closeResultsModal = React.useCallback(() => setShowAllResults(false), [setShowAllResults]);

  React.useEffect(() => {
    onTerminalStateChange?.(isFinished);
  }, [isFinished, onTerminalStateChange]);

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      {!isFinished && <ActiveTransferKeepAwake />}
      <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
        <AppHeader title={transferText.title} />
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: isFinished ? 96 : 8, paddingTop: compactHeight ? 12 : 24 }}
      >
        {!isFinished && (
          <ConcurrentTransferProgress
            preparedAssets={preparedFiles}
            totalAssets={assets.length}
            processedFiles={processedCount}
            totalFiles={displayedTotalFiles}
            preparationComplete={preparationComplete}
            hasUploadStarted={hasUploadStarted}
            phase={phase}
            duplicateStage={duplicateCheck.stage}
            includeAdditionalMediaComponents={includeAdditionalMediaComponents}
            compact={compactHeight}
          />
        )}

        {!isFinished && !streamingOverlapActive && (
          <TransferProgressRing
            size={ringSize}
            compactHeight={compactHeight}
            isFinished={isFinished}
            finalColor={finalColor}
            completedItems={ringCompleted}
            totalItems={ringTotal}
            unit={transferPhaseActive ? 'files' : 'assets'}
            phaseLabel={isFinished
              ? 'Transfer complete'
              : preparationComplete
                ? 'Files processed'
                : 'Analyzing media'}
          />
        )}

        {skipCount > 0 && !isFinished && (
          <View className="rounded-[16px] bg-warning/10 border border-warning/25 px-4 py-3 mb-4 flex-row items-center">
            <Ionicons name="play-skip-forward-outline" size={20} color={palette.warning} />
            <Text className="text-warning dark:text-warning-dark text-[13px] font-semibold ml-2 flex-1">
              {skipCount.toLocaleString()} {skipCount === 1 ? 'duplicate' : 'duplicates'} skipped · SHA-256 verified
            </Text>
          </View>
        )}

        {!isFinished && (
          <TransferStatsBar
            itemsRemaining={itemsRemaining}
            remainingLabel={preparationComplete ? transferText.filesLeft : 'Media left to analyze'}
            transferredBytes={streamingOverlapActive ? progressBytes : undefined}
            currentMediaMBps={currentMediaMBps}
            timeLabel={timeLabel}
            timeText={timeText}
            timeHint={timeHint}
          />
        )}

        {isFinished && (
          <TransferSummaryCard
            successCount={successCount}
            skipCount={skipCount}
            errorCount={errorCount}
            processedCount={processedCount}
            selectedBytes={selectedBytes}
            selectedMediaBytes={completionSummary?.selectedMediaBytes ?? selectedBytes}
            additionalComponentsBytes={completionSummary?.additionalComponentsBytes ?? 0}
            additionalComponentsFiles={completionSummary?.additionalComponentsFiles ?? 0}
            byteTotalComplete={completionSummary?.byteTotalComplete !== false}
            transferredBytes={transferredBytes}
            avoidedBytes={completionSummary?.avoidedBytes ?? 0}
            finalizationDuplicateBytes={completionSummary?.finalizationDuplicateBytes ?? 0}
            elapsedSeconds={elapsedSeconds}
            preparationSeconds={completionSummary?.preparationDurationMs === undefined
              ? undefined
              : Math.round(completionSummary.preparationDurationMs / 1000)}
            averageMediaMBps={averageMediaMBps}
            peakMediaMBps={peakMediaMBps}
            resultCount={resultList.length}
            onShowAll={showAllResultsModal}
            onShowErrors={showErrorResultsModal}
          />
        )}

        {!isFinished && (
          <RecentActivityPanel items={recentFiles} compact={compactHeight} />
        )}

        {!isFinished && (
          <View className={compactHeight ? 'mt-2' : 'mt-4'}>
          <TouchableOpacity
            onPress={cancelTransfer}
            className="w-full h-14 rounded-xl items-center justify-center flex-row bg-error/10 border border-error/20"
          >
            <Ionicons name="close-circle-outline" size={20} color={palette.error} />
            <Text className="text-error text-lg font-semibold ml-2">{transferText.cancelTransfer}</Text>
          </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {isFinished && (
        <View className="absolute left-0 right-0 bottom-0 px-6 pt-3 pb-3 bg-surface/95 dark:bg-surface-dark/95 border-t border-border dark:border-border-dark">
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={transferText.done}
            onPress={onComplete}
            className="w-full h-14 rounded-xl items-center justify-center flex-row bg-primary border border-primary/20"
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={palette.white} />
            <Text className="text-on-primary text-lg font-semibold ml-2">{transferText.done}</Text>
          </TouchableOpacity>
        </View>
      )}

      <TransferResultsModal
        visible={showAllResults}
        showOnlyErrors={showOnlyErrors}
        errorCount={errorCount}
        byteTotalComplete={completionSummary?.byteTotalComplete !== false}
        results={resultList}
        onClose={closeResultsModal}
      />
    </View>
  );
}
