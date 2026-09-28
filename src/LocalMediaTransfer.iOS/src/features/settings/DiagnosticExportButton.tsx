import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { actionAppearance, useThemePalette } from '@/theme';

export function DiagnosticExportButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const palette = useThemePalette();
  const appearance = actionAppearance(palette, 'secondary', { disabled });
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} activeOpacity={appearance.activeOpacity}
    style={[{ width: 44, height: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, appearance.container]}>
    <Ionicons name="share-outline" size={20} color={appearance.foreground} />
  </TouchableOpacity>;
}
