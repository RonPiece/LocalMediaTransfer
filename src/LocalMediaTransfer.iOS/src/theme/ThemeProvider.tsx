import React from 'react';
import { Alert, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeWindStyleSheet } from 'nativewind';
import { storageKey } from '@/config/storageKeys';

export type AppearancePreference = 'system' | 'light' | 'dark';
export const ThemePreferenceContext = React.createContext<{
  preference: AppearancePreference;
  setPreference: (value: AppearancePreference) => void;
}>({ preference: 'system', setPreference: () => undefined });

export function applyAppearancePreference(value: AppearancePreference) {
  Appearance.setColorScheme(value === 'system' ? 'unspecified' : value);
  NativeWindStyleSheet.setColorScheme(value);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setValue] = React.useState<AppearancePreference>('system');
  const revision = React.useRef(0);
  const writes = React.useRef(Promise.resolve());
  const key = storageKey('lmt_appearance');
  React.useEffect(() => {
    let active = true;
    const initialRevision = revision.current;
    applyAppearancePreference('system');
    void AsyncStorage.getItem(key).then(value => {
      if (!active || revision.current !== initialRevision) return;
      if (value === 'light' || value === 'dark' || value === 'system') {
        applyAppearancePreference(value);
        setValue(value);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [key]);
  const setPreference = React.useCallback((value: AppearancePreference) => {
    revision.current++;
    applyAppearancePreference(value);
    setValue(value);
    // Serialize writes so rapid choices cannot persist in the wrong order.
    writes.current = writes.current.then(() => AsyncStorage.setItem(key, value)).catch(() => {
      Alert.alert('Appearance not saved', 'Your choice is active now, but could not be saved for next time.');
    });
  }, [key]);
  return <ThemePreferenceContext.Provider value={{ preference, setPreference }}>{children}</ThemePreferenceContext.Provider>;
}

export function useAppearancePreference() {
  return React.useContext(ThemePreferenceContext);
}
