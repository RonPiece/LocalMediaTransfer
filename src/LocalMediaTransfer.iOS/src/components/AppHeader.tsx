import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/theme';

// iOS HIG navigation bar:
// - Left: back chevron (<) or "Cancel" text uses theme.colors.primary.
// - Center: title, 17px semibold, centered inside the bar.
// - Right: optional "Done" text uses theme.colors.primary unless overridden.

type CloseStyle = 'back' | 'cancel';

interface AppHeaderProps {
  title: string;
  showIcon?: boolean;
  onClose?: () => void;
  closeStyle?: CloseStyle;
  onDone?: () => void;
  doneText?: string;
  doneColor?: string;
}

export default function AppHeader({
  title,
  showIcon = false,
  onClose,
  closeStyle = 'cancel',
  onDone,
  doneText = 'Done',
  doneColor,
}: AppHeaderProps) {
  return (
    <View className="border-b-[0.5px] border-border h-[44px] flex-row items-center bg-surface">
      <View className="w-20 items-start pl-3">
        {onClose ? (
          closeStyle === 'back' ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="flex-row items-center"
            >
              <Ionicons name="chevron-back" size={22} color={theme.colors.primary} />
              <Text className="text-primary text-[17px]">Back</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text className="text-primary text-[17px]">Cancel</Text>
            </TouchableOpacity>
          )
        ) : showIcon ? (
          <Image
            source={require('../../assets/app-icon.png')}
            className="w-8 h-8 rounded-lg"
          />
        ) : null}
      </View>

      <Text
        numberOfLines={1}
        className="flex-1 text-center text-[17px] font-semibold text-on-surface"
      >
        {title}
      </Text>

      <View className="w-20 items-end pr-3">
        {onDone ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={doneText}
            onPress={onDone}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text className="text-[17px] font-semibold" style={{ color: doneColor || theme.colors.primary }}>{doneText}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
