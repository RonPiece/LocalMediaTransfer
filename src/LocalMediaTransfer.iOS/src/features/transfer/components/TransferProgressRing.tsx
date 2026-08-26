import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { theme } from '@/theme';

type TransferProgressRingProps = {
  size: number;
  isFinished: boolean;
  finalColor: string;
  completedItems: number;
  totalItems: number;
  unit: 'assets' | 'files';
  phaseLabel: string;
  compactHeight?: boolean;
};

export function TransferProgressRing({
  size,
  isFinished,
  finalColor,
  completedItems,
  totalItems,
  unit,
  phaseLabel,
  compactHeight = false,
}: TransferProgressRingProps) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const clampedCompletedItems = totalItems > 0
    ? Math.max(0, Math.min(completedItems, totalItems))
    : Math.max(0, completedItems);
  const progressPercent = totalItems > 0
    ? Math.max(0, Math.min(100, (clampedCompletedItems / totalItems) * 100))
    : 0;
  const strokeDashoffset = isFinished
    ? 0
    : Math.max(0, circumference - (progressPercent / 100) * circumference);
  const countText = `${clampedCompletedItems.toLocaleString()} / ${totalItems.toLocaleString()}`;
  const countFontSize = size < 200 ? 14 : 16;

  return (
    <View className={compactHeight ? 'items-center mb-3' : 'items-center mb-6'}>
      <View
        testID="transfer-progress-ring"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={phaseLabel}
        accessibilityValue={{ min: 0, max: Math.max(0, totalItems), now: clampedCompletedItems }}
        className="relative items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.surface,
        }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle stroke={theme.colors.progressTrack} fill="transparent" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
          <Circle
            stroke={isFinished ? finalColor : theme.colors.success}
            fill="transparent"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View
          className="absolute items-center justify-center"
          style={{ width: Math.max(0, size - strokeWidth * 5) }}
        >
          <Text className="text-on-surface-variant text-[11px] font-semibold mb-1" numberOfLines={1}>
            {phaseLabel}
          </Text>
          <Text className="text-on-surface text-4xl font-bold tracking-tighter">
            {isFinished ? '100' : Math.floor(progressPercent)}%
          </Text>
          <Text
            testID="transfer-progress-count"
            className="text-on-surface-variant font-mono mt-1 text-center"
            style={{
              fontSize: countFontSize,
              lineHeight: countFontSize + 3,
              fontVariant: ['tabular-nums'],
            }}
            numberOfLines={1}
          >
            {countText}
          </Text>
          <Text
            testID="transfer-progress-unit"
            className="text-on-surface-variant text-[11px] font-semibold leading-4 text-center"
          >
            {unit}
          </Text>
        </View>
      </View>
    </View>
  );
}
