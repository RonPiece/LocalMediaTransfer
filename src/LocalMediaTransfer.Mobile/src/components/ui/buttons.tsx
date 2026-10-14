import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { actionAppearance, useThemePalette } from '@/theme';
import { IconName } from './types';

export function HelpButton({ label, onPress, className = '' }: { label: string; onPress: () => void; className?: string }) {
  const palette = useThemePalette();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      activeOpacity={actionAppearance(palette, 'plain').activeOpacity}
      className={`ml-2 w-6 h-6 rounded-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark items-center justify-center ${className}`}
    >
      <Ionicons name="help" size={15} color={palette.primary} />
    </TouchableOpacity>
  );
}

export function PrimaryButton({
  title,
  icon,
  onPress,
  disabled = false,
  className = '',
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const palette = useThemePalette();
  const appearance = actionAppearance(palette, 'primary', { disabled });
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      activeOpacity={appearance.activeOpacity}
      style={appearance.container}
      className={`h-[50px] w-full rounded-xl items-center justify-center flex-row ${className}`}
    >
      {icon && <Ionicons name={icon} size={22} color={appearance.foreground} />}
      <Text style={{ color: appearance.foreground }} className={`text-[17px] font-semibold ${icon ? 'ml-2' : ''}`}>{title}</Text>
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  title,
  icon,
  onPress,
  disabled = false,
  className = '',
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const palette = useThemePalette();
  const appearance = actionAppearance(palette, 'secondary', { disabled });
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      activeOpacity={appearance.activeOpacity}
      style={appearance.container}
      className={`h-11 rounded-xl items-center justify-center flex-row ${className}`}
    >
      {icon && <Ionicons name={icon} size={18} color={appearance.foreground} />}
      <Text style={{ color: appearance.foreground }} className={`text-[17px] font-semibold ${icon ? 'ml-2' : ''}`}>{title}</Text>
    </TouchableOpacity>
  );
}
