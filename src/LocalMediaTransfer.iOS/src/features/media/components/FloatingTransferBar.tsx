import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/theme';

export const LARGE_TRANSFER_ITEM_THRESHOLD = 2000;
export const largeTransferGuidance =
  'Large transfers may take a while, use more battery, and make your iPhone feel warm. Keep it uncovered and out of direct sunlight.';

type FloatingTransferBarProps = {
  selectedCount: number;
  disabled?: boolean;
  onTransfer: () => void;
};

export const FloatingTransferBar = React.memo(function FloatingTransferBar({
  selectedCount,
  disabled = false,
  onTransfer,
}: FloatingTransferBarProps) {
  const [informationOpen, setInformationOpen] = React.useState(false);
  if (selectedCount === 0) return null;
  const isLargeTransfer = selectedCount >= LARGE_TRANSFER_ITEM_THRESHOLD;

  return (
    <>
      <View className="absolute bottom-6 left-0 right-0 px-6 items-center pointer-events-none">
        {isLargeTransfer && (
          <View className="pointer-events-auto w-full max-w-md mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex-row">
            <Ionicons name="thermometer-outline" size={20} color="#9A6700" />
            <Text className="text-amber-900 text-[13px] leading-5 ml-2 flex-1">
              {largeTransferGuidance}
            </Text>
          </View>
        )}
        <View className="w-full max-w-md flex-row pointer-events-auto">
          <TouchableOpacity
            disabled={disabled}
            onPress={onTransfer}
            className="flex-1 rounded-2xl h-14 flex-row items-center justify-center px-5 shadow-lg shadow-black/40"
            style={{ backgroundColor: disabled ? theme.colors.onSurfaceVariant : theme.colors.primary }}
          >
            <Ionicons name="arrow-forward-outline" size={20} color={theme.colors.white} />
            <Text className="text-on-primary text-lg font-semibold ml-2">
              {disabled ? 'Preparing…' : `Transfer ${selectedCount.toLocaleString()} Files`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Large transfer information"
            onPress={() => setInformationOpen(true)}
            className="ml-2 h-14 w-14 rounded-2xl bg-surface border border-border items-center justify-center"
          >
            <Ionicons name="information-circle-outline" size={25} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={informationOpen}
        onRequestClose={() => setInformationOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-center px-7"
          onPress={() => setInformationOpen(false)}
        >
          <Pressable
            accessibilityViewIsModal
            className="bg-surface rounded-3xl p-6"
            onPress={event => event.stopPropagation()}
          >
            <View className="flex-row items-center mb-3">
              <Ionicons name="thermometer-outline" size={24} color={theme.colors.warning} />
              <Text className="text-on-surface text-xl font-bold ml-2">Large transfers</Text>
            </View>
            <Text className="text-on-surface-variant text-[15px] leading-6">
              {largeTransferGuidance}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setInformationOpen(false)}
              className="mt-5 h-12 bg-primary rounded-xl items-center justify-center"
            >
              <Text className="text-on-primary text-[16px] font-semibold">Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
});
