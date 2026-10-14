import React from 'react';
import { Text, View } from 'react-native';
import { toneAppearance, useThemePalette } from '@/theme';

export function DuplicateSkipMarker({ uploaded = 0, skipped = 0 }: { uploaded?: number; skipped?: number }) {
  const palette = useThemePalette();
  if (uploaded <= 0 || skipped <= 0) return null;
  const appearance = toneAppearance(palette, 'warning');
  return <View testID="duplicate-skip-marker" style={{ alignSelf: 'flex-start', maxWidth: '100%', marginTop: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: appearance.background }}>
    <Text style={{ color: appearance.foreground, fontSize: 11, fontWeight: '600' }}>{skipped.toLocaleString()} {skipped === 1 ? 'duplicate' : 'duplicates'} skipped</Text>
  </View>;
}
