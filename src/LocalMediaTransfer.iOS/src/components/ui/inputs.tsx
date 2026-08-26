import React from 'react';
import { KeyboardTypeOptions, TextInput } from 'react-native';
import { theme } from '@/theme';

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
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.inputPlaceholder}
      keyboardType={keyboardType}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secureTextEntry}
      className={`h-11 px-4 ${textSizeClass} text-on-surface`}
    />
  );
}
