import React from 'react';
import * as ReactNative from 'react-native';
import { render } from '@testing-library/react-native';
import tokens from '@/theme/tokens.json';
import { DuplicateSkipMarker } from './DuplicateSkipMarker';

describe.each(['light', 'dark'] as const)('%s duplicate marker', mode => {
 afterEach(() => jest.restoreAllMocks());
 it('highlights duplicate skips with the warning background and text', () => {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
  const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
  const screen = render(<DuplicateSkipMarker uploaded={1} skipped={2} />);
  expect(screen.getByTestId('duplicate-skip-marker')).toHaveStyle({ backgroundColor: palette.warningSoft });
  expect(screen.getByText('2 duplicates skipped')).toHaveStyle({ color: palette.warning });
 });
 it('does not add a duplicate marker to successful-only or all-skipped sessions', () => {
  const screen = render(<DuplicateSkipMarker uploaded={1} />);
  expect(screen.queryByTestId('duplicate-skip-marker')).toBeNull();
  screen.rerender(<DuplicateSkipMarker uploaded={0} skipped={2} />);
  expect(screen.queryByTestId('duplicate-skip-marker')).toBeNull();
 });
});
