import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { MediaAsset, mediaScanner } from '@/services/MediaScanner';
import { theme } from '@/theme';
import { SelectionStore } from '../hooks/useMediaSelection';
import { MEDIA_IMAGE_PERFORMANCE } from '../mediaGridPerformance';

type MediaGridItemProps = {
  item: MediaAsset;
  itemSize: number;
  itemMargin: number;
  selectionStore: SelectionStore;
  suppressNextPress: React.MutableRefObject<boolean>;
  onToggleSelection: (id: string) => void;
};

export const MediaGridItem = React.memo(function MediaGridItem({
  item,
  itemSize,
  itemMargin,
  selectionStore,
  suppressNextPress,
  onToggleSelection,
}: MediaGridItemProps) {
  const formattedDuration = item.type === 'video'
    ? mediaScanner.formatDuration(item.duration)
    : undefined;
  const selected = React.useSyncExternalStore(
    React.useCallback((listener) => selectionStore.subscribe(item.id, listener), [item.id, selectionStore]),
    React.useCallback(() => selectionStore.isSelected(item.id), [item.id, selectionStore]),
    () => false,
  );
  const imageSource = React.useMemo(() => ({
    uri: item.uri,
    width: itemSize,
    height: itemSize,
  }), [item.uri, itemSize]);
  const itemStyle = React.useMemo(
    () => ({ width: itemSize, height: itemSize, margin: itemMargin }),
    [itemMargin, itemSize],
  );
  const toggleSelection = React.useCallback(() => {
    if (suppressNextPress.current) {
      suppressNextPress.current = false;
      return;
    }
    onToggleSelection(item.id);
  }, [item.id, onToggleSelection, suppressNextPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={toggleSelection}
      style={[styles.cell, itemStyle]}
    >
      <Image
        source={imageSource}
        style={styles.image}
        contentFit="cover"
        {...MEDIA_IMAGE_PERFORMANCE}
        recyclingKey={item.id}
      />

      {selected && (
        <View className="absolute inset-0 bg-black/30 border-4 border-primary" />
      )}

      {item.type === 'video' && formattedDuration && (
        <View className="absolute bottom-1 right-1 bg-black/60 px-1 rounded backdrop-blur-sm">
          <Text className="text-white text-xs font-mono">{formattedDuration}</Text>
        </View>
      )}

      {selected ? (
        <View className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary items-center justify-center shadow-md">
          <Ionicons name="checkmark" size={16} color={theme.colors.white} />
        </View>
      ) : (
        <View className="absolute top-2 right-2 w-6 h-6 rounded-full border border-white/50 bg-black/20 backdrop-blur-sm" />
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  cell: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  image: StyleSheet.absoluteFillObject,
});
