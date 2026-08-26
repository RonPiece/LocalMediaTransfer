import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/theme';
import { IconName } from './types';

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <View className={`bg-surface rounded-xl overflow-hidden ${className}`}>{children}</View>;
}

export function Divider({ inset = true, className = '' }: { inset?: boolean; className?: string }) {
  return <View className={`h-[0.5px] bg-border ${inset ? 'ml-4' : ''} ${className}`} />;
}

export function InlineBanner({
  icon,
  title,
  message,
  tone = 'info',
  className = '',
}: {
  icon: IconName;
  title: string;
  message: string;
  tone?: 'info' | 'warning' | 'error';
  className?: string;
}) {
  const color = tone === 'error' ? theme.colors.error : tone === 'warning' ? theme.colors.warning : theme.colors.primary;
  const backgroundColor = tone === 'error' ? theme.colors.errorSoft : tone === 'warning' ? theme.colors.warningSoft : theme.colors.primarySoft;
  const borderColor = tone === 'error' ? theme.colors.error : tone === 'warning' ? theme.colors.warning : theme.colors.primary;
  return (
    <View
      className={`rounded-xl p-4 flex-row items-center border ${className}`}
      style={{ backgroundColor, borderColor }}
    >
      <Ionicons name={icon} size={22} color={color} />
      <View className="ml-3 flex-1">
        <Text className="text-on-surface font-semibold">{title}</Text>
        <Text className="text-on-surface-variant mt-1 leading-5">{message}</Text>
      </View>
    </View>
  );
}

export function SectionLabel({
  children,
  className = 'mb-2 px-1',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Text className={`text-[13px] font-semibold text-on-surface-variant uppercase tracking-wide ${className}`}>
      {children}
    </Text>
  );
}
