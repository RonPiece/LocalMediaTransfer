import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/theme';
import { transferText } from '../content/transferText';
import { formatBytes, formatDuration, summaryBadgePresentation } from '../transferPresentation';

type TransferSummaryCardProps = {
  successCount: number;
  skipCount: number;
  errorCount: number;
  processedCount: number;
  selectedBytes: number;
  selectedMediaBytes: number;
  additionalComponentsBytes: number;
  additionalComponentsFiles: number;
  byteTotalComplete: boolean;
  transferredBytes: number;
  avoidedBytes: number;
  finalizationDuplicateBytes: number;
  elapsedSeconds: number;
  averageMediaMBps: number;
  peakMediaMBps: number;
  resultCount: number;
  onShowAll: () => void;
  onShowErrors: () => void;
};

export const TransferSummaryCard = React.memo(function TransferSummaryCard({
  successCount,
  skipCount,
  errorCount,
  processedCount,
  selectedBytes,
  selectedMediaBytes,
  additionalComponentsBytes,
  additionalComponentsFiles,
  byteTotalComplete,
  transferredBytes,
  avoidedBytes,
  finalizationDuplicateBytes,
  elapsedSeconds,
  averageMediaMBps,
  peakMediaMBps,
  resultCount,
  onShowAll,
  onShowErrors,
}: TransferSummaryCardProps) {
  const summaryBadge = summaryBadgePresentation({ errorCount, successCount, skipCount });

  return (
    <View className="bg-surface rounded-[20px] p-5 mb-4 border border-border">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-on-surface font-bold text-[18px]">{transferText.summaryTitle}</Text>
        <View className={`px-3 py-1.5 rounded-full flex-shrink ml-2 ${summaryBadge.backgroundClass}`}>
          <Text className={`text-[12px] font-bold ${summaryBadge.textClass}`} numberOfLines={1} adjustsFontSizeToFit>{summaryBadge.text}</Text>
        </View>
      </View>
      <View className="flex-row mb-4">
        {[
          { label: transferText.uploaded, value: successCount, color: theme.colors.success },
          { label: transferText.skipped, value: skipCount, color: theme.colors.warning },
          { label: transferText.failed, value: errorCount, color: theme.colors.error },
          { label: transferText.total, value: processedCount, color: theme.colors.onSurface },
        ].map((stat, index) => (
          <View key={stat.label} className={`flex-1 items-center ${index > 0 ? 'border-l border-border' : ''}`}>
            <Text style={{ color: stat.color, fontVariant: ['tabular-nums'] }} className="text-[20px] font-bold">{stat.value}</Text>
            <Text className="text-on-surface-variant text-[10px] font-semibold uppercase mt-1">{stat.label}</Text>
          </View>
        ))}
      </View>
      <View className="bg-background rounded-[14px] px-4 py-3">
        <View className="flex-row justify-between">
          <Text className="text-on-surface-variant text-[12px]">
            {byteTotalComplete ? 'Selected media' : 'Prepared selected media'}
          </Text>
          <Text className="text-on-surface text-[12px] font-semibold">{formatBytes(selectedMediaBytes)}</Text>
        </View>
        {(additionalComponentsBytes > 0 || additionalComponentsFiles > 0) && (
          <>
            <View className="flex-row justify-between mt-2">
              <Text className="text-on-surface-variant text-[12px]">
                Additional components{additionalComponentsFiles > 0 ? ` (${additionalComponentsFiles.toLocaleString()})` : ''}
              </Text>
              <Text className="text-on-surface text-[12px] font-semibold">+{formatBytes(additionalComponentsBytes)}</Text>
            </View>
            <View className="flex-row justify-between mt-2 pt-2 border-t border-border">
              <Text className="text-on-surface-variant text-[12px]">Total transfer content</Text>
              <Text className="text-on-surface text-[12px] font-semibold">{formatBytes(selectedBytes)}</Text>
            </View>
          </>
        )}
        <View className="flex-row justify-between mt-2">
          <Text className="text-on-surface-variant text-[12px]">{transferText.transferred}</Text>
          <Text className="text-on-surface text-[12px] font-semibold">{formatBytes(transferredBytes)}</Text>
        </View>
        {avoidedBytes > 0 && (
          <View className="flex-row justify-between mt-2">
            <Text className="text-on-surface-variant text-[12px]">Avoided before upload</Text>
            <Text className="text-on-surface text-[12px] font-semibold">{formatBytes(avoidedBytes)}</Text>
          </View>
        )}
        {finalizationDuplicateBytes > 0 && (
          <View className="flex-row justify-between mt-2">
            <Text className="text-on-surface-variant text-[12px]">Uploaded, then found duplicate</Text>
            <Text className="text-on-surface text-[12px] font-semibold">{formatBytes(finalizationDuplicateBytes)}</Text>
          </View>
        )}
        {!byteTotalComplete && (
          <Text className="text-warning text-[11px] leading-4 mt-2">
            Size excludes media that could not be prepared.
          </Text>
        )}
        <View className="flex-row justify-between mt-2">
          <Text className="text-on-surface-variant text-[12px]">{transferText.duration}</Text>
          <Text className="text-on-surface text-[12px] font-semibold">{formatDuration(elapsedSeconds)}</Text>
        </View>
        <View className="flex-row justify-between mt-2">
          <Text className="text-on-surface-variant text-[12px]">{transferText.averageSpeed}</Text>
          <Text className="text-on-surface text-[12px] font-semibold">{averageMediaMBps.toFixed(1)} MB/s</Text>
        </View>
        <View className="flex-row justify-between mt-2">
          <Text className="text-on-surface-variant text-[12px]">{transferText.peakSpeed}</Text>
          <Text className="text-on-surface text-[12px] font-semibold">{peakMediaMBps.toFixed(1)} MB/s</Text>
        </View>
      </View>
      <View className="flex-row gap-2 mt-4">
        <TouchableOpacity
          onPress={onShowAll}
          className="flex-1 h-12 rounded-[14px] bg-primary/20 items-center justify-center flex-row"
        >
          <Ionicons name="list-outline" size={19} color={theme.colors.primary} />
          <Text className="text-primary font-semibold ml-2 text-[12px]">{transferText.viewAllResults(resultCount.toLocaleString())}</Text>
        </TouchableOpacity>
        {errorCount > 0 && (
          <TouchableOpacity
            onPress={onShowErrors}
            className="flex-1 h-12 rounded-[14px] bg-error/20 items-center justify-center flex-row"
          >
            <Ionicons name="warning-outline" size={19} color={theme.colors.error} />
            <Text className="text-error font-semibold ml-2 text-[12px]">{transferText.viewErrors(errorCount.toLocaleString())}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});
