import tokens from './tokens.json';
import { useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export const theme = tokens;

export type ThemePalette = typeof tokens.colors;

export function useThemePalette(): ThemePalette {
  return useColorScheme() === 'dark' ? tokens.darkColors : tokens.colors;
}

export function useReduceMotionEnabled(): boolean {
  return useReducedMotion();
}
