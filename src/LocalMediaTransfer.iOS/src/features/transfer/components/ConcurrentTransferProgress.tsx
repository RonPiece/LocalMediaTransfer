import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useThemePalette } from '@/theme';
import { DuplicateCheckStage } from '@/services/upload/types';

type ConcurrentTransferProgressProps = {
  preparedAssets: number;
  totalAssets: number;
  processedFiles: number;
  totalFiles?: number;
  preparationComplete?: boolean;
  hasUploadStarted?: boolean;
  phase?: 'preparing' | 'checking' | 'waiting' | 'uploading';
  duplicateStage?: DuplicateCheckStage;
  includeAdditionalMediaComponents?: boolean;
  compact?: boolean;
};

function duplicateText(stage: DuplicateCheckStage): string {
  if (stage === 'checking-contents') return 'Checking file contents';
  if (stage === 'verifying-windows') return 'Verifying matches on Windows';
  return 'Finding possible matches';
}

export function ConcurrentTransferProgress({
  preparedAssets,
  totalAssets,
  processedFiles,
  totalFiles = 0,
  preparationComplete = false,
  hasUploadStarted,
  phase = 'preparing',
  duplicateStage = 'finding-matches',
  includeAdditionalMediaComponents = false,
  compact = false,
}: ConcurrentTransferProgressProps) {
  const palette = useThemePalette();
  const analyzedAssets = totalAssets > 0
    ? Math.max(0, Math.min(preparedAssets, totalAssets))
    : Math.max(0, preparedAssets);
  const preparationPercent = totalAssets > 0
    ? Math.max(0, Math.min(100, Math.floor((analyzedAssets / totalAssets) * 100)))
    : 0;
  const preparationStatus = preparationComplete
    ? `${totalAssets.toLocaleString()} media items analyzed`
    : phase === 'checking'
      ? duplicateText(duplicateStage)
      : `${analyzedAssets.toLocaleString()} of ${totalAssets.toLocaleString()} media items analyzed`;
  const transferIsExplicitlyWaiting = hasUploadStarted === false;
  const transferIsActive = hasUploadStarted !== false;
  const completedTransferText = transferIsExplicitlyWaiting
    ? 'Waiting for prepared media'
    : totalFiles > 0
      ? `${processedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} files completed`
      : processedFiles > 0
        ? `${processedFiles.toLocaleString()} ${processedFiles === 1 ? 'file' : 'files'} completed`
        : 'Transfer active';

  return (
    <View
      testID="concurrent-transfer-progress"
      className={`bg-surface dark:bg-surface-dark rounded-[18px] border border-border dark:border-border-dark px-4 ${compact ? 'py-3 mb-3' : 'py-4 mb-4'}`}
    >
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-success/10 items-center justify-center">
          <Ionicons name="images-outline" size={20} color={palette.success} />
        </View>
        <View className="flex-1 ml-3 min-w-0">
          <View className="flex-row items-center justify-between">
            <Text className="text-on-surface dark:text-on-surface-dark text-[15px] font-semibold">Preparing media</Text>
            <Text
              className="text-success text-[14px] font-bold ml-3"
              style={{ fontVariant: ['tabular-nums'] }}
            >
            {preparationComplete ? <Ionicons name="checkmark-circle" size={20} color={palette.success} /> : `${preparationPercent}%`}
            </Text>
          </View>
          <Text
            className="text-on-surface-variant dark:text-on-surface-variant-dark text-[12px] mt-0.5"
            style={{ fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {preparationStatus}
          </Text>
          <View
            className="h-1.5 rounded-full mt-2 overflow-hidden"
            style={{ backgroundColor: palette.progressTrack }}
          >
            <View
              testID="concurrent-preparation-progress"
              className="h-full rounded-full bg-success"
              style={{ width: `${preparationPercent}%` }}
            />
          </View>
        </View>
      </View>

      <View className={`${compact ? 'my-2.5' : 'my-3'} border-t border-border dark:border-border-dark`} />

      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center">
          <Ionicons name="cloud-upload-outline" size={20} color={palette.primary} />
        </View>
        <View className="flex-1 ml-3 min-w-0">
          <Text className="text-on-surface dark:text-on-surface-dark text-[15px] font-semibold">Transferring files</Text>
          <Text
            className="text-primary text-[12px] font-semibold mt-0.5"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {completedTransferText}
          </Text>
          {includeAdditionalMediaComponents && (
            <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[10px] leading-[14px] mt-1">
              Extra files may be added as additional media components are discovered.
            </Text>
          )}
        </View>
        <View className="w-8 items-end">
          {transferIsActive ? <ActivityIndicator size="small" color={palette.primary} /> : <Ionicons name="time-outline" size={20} color={palette.onSurfaceVariant} />}
        </View>
      </View>
    </View>
  );
}
