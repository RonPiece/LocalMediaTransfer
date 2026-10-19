import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { BackButton } from './ui/BackButton';
import { useThemePalette } from '@/theme';

// iOS HIG navigation bar:
// - Left: back chevron (<) or "Cancel" text uses theme.colors.primary.
// - Center: title, 17px semibold, centered inside the bar.
// - Right: optional "Done" text uses theme.colors.primary unless overridden.

type CloseStyle = 'back' | 'cancel';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  backLabel?: string;
  showIcon?: boolean;
  onClose?: () => void;
  closeStyle?: CloseStyle;
  onDone?: () => void;
  doneText?: string;
  doneColor?: string;
}

export default function AppHeader({
  title,
  subtitle,
  backLabel,
  showIcon = false,
  onClose,
  closeStyle = 'cancel',
  onDone,
  doneText = 'Done',
  doneColor,
}: AppHeaderProps) {
  const palette = useThemePalette();
  return (
    <View className="border-b-[0.5px] border-border dark:border-border-dark min-h-[48px] py-1 flex-row items-center bg-surface dark:bg-surface-dark">
      <View className="w-20 items-start pl-3">
        {onClose ? (
          closeStyle === 'back' ? (
            <BackButton onPress={onClose} accessibilityLabel={backLabel} />
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text className="text-primary dark:text-primary-dark text-[17px]">Cancel</Text>
            </TouchableOpacity>
          )
        ) : showIcon ? (
          <Image
            source={require('../../assets/app-icon.png')}
            className="w-8 h-8 rounded-lg"
          />
        ) : null}
      </View>

      <View className="flex-1 py-1">
        <Text accessibilityRole="header" className="text-center text-[17px] font-semibold text-on-surface dark:text-on-surface-dark">{title}</Text>
        {subtitle && <Text className="text-center text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-0.5">{subtitle}</Text>}
      </View>

      <View className="w-20 items-end pr-3">
        {onDone ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={doneText}
            onPress={onDone}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text className="text-[17px] font-semibold" style={{ color: doneColor || palette.primary }}>{doneText}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
