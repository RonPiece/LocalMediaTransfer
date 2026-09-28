import React from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MainTab } from '@/app/types';
import { navigationAppearance, tabAppearance, toneAppearance, useReduceTransparencyEnabled, useThemeMode, useThemePalette } from '@/theme';
import type { Tone } from '@/theme';
import { IconName } from './types';

const tabs: {
  id: MainTab;
  label: string;
  icon: IconName;
  activeIcon: IconName;
}[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { id: 'transfers', label: 'Transfers', icon: 'swap-vertical-outline', activeIcon: 'swap-vertical' },
  { id: 'connect', label: 'Connect', icon: 'desktop-outline', activeIcon: 'desktop' },
  { id: 'history', label: 'History', icon: 'time-outline', activeIcon: 'time' },
  { id: 'settings', label: 'Settings', icon: 'settings-outline', activeIcon: 'settings' },
];

export function BottomTabBar({
  activeTab,
  onSelect,
  locked = false,
}: {
  activeTab: MainTab;
  onSelect: (tab: MainTab) => void;
  locked?: boolean;
}) {
  const palette = useThemePalette();
  const mode = useThemeMode();
  const reduceTransparency = useReduceTransparencyEnabled();
  const material = navigationAppearance(palette, mode, reduceTransparency);
  const content = (
    <SafeAreaView edges={['bottom']} className="border-t" style={{ borderTopColor: material.separator }}>
      {locked && (
        <View
          accessibilityRole="alert"
          className="h-7 flex-row items-center justify-center bg-primary-soft dark:bg-primary-soft-dark border-b border-separator dark:border-separator-dark px-3"
        >
          <Ionicons name="lock-closed" size={12} color={palette.primary} />
          <Text className="text-[10px] font-semibold text-primary dark:text-primary-dark ml-1.5">
            Transfer in progress · other tabs are temporarily unavailable
          </Text>
        </View>
      )}
      <View className="h-[58px] flex-row px-1">
        {tabs.map(tab => {
          const selected = tab.id === activeTab;
          const disabled = locked && !selected;
          const appearance = tabAppearance(palette, { selected, disabled });
          return (
            <TouchableOpacity
              key={tab.id}
              accessibilityRole="tab"
              accessibilityLabel={disabled ? `${tab.label}. Transfer in progress` : tab.label}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(tab.id)}
              activeOpacity={appearance.activeOpacity}
              className="flex-1 items-center justify-center"
              style={{ opacity: appearance.opacity }}
            >
              <Ionicons
                name={selected ? tab.activeIcon : tab.icon}
                size={23}
                color={appearance.foreground}
              />
              <Text
                className={`text-[10px] mt-0.5 ${selected ? 'font-semibold' : ''}`}
                style={{ color: appearance.foreground }}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );

  if (Platform.OS === 'ios' && !reduceTransparency) {
    return (
      <BlurView
        intensity={72}
        tint={material.tint}
        style={{ backgroundColor: material.background }}
      >
        {content}
      </BlurView>
    );
  }
  return <View style={{ backgroundColor: reduceTransparency ? material.background : palette.surface }}>{content}</View>;
}

export function ScreenHeader({
  title,
  subtitle,
  icon,
  trailing,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  trailing?: React.ReactNode;
}) {
  const palette = useThemePalette();
  return (
    <View className="px-5 pt-4 pb-3 bg-background dark:bg-background-dark">
      <View className="flex-row items-start">
        {icon && (
          <View className="w-11 h-11 rounded-[13px] bg-primary-soft dark:bg-primary-soft-dark items-center justify-center mr-3">
            <Ionicons name={icon} size={25} color={palette.primary} />
          </View>
        )}
        <View className="flex-1 min-w-0">
          <Text accessibilityRole="header" className="text-[32px] leading-[38px] font-bold text-on-surface dark:text-on-surface-dark">
            {title}
          </Text>
          {subtitle && (
            <Text className="text-[16px] leading-[21px] text-on-surface-variant dark:text-on-surface-variant-dark mt-0.5">
              {subtitle}
            </Text>
          )}
        </View>
        {trailing}
      </View>
    </View>
  );
}

export function StatusBadge({
  label,
  tone,
  icon,
  compact = false,
}: {
  label: string;
  tone: Tone;
  icon?: IconName;
  compact?: boolean;
}) {
  const palette = useThemePalette();
  const appearance = toneAppearance(palette, tone);
  return (
    <View className="self-start rounded-full px-2.5 py-1 flex-row items-center" style={{ backgroundColor: appearance.background }}>
      {icon && <Ionicons name={icon} size={13} color={appearance.foreground} />}
      <Text className={`text-[12px] font-semibold ${icon ? 'ml-1' : ''}`} style={{ color: appearance.foreground, ...(compact ? { fontSize: 10 } : {}) }}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  const palette = useThemePalette();
  return (
    <View className="rounded-[22px] bg-surface dark:bg-surface-dark border border-border dark:border-border-dark px-6 py-8 items-center">
      <View className="w-14 h-14 rounded-2xl bg-primary-soft dark:bg-primary-soft-dark items-center justify-center">
        <Ionicons name={icon} size={29} color={palette.primary} />
      </View>
      <Text className="text-[18px] font-bold text-on-surface dark:text-on-surface-dark mt-4 text-center">{title}</Text>
      <Text className="text-[14px] leading-5 text-on-surface-variant dark:text-on-surface-variant-dark mt-1.5 text-center">{message}</Text>
      {action && <View className="w-full mt-5">{action}</View>}
    </View>
  );
}
