import React from 'react';
import { KeyboardTypeOptions, TextInput } from 'react-native';
import { useThemePalette } from '@/theme';

export function TextField({
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  secureTextEntry = false,
  textSizeClass = 'text-[17px]',
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  textSizeClass?: string;
}) {
  const palette = useThemePalette();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.inputPlaceholder}
      keyboardType={keyboardType}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secureTextEntry}
      className={`h-11 px-4 ${textSizeClass} text-on-surface dark:text-on-surface-dark`}
    />
  );
}
