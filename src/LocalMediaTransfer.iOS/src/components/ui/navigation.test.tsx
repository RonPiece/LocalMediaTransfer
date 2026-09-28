import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as theme from '@/theme';
import tokens from '@/theme/tokens.json';

import { BottomTabBar } from './navigation';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

describe('BottomTabBar', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['light', 'dark'] as const)('uses solid %s navigation when transparency is reduced', mode => {
    const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
    jest.spyOn(theme, 'useThemeMode').mockReturnValue(mode);
    jest.spyOn(theme, 'useThemePalette').mockReturnValue(palette);
    jest.spyOn(theme, 'useReduceTransparencyEnabled').mockReturnValue(true);
    const screen = render(<BottomTabBar activeTab="home" onSelect={jest.fn()} />);
    expect(screen.UNSAFE_queryByType(BlurView)).toBeNull();
    expect(screen.UNSAFE_getAllByType(View).some(view =>
      StyleSheet.flatten(view.props.style)?.backgroundColor === palette.elevatedSurface,
    )).toBe(true);
    screen.unmount();
  });

  it('exposes all five tabs and selects an unlocked tab', () => {
    const onSelect = jest.fn();
    const screen = render(<BottomTabBar activeTab="connect" onSelect={onSelect} />);

    for (const label of ['Home', 'Transfers', 'Connect', 'History', 'Settings']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText('Connect').props.accessibilityState).toEqual({ selected: true, disabled: false });

    fireEvent.press(screen.getByLabelText('History'));
    expect(onSelect).toHaveBeenCalledWith('history');
  });

  it('keeps Transfers selected and disables every other tab during a transfer', () => {
    const onSelect = jest.fn();
    const screen = render(<BottomTabBar activeTab="transfers" onSelect={onSelect} locked />);

    expect(screen.getByText('Transfer in progress · other tabs are temporarily unavailable')).toBeTruthy();
    expect(screen.getByLabelText('Transfers').props.accessibilityState).toEqual({ selected: true, disabled: false });
    const lockedHome = screen.getByLabelText('Home. Transfer in progress');
    expect(lockedHome.props.accessibilityState).toEqual({ selected: false, disabled: true });
    fireEvent.press(lockedHome);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
