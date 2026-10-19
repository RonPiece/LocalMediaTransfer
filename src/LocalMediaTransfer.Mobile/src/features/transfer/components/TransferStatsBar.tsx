import React from 'react';
import { LayoutChangeEvent, Text, useWindowDimensions, View } from 'react-native';

import { useThemePalette } from '@/theme';
import { transferText } from '../content/transferText';
import { formatBytes } from '../transferPresentation';

type TransferStatsBarProps = {
  itemsRemaining: number;
  remainingLabel: string;
  transferredBytes?: number;
  currentMediaMBps: number;
  timeLabel: string;
  timeText: string;
  timeHint?: string;
};

// Narrow and large-text layouts use divided rows instead of orphaning a metric.
export function shouldUseCompactStatsLayout(availableWidth: number, fontScale: number): boolean {
  return availableWidth < 300 || fontScale > 1.15;
}

export function TransferStatsBar({ itemsRemaining, remainingLabel, transferredBytes,
  currentMediaMBps, timeLabel, timeText, timeHint }: TransferStatsBarProps) {
  const palette = useThemePalette();
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = React.useState(0);
  const compact = shouldUseCompactStatsLayout(contentWidth || Math.max(0, width - 80), fontScale);
  const measureContent = React.useCallback((event: LayoutChangeEvent) => setContentWidth(event.nativeEvent.layout.width), []);
  const metrics = [
    { label: remainingLabel, value: itemsRemaining.toLocaleString() },
    ...(transferredBytes === undefined ? [] : [{ label: 'Transferred', value: formatBytes(transferredBytes) }]),
    { label: transferText.currentSpeed, value: `${currentMediaMBps.toFixed(1)} MB/s` },
  ];
  return <View testID="transfer-stats-card" className="bg-surface dark:bg-surface-dark rounded-[18px] p-4 mb-4 border border-border dark:border-border-dark">
    <View testID="transfer-stats-content" onLayout={measureContent}>
      <View testID={compact ? 'transfer-metrics-rows' : 'transfer-metrics-columns'} style={{ flexDirection: compact ? 'column' : 'row' }}>
        {metrics.map((metric, index) => <View key={metric.label} style={{
          flex: compact ? undefined : 1, minWidth: 0,
          paddingHorizontal: compact ? 0 : 8, paddingVertical: compact ? 12 : 0,
          borderLeftWidth: !compact && index > 0 ? 1 : 0,
          borderTopWidth: compact && index > 0 ? 1 : 0,
          borderColor: palette.separator,
        }}>
          <Text style={{ color: palette.onSurfaceVariant, fontSize: 12, lineHeight: 16, fontWeight: '600', minHeight: compact ? undefined : 32 * fontScale }}>{metric.label}</Text>
          <Text style={{ color: palette.onSurface, fontSize: 16, fontWeight: '600', marginTop: 6, fontVariant: ['tabular-nums'] }}>{metric.value}</Text>
        </View>)}
      </View>
      <View testID={compact ? 'transfer-eta-compact' : 'transfer-eta-wide'} style={{ borderTopWidth: 1, borderColor: palette.separator, paddingTop: 12, marginTop: compact ? 0 : 16 }}>
        <View className="flex-row flex-wrap items-baseline justify-between">
          <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[12px] font-semibold">{timeLabel}</Text>
          <Text className="text-on-surface dark:text-on-surface-dark text-[14px] font-semibold">{timeText}</Text>
        </View>
        {timeHint && <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[12px] leading-4 mt-2">{timeHint}</Text>}
      </View>
    </View>
  </View>;
}
