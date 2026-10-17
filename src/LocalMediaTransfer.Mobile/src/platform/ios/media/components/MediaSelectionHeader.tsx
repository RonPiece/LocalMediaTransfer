import React from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

export const MediaSelectionHeader = React.memo(function MediaSelectionHeader({
  selectedCount,
  mediaCount,
  loading,
  allMediaLoaded,
  onSelectAll,
  onDeselectAll,
}: {
  selectedCount: number;
  mediaCount: number;
  loading: boolean;
  allMediaLoaded: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 390 || fontScale > 1.2;
  return (
    <View className={`px-4 py-3 my-3 justify-between bg-surface dark:bg-surface-dark mx-3 rounded-[16px] border border-border dark:border-border-dark ${compact ? 'items-start' : 'flex-row items-center'}`}>
      <View className="shrink">
        <Text className="text-on-surface dark:text-on-surface-dark text-base font-semibold">{selectedCount} Items Selected</Text>
        {selectedCount > 0 && <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[12px] mt-0.5">Drag sideways across photos to select a range</Text>}
      </View>
      <View className={`flex-row items-center ${compact ? 'mt-2' : 'ml-2'}`}>
        {loading ? (
          <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-sm font-semibold">Loading…</Text>
        ) : allMediaLoaded && selectedCount >= mediaCount && selectedCount > 0 ? (
          <TouchableOpacity accessibilityRole="button" onPress={onDeselectAll} className="min-h-12 justify-center px-2">
            <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-sm font-semibold">Deselect All</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: allMediaLoaded && mediaCount === 0 }} disabled={allMediaLoaded && mediaCount === 0} onPress={onSelectAll} className="min-h-12 justify-center px-2">
            <Text className="text-primary dark:text-primary-dark text-sm font-bold">Select All</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});
