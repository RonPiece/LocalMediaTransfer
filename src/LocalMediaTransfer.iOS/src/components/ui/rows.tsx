import React from 'react';
import { Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useThemePalette } from '@/theme';
import { HelpButton } from './buttons';
import { IconName } from './types';

export function IconTile({
  icon,
  danger = false,
}: {
  icon: IconName;
  danger?: boolean;
}) {
  const palette = useThemePalette();
  return (
    <View
      className="w-9 h-9 rounded-lg items-center justify-center mr-3"
      style={{ backgroundColor: danger ? palette.errorSoft : palette.primarySoft }}
    >
      <Ionicons name={icon} size={20} color={danger ? palette.error : palette.primary} />
    </View>
  );
}

export function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  danger = false,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const palette = useThemePalette();
  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress();
  };
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={handlePress}
      activeOpacity={0.7}
      className="bg-surface dark:bg-surface-dark rounded-xl px-4 py-3 flex-row items-center mb-0.5"
    >
      <IconTile icon={icon} danger={danger} />
      <View className="flex-1">
        <Text onPress={handlePress} className={`text-[17px] ${danger ? 'text-error dark:text-error-dark' : 'text-on-surface dark:text-on-surface-dark'}`}>{title}</Text>
        <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark mt-[1px]">{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={palette.onSurfaceVariant} />
    </TouchableOpacity>
  );
}

export function SettingRow({
  title,
  detail,
  value,
  onChange,
  disabled = false,
  onInfo,
  infoLabel,
  danger = false,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  onInfo?: () => void;
  infoLabel?: string;
  danger?: boolean;
}) {
  const palette = useThemePalette();
  return (
    <View className={`p-4 flex-row items-center ${disabled ? 'opacity-40' : 'opacity-100'}`}>
      <View className="flex-1 mr-3">
        <View className="flex-row items-center">
          <Text className="text-[17px] text-on-surface dark:text-on-surface-dark">{title}</Text>
          {onInfo && <HelpButton label={infoLabel || `Explain ${title}`} onPress={onInfo} />}
        </View>
        <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark leading-[18px] mt-0.5">{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={detail}
        disabled={disabled}
        value={value}
        onValueChange={(v) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          onChange(v);
        }}
        trackColor={{ false: palette.switchOffTrack, true: danger ? palette.error : palette.success }}
        thumbColor={palette.white}
        ios_backgroundColor={palette.switchOffTrack}
      />
    </View>
  );
}
