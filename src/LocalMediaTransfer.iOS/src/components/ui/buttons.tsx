import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/theme';
import { IconName } from './types';

export function HelpButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="ml-2 w-6 h-6 rounded-full bg-surface border border-border items-center justify-center"
    >
      <Ionicons name="help" size={15} color={theme.colors.primary} />
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
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.8}
      className={`h-[50px] w-full rounded-xl items-center justify-center flex-row ${disabled ? 'bg-border' : 'bg-primary'} ${className}`}
    >
      {icon && <Ionicons name={icon} size={22} color={theme.colors.white} />}
      <Text className={`text-white text-[17px] font-semibold ${icon ? 'ml-2' : ''}`}>{title}</Text>
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
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.8}
      className={`h-11 rounded-xl items-center justify-center flex-row ${disabled ? 'bg-border' : 'bg-primary'} ${className}`}
    >
      {icon && <Ionicons name={icon} size={18} color={theme.colors.white} />}
      <Text className={`text-[17px] font-semibold ${disabled ? 'text-on-surface-variant' : 'text-white'} ${icon ? 'ml-2' : ''}`}>{title}</Text>
    </TouchableOpacity>
  );
}
