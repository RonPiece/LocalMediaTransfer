import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/theme';
import { DuplicateCheckStage, PreparationMode } from '@/services/upload/types';
import { formatBytes } from '../transferPresentation';

type TransferPhaseBannerProps = {
  isFinished: boolean;
  preparedFiles: number;
  readyFiles: number;
  totalAssets: number;
  expandedFiles: number;
  preparationComplete: boolean;
  preparationMode: PreparationMode;
  phase: 'preparing' | 'checking' | 'waiting' | 'uploading';
  hasUploadStarted: boolean;
  queueCatchUpVisible: boolean;
  acknowledgedMediaBytes: number;
  currentMediaMBps: number;
  duplicateCheck: {
    stage: DuplicateCheckStage;
    checked: number;
    total: number;
  };
};

function duplicateStageText(stage: DuplicateCheckStage): string {
  switch (stage) {
    case 'checking-contents':
      return 'Checking file contents';
    case 'verifying-windows':
      return 'Verifying matches on Windows';
    case 'finding-matches':
    default:
      return 'Finding possible matches';
  }
}

export const TransferPhaseBanner = React.memo(function TransferPhaseBanner({
  isFinished,
  preparedFiles,
  readyFiles,
  totalAssets,
  expandedFiles,
  preparationComplete,
  preparationMode,
  phase,
  hasUploadStarted,
  queueCatchUpVisible,
  acknowledgedMediaBytes,
  currentMediaMBps,
  duplicateCheck,
}: TransferPhaseBannerProps) {
  const [expanded, setExpanded] = React.useState(false);
  if (isFinished) return null;
  const streamingTransferActive = preparationMode === 'streaming' && hasUploadStarted;
  const duplicateStage = duplicateStageText(duplicateCheck.stage);
  const duplicateRemaining = Math.max(0, duplicateCheck.total - duplicateCheck.checked);
  const duplicateStatus = duplicateCheck.total > 0
    ? `${duplicateStage} · ${Math.min(duplicateCheck.checked, duplicateCheck.total).toLocaleString()} of ${duplicateCheck.total.toLocaleString()} checked · ${duplicateRemaining.toLocaleString()} remaining`
    : duplicateStage;
  const title = !preparationComplete && phase === 'checking' && !streamingTransferActive
    ? 'Checking for duplicates'
    : streamingTransferActive && !preparationComplete
      ? 'Transferring while preparing'
      : !preparationComplete
        ? 'Preparing media'
        : 'Transferring files';
  const status = !preparationComplete && phase === 'checking' && !streamingTransferActive
    ? duplicateStatus
    : !preparationComplete
      ? `${preparedFiles.toLocaleString()} of ${totalAssets.toLocaleString()} media items analyzed`
      : `${expandedFiles.toLocaleString()} files to process`;
  const transferStatus = streamingTransferActive
    ? `${formatBytes(acknowledgedMediaBytes)} transferred · ${currentMediaMBps.toFixed(1)} MB/s`
    : undefined;
  const secondaryStatus = streamingTransferActive && phase === 'checking'
    ? duplicateStatus
    : queueCatchUpVisible
      ? 'Transfer is catching up with prepared files'
      : undefined;
  const details = !preparationComplete && phase === 'checking'
    ? 'Possible matches are checked before upload. Windows makes the final duplicate decision.'
    : !preparationComplete && preparationMode === 'prepare-first'
      ? 'Media selected ✓ · Prepare and check · Transfer. Upload begins after all selected media is ready, which can require significant free device storage.'
      : !preparationComplete
        ? 'Media selected ✓ · Prepare and check · Transfer. In this mode, preparation and transfer overlap while the final size is determined.'
        : `${totalAssets.toLocaleString()} selected Photos items expanded into ${expandedFiles.toLocaleString()} transferable files. ${readyFiles.toLocaleString()} are ready.`;

  return (
    <View className="mb-4">
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${status}. ${expanded ? 'Hide details' : 'Show details'}`}
        accessibilityState={{ expanded }}
        activeOpacity={0.75}
        onPress={() => setExpanded(value => !value)}
        className={`rounded-[18px] border px-4 py-3 ${preparationComplete ? 'bg-green-50 border-green-200' : 'bg-surface border-border'}`}
      >
        <View className="flex-row items-center min-h-[44px]">
          <Ionicons
            name={preparationComplete ? 'checkmark-circle' : 'images-outline'}
            size={22}
            color={preparationComplete ? theme.colors.success : theme.colors.primary}
          />
          <View className="flex-1 ml-3">
            <Text className="text-on-surface text-[16px] font-semibold" numberOfLines={1}>
              {title}
            </Text>
            <Text
              className={preparationComplete ? 'text-on-surface-variant text-[13px] mt-0.5' : 'text-primary text-[13px] font-semibold mt-0.5'}
              numberOfLines={phase === 'checking' && !streamingTransferActive ? 2 : 1}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {status}
            </Text>
            {transferStatus && (
              <Text
                className="text-on-surface-variant text-[12px] mt-0.5"
                style={{ fontVariant: ['tabular-nums'] }}
                numberOfLines={1}
              >
                {transferStatus}
              </Text>
            )}
            {secondaryStatus && (
              <Text className="text-on-surface-variant text-[12px] mt-0.5" numberOfLines={2}>
                {secondaryStatus}
              </Text>
            )}
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={19}
            color={theme.colors.onSurfaceVariant}
          />
        </View>
        {expanded && (
          <Text className="text-on-surface-variant text-[13px] leading-5 mt-2 ml-[34px] mr-5">
            {details}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
});
