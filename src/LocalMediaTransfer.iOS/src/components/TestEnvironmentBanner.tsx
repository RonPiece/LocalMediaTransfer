import React from 'react';
import { Text, View } from 'react-native';

import { expectedServerEnvironment } from '@/services/NativeCapabilities';

export function TestEnvironmentBanner() {
  if (expectedServerEnvironment() !== 'test') {
    return null;
  }

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="TEST environment"
      className="bg-amber-500 px-3 py-1.5 items-center"
    >
      <Text className="text-black text-xs font-bold tracking-wider">
        TEST ENVIRONMENT
      </Text>
    </View>
  );
}
