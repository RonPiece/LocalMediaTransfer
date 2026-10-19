import React from 'react';
import { AccessibilityInfo, Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, useAnimatedValue, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';

import AppHeader from '@/components/AppHeader';
import { SelectedMedia } from '@/services/media/SelectedMedia';
import { actionAppearance, useReduceMotionEnabled, useThemePalette } from '@/theme';
import { RecentActivityPanel } from './components/RecentActivityPanel';
import { ConcurrentTransferProgress } from './components/ConcurrentTransferProgress';
import { TransferResultsModal } from './components/TransferResultsModal';
import { TransferStatsBar } from './components/TransferStatsBar';
import { TransferSummaryCard } from './components/TransferSummaryCard';
import { transferText } from './content/transferText';
import { useTransferController } from './useTransferController';
import { PreparationMode } from '@/services/upload/types';
import { formatDuration } from './transferPresentation';

export function transferProgressLayout(_width: number, height: number) {
  return {
    compactHeight: height < 700,
  };
}

interface TransferProgressScreenProps {
  assets: SelectedMedia[];
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
  onTerminalStateChange,
  onComplete,
  ...props
}: TransferProgressScreenProps) {
  const controller = useTransferController(props);
  return <>
    {!controller.isFinished && <ActiveTransferKeepAwake />}
    <TransferProgressView {...props} onComplete={onComplete} onTerminalStateChange={onTerminalStateChange} controller={controller} />
  </>;
}

export type TransferPresentation = ReturnType<typeof useTransferController>;

/** Shared presentation: rendering this view never starts or cancels an upload. */
export function TransferProgressView({
  assets,
  onComplete,
  includeAdditionalMediaComponents = false,
  onTerminalStateChange,
  controller,
}: TransferProgressScreenProps & { controller: TransferPresentation }) {
  const palette = useThemePalette();
  const reduceMotion = useReduceMotionEnabled();
  const completionEntrance = useAnimatedValue(0);
  const announcedCompletion = React.useRef(false);
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
    preparationComplete,
    automaticallyStreamsLargeSelection,
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
  } = controller;
  const { width, height } = useWindowDimensions();
  const { compactHeight } = transferProgressLayout(width, height);

  const errorCount = summary.failed;
  const skipCount = summary.skipped;
  const successCount = summary.success;
  const processedCount = successCount + skipCount + errorCount;
  const displayedTotalFiles = Math.max(
    completionSummary?.expandedFiles ?? totalTransferFiles,
    processedCount,
  );
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

  React.useEffect(() => {
    if (!isFinished) return;
    if (!announcedCompletion.current) {
      announcedCompletion.current = true;
      AccessibilityInfo.announceForAccessibility?.(summary.failed > 0
        ? `Transfer complete with ${summary.failed} failed files.`
        : 'Transfer complete.');
    }
  }, [isFinished, summary.failed]);

  React.useEffect(() => {
    if (!isFinished) return;
    completionEntrance.stopAnimation();
    if (reduceMotion) {
      completionEntrance.setValue(1);
      return;
    }
    completionEntrance.setValue(0);
    const animation = Animated.timing(completionEntrance, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [completionEntrance, isFinished, reduceMotion]);

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
        <AppHeader title={transferText.title} />
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 8, paddingTop: compactHeight ? 12 : 24 }}
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
            automaticallyStreamsLargeSelection={automaticallyStreamsLargeSelection}
            queueCatchUpVisible={queueCatchUpVisible}
            compact={compactHeight}
          />
        )}

        {skipCount > 0 && !isFinished && (
          <View className="rounded-[16px] bg-warning-soft dark:bg-warning-soft-dark border border-border dark:border-border-dark px-4 py-3 mb-4 flex-row items-center">
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
            transferredBytes={progressBytes}
            currentMediaMBps={currentMediaMBps}
            timeLabel={timeLabel}
            timeText={timeText}
            timeHint={timeHint}
          />
        )}

        {isFinished && (
          <Animated.View testID="transfer-completion-content" style={{
            opacity: completionEntrance,
            transform: [{ translateY: reduceMotion ? 0 : completionEntrance.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
          }}>
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
          </Animated.View>
        )}

        {!isFinished && (
          <RecentActivityPanel items={recentFiles} compact={compactHeight} />
        )}

        {!isFinished && (
          <View className={compactHeight ? 'mt-2' : 'mt-4'}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={transferText.cancelTransfer}
            onPress={cancelTransfer}
            activeOpacity={actionAppearance(palette, 'destructive').activeOpacity}
            className="w-full h-14 rounded-xl items-center justify-center flex-row bg-error-soft dark:bg-error-soft-dark border border-border dark:border-border-dark"
          >
            <Ionicons name="close-circle-outline" size={20} color={palette.error} />
            <Text className="text-error dark:text-error-dark text-lg font-semibold ml-2">{transferText.cancelTransfer}</Text>
          </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {isFinished && (
        <View testID="transfer-completion-footer" style={[styles.footer, { backgroundColor: palette.surface, borderTopColor: palette.separator }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={transferText.done}
            onPress={onComplete}
            activeOpacity={actionAppearance(palette, 'primary').activeOpacity}
            style={[styles.doneButton, actionAppearance(palette, 'primary').container]}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={palette.white} />
            <Text style={[styles.doneLabel, { color: palette.onPrimary }]}>{transferText.done}</Text>
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

// Flow layout reserves the footer above the tab bar; it cannot overlap the
// summary or depend on NativeWind absolute edges/opacity color modifiers.
const styles = StyleSheet.create({
  footer: { paddingHorizontal: 24, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  doneButton: { width: '100%', minHeight: 56, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  doneLabel: { fontSize: 18, fontWeight: '600', marginLeft: 8 },
});
