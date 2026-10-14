import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

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
  return (
    <View className="px-4 py-3 my-3 flex-row justify-between items-center bg-surface dark:bg-surface-dark mx-3 rounded-[16px] border border-border dark:border-border-dark">
      <View>
        <Text className="text-on-surface dark:text-on-surface-dark text-base font-semibold">{selectedCount} Items Selected</Text>
        {selectedCount > 0 && <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[11px] mt-0.5">Drag sideways across photos to select a range</Text>}
      </View>
      <View className="flex-row items-center gap-4">
        {loading ? (
          <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-sm font-semibold">Loading…</Text>
        ) : allMediaLoaded && selectedCount >= mediaCount && selectedCount > 0 ? (
          <TouchableOpacity onPress={onDeselectAll}>
            <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-sm font-semibold">Deselect All</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onSelectAll}>
            <Text className="text-primary dark:text-primary-dark text-sm font-bold">Select All</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});
