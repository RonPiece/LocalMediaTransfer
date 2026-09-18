import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BottomTabBar } from './navigation';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

describe('BottomTabBar', () => {
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
