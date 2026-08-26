import React from 'react';
import { LayoutChangeEvent, Text, useWindowDimensions, View } from 'react-native';

import { transferText } from '../content/transferText';
import { theme } from '@/theme';

const SCREEN_HORIZONTAL_PADDING = 48;
const CARD_HORIZONTAL_INSET = 18;

type TransferStatsBarProps = {
  itemsRemaining: number;
  remainingLabel: string;
  currentMediaMBps: number;
  timeLabel: string;
  timeText: string;
  timeHint?: string;
  processedFiles?: number;
  totalFiles?: number;
};

export function shouldUseCompactStatsLayout(availableWidth: number, fontScale: number): boolean {
  return availableWidth < 330 || fontScale > 1.15;
}

export function TransferStatsBar({
  itemsRemaining,
  remainingLabel,
  currentMediaMBps,
  timeLabel,
  timeText,
  timeHint,
  processedFiles,
  totalFiles,
}: TransferStatsBarProps) {
  const { width, fontScale } = useWindowDimensions();
  const [measuredContentWidth, setMeasuredContentWidth] = React.useState(0);
  const availableWidth = measuredContentWidth || Math.max(
    0,
    width - SCREEN_HORIZONTAL_PADDING - CARD_HORIZONTAL_INSET,
  );
  const compact = shouldUseCompactStatsLayout(availableWidth, fontScale);
  const measureContent = React.useCallback((event: LayoutChangeEvent) => {
    setMeasuredContentWidth(event.nativeEvent.layout.width);
  }, []);

  const filesStat = (
    <View className="flex-1 min-w-0 items-start px-3">
      <Text className="text-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{remainingLabel}</Text>
      <Text className="text-on-surface text-[18px] font-semibold mt-1" style={{ fontVariant: ['tabular-nums'] }}>{itemsRemaining.toLocaleString()}</Text>
    </View>
  );
  const speedStat = (
    <View className="flex-1 min-w-0 items-start px-3 border-l border-border">
      <Text className="text-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{transferText.currentSpeed}</Text>
      <Text className="text-on-surface text-[18px] font-semibold mt-1" style={{ fontVariant: ['tabular-nums'] }}>
        {currentMediaMBps.toFixed(1)} <Text className="text-[11px]">MB/s</Text>
      </Text>
    </View>
  );
  const timeStat = (
    <View
      testID={compact ? 'transfer-eta-compact' : 'transfer-eta-wide'}
      className={compact ? 'min-w-0 items-start px-3 pt-3 mt-3 border-t border-border' : 'flex-1 min-w-0 items-start px-3 border-l border-border'}
    >
      <Text className="text-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{timeLabel}</Text>
      <Text className="text-[14px] leading-5 font-semibold mt-1 text-primary">
        {timeText}
      </Text>
      {timeHint && (
        <Text className="text-on-surface-variant text-[11px] leading-4 mt-1">{timeHint}</Text>
      )}
    </View>
  );

  return (
    <View testID="transfer-stats-card" className="bg-surface rounded-[18px] px-2 py-4 mb-4 border border-border">
      <View testID="transfer-stats-content" onLayout={measureContent}>
        <View className="flex-row">
          {filesStat}
          {speedStat}
          {!compact && timeStat}
        </View>
        {compact && timeStat}
        {typeof processedFiles === 'number' && typeof totalFiles === 'number' && totalFiles > 0 && (
          <View className="px-3 pt-3 mt-3 border-t border-border">
            <View className="flex-row justify-between mb-2">
              <Text className="text-on-surface-variant text-[10px] font-bold uppercase tracking-wider">File transfer</Text>
              <Text className="text-on-surface-variant text-[11px] font-semibold" style={{ fontVariant: ['tabular-nums'] }}>
                {Math.min(processedFiles, totalFiles).toLocaleString()} of {totalFiles.toLocaleString()} processed
              </Text>
            </View>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="File transfer progress"
              accessibilityValue={{ min: 0, max: totalFiles, now: Math.min(processedFiles, totalFiles) }}
              className="h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: theme.colors.progressTrack }}
            >
              <View
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, processedFiles / totalFiles * 100))}%` }}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
