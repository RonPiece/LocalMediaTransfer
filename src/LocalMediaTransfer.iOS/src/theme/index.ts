import tokens from './tokens.json';
import { useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export const theme = tokens;

export type ThemePalette = typeof tokens.colors;

export function useThemeMode(): 'light' | 'dark' {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function useThemePalette(): ThemePalette {
  return useThemeMode() === 'dark' ? tokens.darkColors : tokens.colors;
}

export function useReduceMotionEnabled(): boolean {
  return useReducedMotion();
}
