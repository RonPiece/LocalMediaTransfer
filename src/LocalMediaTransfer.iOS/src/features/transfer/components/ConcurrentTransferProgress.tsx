import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/theme';

type ConcurrentTransferProgressProps = {
  preparedAssets: number;
  totalAssets: number;
  processedFiles: number;
  compact?: boolean;
};

export function ConcurrentTransferProgress({
  preparedAssets,
  totalAssets,
  processedFiles,
  compact = false,
}: ConcurrentTransferProgressProps) {
  const analyzedAssets = totalAssets > 0
    ? Math.max(0, Math.min(preparedAssets, totalAssets))
    : Math.max(0, preparedAssets);
  const preparationPercent = totalAssets > 0
    ? Math.max(0, Math.min(100, Math.floor((analyzedAssets / totalAssets) * 100)))
    : 0;
  const completedTransferText = processedFiles > 0
    ? `${processedFiles.toLocaleString()} ${processedFiles === 1 ? 'file' : 'files'} completed`
    : 'Transfer active';

  return (
    <View
      testID="concurrent-transfer-progress"
      className={`bg-surface rounded-[18px] border border-border px-4 ${compact ? 'py-3 mb-3' : 'py-4 mb-4'}`}
    >
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-success/10 items-center justify-center">
          <Ionicons name="images-outline" size={20} color={theme.colors.success} />
        </View>
        <View className="flex-1 ml-3 min-w-0">
          <View className="flex-row items-center justify-between">
            <Text className="text-on-surface text-[15px] font-semibold">Preparing media</Text>
            <Text
              className="text-success text-[14px] font-bold ml-3"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {preparationPercent}%
            </Text>
          </View>
          <Text
            className="text-on-surface-variant text-[12px] mt-0.5"
            style={{ fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {analyzedAssets.toLocaleString()} of {totalAssets.toLocaleString()} media items analyzed
          </Text>
          <View
            className="h-1.5 rounded-full mt-2 overflow-hidden"
            style={{ backgroundColor: theme.colors.progressTrack }}
          >
            <View
              testID="concurrent-preparation-progress"
              className="h-full rounded-full bg-success"
              style={{ width: `${preparationPercent}%` }}
            />
          </View>
        </View>
      </View>

      <View className={`${compact ? 'my-2.5' : 'my-3'} border-t border-border`} />

      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center">
          <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.primary} />
        </View>
        <View className="flex-1 ml-3 min-w-0">
          <Text className="text-on-surface text-[15px] font-semibold">Transferring files</Text>
          <Text
            className="text-primary text-[12px] font-semibold mt-0.5"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {completedTransferText}
          </Text>
        </View>
      </View>
    </View>
  );
}
