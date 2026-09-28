import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeWindStyleSheet } from 'nativewind';
import { ThemeProvider, useAppearancePreference } from './ThemeProvider';
import { useThemeMode } from './index';

const wrapper = ({ children }: { children: React.ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
  jest.spyOn(NativeWindStyleSheet, 'setColorScheme');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); NativeWindStyleSheet.setColorScheme('system'); });
it('synchronizes native appearance, classes and palette and restores System', async () => {
  const { result } = renderHook(() => ({ ...useAppearancePreference(), mode: useThemeMode() }), { wrapper });
  act(() => result.current.setPreference('dark'));
  expect(result.current.mode).toBe('dark');
  expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('dark');
  expect(NativeWindStyleSheet.setColorScheme).toHaveBeenLastCalledWith('dark');
  act(() => result.current.setPreference('light'));
  expect(result.current.mode).toBe('light');
  act(() => result.current.setPreference('system'));
  expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified');
  expect(NativeWindStyleSheet.setColorScheme).toHaveBeenLastCalledWith('system');
  await waitFor(async () => expect(await AsyncStorage.getItem('lmt_appearance')).toBe('system'));
});
it('hydrates saved appearance and ignores a late initial read after a user choice', async () => {
  let resolveRead!: (value: string) => void;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
  const { result } = renderHook(useAppearancePreference, { wrapper });
  act(() => result.current.setPreference('dark'));
  await act(async () => { resolveRead('light'); });
  expect(result.current.preference).toBe('dark');
});
it('restores a saved choice after remount', async () => {
  await AsyncStorage.setItem('lmt_appearance', 'dark');
  const { result } = renderHook(useAppearancePreference, { wrapper });
  await waitFor(() => expect(result.current.preference).toBe('dark'));
});
it('retains the session choice when persistence fails', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('unavailable'));
  const { result } = renderHook(useAppearancePreference, { wrapper });
  act(() => result.current.setPreference('light'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Appearance not saved', expect.any(String)));
  expect(result.current.preference).toBe('light');
});
