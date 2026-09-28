import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { MediaAsset, mediaScanner } from '@/services/MediaScanner';
import { interactionAppearance, mediaSelectionAppearance, useThemePalette } from '@/theme';
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
  const palette = useThemePalette();
  const formattedDuration = item.type === 'video'
    ? mediaScanner.formatDuration(item.duration)
    : undefined;
  const selected = React.useSyncExternalStore(
    React.useCallback((listener) => selectionStore.subscribe(item.id, listener), [item.id, selectionStore]),
    React.useCallback(() => selectionStore.isSelected(item.id), [item.id, selectionStore]),
    () => false,
  );
  const selection = mediaSelectionAppearance(palette, selected);
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
      accessibilityRole="button"
      accessibilityLabel={`Select ${item.type}`}
      accessibilityState={{ selected }}
      activeOpacity={interactionAppearance('action').activeOpacity}
      onPress={toggleSelection}
      style={[styles.cell, { backgroundColor: palette.surface }, itemStyle]}
    >
      <Image
        source={imageSource}
        style={styles.image}
        contentFit="cover"
        {...MEDIA_IMAGE_PERFORMANCE}
        recyclingKey={item.id}
      />

      {selected && (
        <View testID="media-selection-overlay" pointerEvents="none" style={[styles.selectionOverlay, { backgroundColor: selection.overlay, borderColor: selection.border }]} />
      )}

      {item.type === 'video' && formattedDuration && (
        <View className="absolute bottom-1 right-1 bg-black/60 px-1 rounded backdrop-blur-sm">
          <Text className="text-white text-xs font-mono">{formattedDuration}</Text>
        </View>
      )}

      <View testID="media-selection-badge" pointerEvents="none" style={[styles.selectionBadge, { backgroundColor: selection.badgeFill, borderColor: selection.badgeBorder }]}>
        {selected && <Ionicons name="checkmark" size={18} color={palette.white} />}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  cell: {
    position: 'relative',
    overflow: 'hidden',
  },
  selectionOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: 3 },
  selectionBadge: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  image: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
