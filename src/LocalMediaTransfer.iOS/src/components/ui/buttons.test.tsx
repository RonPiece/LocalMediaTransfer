import React from 'react';
import * as ReactNative from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import tokens from '@/theme/tokens.json';
import { PrimaryButton, SecondaryButton } from './buttons';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });

describe.each(['light', 'dark'] as const)('%s shared action states', mode => {
  afterEach(() => jest.restoreAllMocks());
  it('distinguishes filled primary and tinted secondary actions', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
    const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
    const onPress = jest.fn();
    const primary = render(<PrimaryButton title="Primary" onPress={onPress} />);
    expect(primary.getByRole('button')).toHaveStyle({ backgroundColor: palette.primaryFill });
    expect(primary.getByText('Primary')).toHaveStyle({ color: palette.onPrimary });
    fireEvent.press(primary.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    primary.unmount();
    const secondary = render(<SecondaryButton title="Secondary" onPress={onPress} />);
    expect(secondary.getByRole('button')).toHaveStyle({ backgroundColor: palette.primarySoft });
    expect(secondary.getByText('Secondary')).toHaveStyle({ color: palette.primary });
    secondary.unmount();
  });
  it.each([PrimaryButton, SecondaryButton])('keeps disabled actions readable and blocks their handler', Button => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
    const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
    const onPress = jest.fn();
    const view = render(<Button title="Unavailable" onPress={onPress} disabled />);
    expect(view.getByRole('button')).toHaveStyle({ backgroundColor: palette.disabledFill });
    expect(view.getByText('Unavailable')).toHaveStyle({ color: palette.onSurfaceVariant });
    fireEvent.press(view.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    view.unmount();
  });
});
