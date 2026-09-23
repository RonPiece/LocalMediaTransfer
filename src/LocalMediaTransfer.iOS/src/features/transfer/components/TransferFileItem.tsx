import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { FileState, fileStatusPresentation, formatBytes } from '../transferPresentation';
import { mediaVariantLabel } from '@/services/upload/mediaVariants';
import { useThemePalette } from '@/theme';

export const TransferFileItem = React.memo(function TransferFileItem({
  item,
  showFullFilename = false,
}: {
  item: FileState;
  showFullFilename?: boolean;
}) {
  const palette = useThemePalette();
  const presentation = fileStatusPresentation(item.status);
  const active = item.status === 'uploading' || item.status === 'pending';

  return (
    <View className="flex-row items-center justify-between py-3 border-b border-border dark:border-border-dark">
      <View className="flex-row items-center flex-1 min-w-0">
        {item.thumbnailUri ? (
          <View className="w-12 h-12 rounded-xl overflow-hidden bg-background dark:bg-background-dark">
            <Image source={{ uri: item.thumbnailUri }} style={{ width: 48, height: 48 }} contentFit="cover" cachePolicy="disk" recyclingKey={item.assetId || item.id} />
            {item.mediaType === 'video' && (
              <View className="absolute inset-0 items-center justify-center bg-black/15"><Ionicons name="play" size={17} color="#FFFFFF" /></View>
            )}
          </View>
        ) : (
          <View className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-primary-dark/20 items-center justify-center">
            <Ionicons name="document-outline" size={23} color={palette.primary} />
          </View>
        )}
        <View className="ml-3 flex-1 min-w-0">
          <Text className="text-on-surface dark:text-on-surface-dark text-sm" numberOfLines={showFullFilename ? undefined : 1}>
            {item.filename}
          </Text>
          {item.mediaRole && item.mediaRole !== 'unknown' && (
            <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[11px] mt-0.5">
              {item.componentSemantics === 'optional' ? 'Additional' : 'Primary'} · {mediaVariantLabel(item.mediaRole)}
            </Text>
          )}
          <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-xs mt-1 leading-4" numberOfLines={showFullFilename ? undefined : 1}>
            {item.sizeBytes !== undefined ? `${formatBytes(item.sizeBytes)} · ` : ''}{presentation.text}
            {item.msg ? ` · ${item.msg}` : ''}
          </Text>
        </View>
      </View>
      <View className="w-9 h-9 rounded-full items-center justify-center ml-3" style={{ backgroundColor: active ? palette.primarySoft : `${presentation.color}18` }}>
        {active ? (
          <ActivityIndicator size="small" color={palette.primary} />
        ) : (
          <Ionicons name={presentation.icon} size={22} color={presentation.color} />
        )}
      </View>
    </View>
  );
});
