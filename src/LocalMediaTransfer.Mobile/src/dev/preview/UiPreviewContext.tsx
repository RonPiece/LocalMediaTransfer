import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemePalette } from '@/theme';
import type { PreviewIntegration } from '@/integrations/uiPreview/contract';

export const UiPreviewContext = React.createContext<PreviewIntegration>({ active: false });

export const useUiPreview = () => React.useContext(UiPreviewContext);

export function UiPreviewEntry() {
  const { openPreview } = useUiPreview();
  const palette = useThemePalette();
  if (!openPreview) return null;
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open UI Preview" onPress={openPreview}
    className="rounded-2xl border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-4 py-4 mb-4 flex-row items-center">
    <Ionicons name="flask-outline" size={24} color={palette.primary} />
    <View className="flex-1 ml-3">
      <Text className="text-[16px] font-semibold text-on-surface dark:text-on-surface-dark">UI Preview</Text>
      <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1">Developer tools · explore screens with sample data</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={palette.onSurfaceVariant} />
  </TouchableOpacity>;
}
