import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { actionAppearance, outlinedActionAppearance, useThemePalette } from '@/theme';
import { dashboardText } from '../content/dashboardText';

export function CopyAddressButton({ onPress, disabled = false, fullWidth = false }: { onPress: () => void; disabled?: boolean; fullWidth?: boolean }) {
  const palette = useThemePalette();
  const appearance = fullWidth ? actionAppearance(palette, 'primary', { disabled }) : outlinedActionAppearance(palette, { disabled });
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Copy server address" accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} activeOpacity={appearance.activeOpacity}
    style={[styles.button, fullWidth && styles.fullWidth, appearance.container]}>
    <Ionicons name="copy-outline" size={fullWidth ? 20 : 16} color={appearance.foreground} />
    <Text style={[styles.label, fullWidth && styles.fullWidthLabel, { color: appearance.foreground }]}>{dashboardText.copyLink}</Text>
  </TouchableOpacity>;
}
const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  fullWidth: { width: '100%', minHeight: 48 },
  fullWidthLabel: { fontSize: 16 },
  label: { fontSize: 13, fontWeight: '600', marginLeft: 6, flexShrink: 1 },
});
