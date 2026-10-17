import React from 'react';
import { KeyboardTypeOptions, Text, TextInput, View } from 'react-native';
import { useThemePalette } from '@/theme';

export function TextField({
  value,
  onChangeText,
  placeholder,
  label,
  hint,
  keyboardType = 'default',
  secureTextEntry = false,
  textSizeClass = 'text-[17px]',
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  label?: string;
  hint?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  textSizeClass?: string;
}) {
  const palette = useThemePalette();
  const input = (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      accessibilityLabel={label ?? placeholder}
      accessibilityHint={hint}
      placeholderTextColor={palette.inputPlaceholder}
      keyboardType={keyboardType}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secureTextEntry}
      className={`h-11 px-4 ${textSizeClass} text-on-surface dark:text-on-surface-dark`}
    />
  );
  if (!label) return input;
  return (
    <View>
      <Text className="text-[13px] font-semibold text-on-surface-variant dark:text-on-surface-variant-dark px-4 pt-3">{label}</Text>
      {input}
      {hint && <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark px-4 pb-2">{hint}</Text>}
    </View>
  );
}
