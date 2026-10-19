import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { actionAppearance, useThemePalette } from '@/theme';

/** Shared navigation affordance for full screens and nested sheets. */
export function BackButton({ onPress, accessibilityLabel = 'Back', disabled = false }: {
  onPress: () => void; accessibilityLabel?: string; disabled?: boolean;
}) {
  const palette = useThemePalette();
  const appearance = actionAppearance(palette, 'plain', { disabled });
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} activeOpacity={appearance.activeOpacity}
    style={{ minWidth: 48, minHeight: 48, flexDirection: 'row', alignItems: 'center' }}>
    <Ionicons name="chevron-back" size={22} color={appearance.foreground} accessible={false} />
    <Text style={{ color: appearance.foreground, fontSize: 17 }}>Back</Text>
  </TouchableOpacity>;
}
