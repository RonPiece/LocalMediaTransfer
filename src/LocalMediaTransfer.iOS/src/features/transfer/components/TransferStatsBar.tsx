import React from 'react';
import { LayoutChangeEvent, Text, useWindowDimensions, View } from 'react-native';

import { transferText } from '../content/transferText';
import { formatBytes } from '../transferPresentation';

const SCREEN_HORIZONTAL_PADDING = 48;
const CARD_HORIZONTAL_INSET = 18;

type TransferStatsBarProps = {
  itemsRemaining: number;
  remainingLabel: string;
  transferredBytes?: number;
  currentMediaMBps: number;
  timeLabel: string;
  timeText: string;
  timeHint?: string;
};

export function shouldUseCompactStatsLayout(availableWidth: number, fontScale: number): boolean {
  return availableWidth < 330 || fontScale > 1.15;
}

export function TransferStatsBar({
  itemsRemaining,
  remainingLabel,
  transferredBytes,
  currentMediaMBps,
  timeLabel,
  timeText,
  timeHint,
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
  const hasTransferredColumn = transferredBytes !== undefined;
  const statHorizontalPadding = hasTransferredColumn ? 'px-2' : 'px-3';
  const valueTextSize = hasTransferredColumn ? 'text-[16px]' : 'text-[18px]';
  const labelTextSize = hasTransferredColumn ? 'text-[9px]' : 'text-[10px]';

  const filesStat = (
    <View className={`flex-1 min-w-0 items-start ${statHorizontalPadding}`}>
      <Text className={`text-on-surface-variant ${labelTextSize} font-bold uppercase tracking-wider`}>{remainingLabel}</Text>
      <Text className={`text-on-surface ${valueTextSize} font-semibold mt-1`} style={{ fontVariant: ['tabular-nums'] }}>{itemsRemaining.toLocaleString()}</Text>
    </View>
  );
  const speedStat = (
    <View className={`flex-1 min-w-0 items-start ${statHorizontalPadding} border-l border-border`}>
      <Text className={`text-on-surface-variant ${labelTextSize} font-bold uppercase tracking-wider`}>{transferText.currentSpeed}</Text>
      <Text className={`text-on-surface ${valueTextSize} font-semibold mt-1`} style={{ fontVariant: ['tabular-nums'] }}>
        {currentMediaMBps.toFixed(1)} <Text className={hasTransferredColumn ? 'text-[10px]' : 'text-[11px]'}>MB/s</Text>
      </Text>
    </View>
  );
  const transferredStat = transferredBytes === undefined ? null : (
    <View className={`flex-1 min-w-0 items-start ${statHorizontalPadding} border-l border-border`}>
      <Text className={`text-on-surface-variant ${labelTextSize} font-bold uppercase tracking-wider`}>Transferred</Text>
      <Text
        className={`text-on-surface ${valueTextSize} font-semibold mt-1`}
        style={{ fontVariant: ['tabular-nums'] }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {formatBytes(transferredBytes)}
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
          {transferredStat}
          {speedStat}
          {!compact && timeStat}
        </View>
        {compact && timeStat}
      </View>
    </View>
  );
}
