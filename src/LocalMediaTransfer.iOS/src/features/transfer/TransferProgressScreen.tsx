import React from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';

import AppHeader from '@/components/AppHeader';
import { MediaAsset } from '@/services/MediaScanner';
import { theme } from '@/theme';
import { RecentActivityPanel } from './components/RecentActivityPanel';
import { TransferPhaseBanner } from './components/TransferPhaseBanner';
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
}: TransferProgressScreenProps) {
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
    queueCatchUpVisible,
    preparedFiles,
    readyFiles,
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
  const displayedTotalFiles = completionSummary?.expandedFiles ?? totalTransferFiles;
  const ringCompleted = isFinished ? processedCount : preparedFiles;
  const ringTotal = isFinished ? displayedTotalFiles : assets.length;
  const itemsRemaining = preparationComplete
    ? Math.max(0, displayedTotalFiles - processedCount)
    : Math.max(0, assets.length - preparedFiles);
  const progressBytes = currentProgress?.acknowledgedMediaBytes || 0;
  const selectedBytes = completionSummary?.selectedBytes ?? currentProgress?.totalBytes ?? 0;
  const transferredBytes = completionSummary?.uploadedBytes ?? progressBytes;
  const showRemainingTime = preparationComplete && hasUploadStarted;
  const timeLabel = showRemainingTime ? 'Time remaining' : 'Elapsed';
  const timeText = showRemainingTime ? etaText : formatDuration(elapsedSeconds);
  const timeHint = !preparationComplete
    ? 'Final transfer size is still being determined.'
    : undefined;
  const finalColor = errorCount === 0
    ? theme.colors.success
    : (successCount + skipCount > 0 ? theme.colors.warning : theme.colors.error);

  const showAllResultsModal = React.useCallback(() => {
    setShowOnlyErrors(false);
    setShowAllResults(true);
  }, [setShowAllResults, setShowOnlyErrors]);
  const showErrorResultsModal = React.useCallback(() => {
    setShowOnlyErrors(true);
    setShowAllResults(true);
  }, [setShowAllResults, setShowOnlyErrors]);
  const closeResultsModal = React.useCallback(() => setShowAllResults(false), [setShowAllResults]);

  return (
    <View className="flex-1 bg-background">
      {!isFinished && <ActiveTransferKeepAwake />}
      <SafeAreaView edges={['top']} className="bg-surface">
        <AppHeader title={transferText.title} />
      </SafeAreaView>

      <View className="flex-1 px-6 pb-2" style={{ paddingTop: compactHeight ? 12 : 24 }}>
        <TransferPhaseBanner
          isFinished={isFinished}
          preparedFiles={preparedFiles}
          readyFiles={readyFiles}
          totalAssets={assets.length}
          expandedFiles={displayedTotalFiles}
          preparationComplete={preparationComplete}
          preparationMode={activePreparationMode}
          phase={phase}
          hasUploadStarted={hasUploadStarted}
          queueCatchUpVisible={queueCatchUpVisible}
          acknowledgedMediaBytes={progressBytes}
          currentMediaMBps={currentMediaMBps}
          duplicateCheck={duplicateCheck}
        />

        <TransferProgressRing
          size={ringSize}
          compactHeight={compactHeight}
          isFinished={isFinished}
          finalColor={finalColor}
          completedItems={ringCompleted}
          totalItems={ringTotal}
          unit={isFinished ? 'files' : 'assets'}
          phaseLabel={isFinished
            ? 'Transfer complete'
            : preparationComplete
              ? 'Media analyzed'
              : 'Analyzing media'}
        />

        {!isFinished && (
          <TransferStatsBar
            itemsRemaining={itemsRemaining}
            remainingLabel={preparationComplete ? transferText.filesLeft : 'Media left to analyze'}
            currentMediaMBps={currentMediaMBps}
            timeLabel={timeLabel}
            timeText={timeText}
            timeHint={timeHint}
            processedFiles={preparationComplete ? processedCount : undefined}
            totalFiles={preparationComplete ? displayedTotalFiles : undefined}
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

        {isFinished ? (
          <TouchableOpacity
            onPress={onComplete}
            className={`${compactHeight ? 'mt-2' : 'mt-4'} w-full h-14 rounded-xl items-center justify-center flex-row bg-primary border border-primary/20`}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.white} />
            <Text className="text-on-primary text-lg font-semibold ml-2">{transferText.done}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={cancelTransfer}
            className={`${compactHeight ? 'mt-2' : 'mt-4'} w-full h-14 rounded-xl items-center justify-center flex-row bg-error/10 border border-error/20`}
          >
            <Ionicons name="close-circle-outline" size={20} color={theme.colors.error} />
            <Text className="text-error text-lg font-semibold ml-2">{transferText.cancelTransfer}</Text>
          </TouchableOpacity>
        )}
      </View>

      <TransferResultsModal
        visible={showAllResults}
        showOnlyErrors={showOnlyErrors}
        errorCount={errorCount}
        results={resultList}
        onClose={closeResultsModal}
      />
    </View>
  );
}
