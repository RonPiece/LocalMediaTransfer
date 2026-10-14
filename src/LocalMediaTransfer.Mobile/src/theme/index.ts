import tokens from './tokens.json';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
import { useEffect, useState } from 'react';
import { useAppearancePreference } from './ThemeProvider';
import { useReducedMotion } from 'react-native-reanimated';
export { ThemeProvider, useAppearancePreference } from './ThemeProvider';
export type { AppearancePreference } from './ThemeProvider';

export const theme = tokens;

export type ThemePalette = typeof tokens.colors;

export function useThemeMode(): 'light' | 'dark' {
  const system = useColorScheme();
  const { preference } = useAppearancePreference();
  return preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
}

export function useThemePalette(): ThemePalette {
  return useThemeMode() === 'dark' ? tokens.darkColors : tokens.colors;
}

export function useReduceMotionEnabled(): boolean {
  return useReducedMotion();
}

export * from './appearance';

export function useReduceTransparencyEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    let receivedEvent = false;
    const update = (value: boolean) => {
      receivedEvent = true;
      if (active) setEnabled(value);
    };
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', update);
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => {
      // A delayed initial query must not overwrite a newer accessibility event.
      if (active && !receivedEvent) setEnabled(value);
    }).catch(() => undefined);
    return () => { active = false; subscription.remove(); };
  }, []);
  return enabled;
}
