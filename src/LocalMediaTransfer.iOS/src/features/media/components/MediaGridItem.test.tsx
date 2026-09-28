import React from 'react';
import * as ReactNative from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MediaGridItem } from './MediaGridItem';
import type { SelectionStore } from '../hooks/useMediaSelection';
import tokens from '@/theme/tokens.json';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/services/MediaScanner', () => ({ mediaScanner: { formatDuration: () => '0:30' } }));
const item = { id: 'fixture', filename: 'fixture', uri: 'file://fixture', type: 'photo' as const, modificationTime: 0, width: 100, height: 100 };

describe.each(['light', 'dark'] as const)('%s thumbnail selection', mode => {
 afterEach(() => jest.restoreAllMocks());
 it('uses full-image dimming, an accent border and a filled high-contrast badge', () => {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
  const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
  let selected = false;
  let notify = () => {};
  const store = { isSelected: () => selected, subscribe: (_id: string, listener: () => void) => { notify = listener; return () => {}; } } as unknown as SelectionStore;
  const onToggle = jest.fn();
  const screen = render(<MediaGridItem item={item} itemSize={120} itemMargin={1} selectionStore={store} suppressNextPress={{ current: false }} onToggleSelection={onToggle} />);
  expect(screen.getByRole('button').props.accessibilityState.selected).toBe(false);
  expect(screen.queryByTestId('media-selection-overlay')).toBeNull();
  expect(screen.getByTestId('media-selection-badge')).toHaveStyle({ width: 26, height: 26, borderColor: palette.white, backgroundColor: 'rgba(0,0,0,0.45)' });
  act(() => { selected = true; notify(); });
  expect(screen.getByRole('button').props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('media-selection-overlay')).toHaveStyle({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 3, borderColor: palette.primary, backgroundColor: 'rgba(0,0,0,0.35)' });
  expect(screen.getByTestId('media-selection-badge')).toHaveStyle({ position: 'absolute', top: 8, right: 8, backgroundColor: palette.primaryFill, borderColor: palette.white });
  fireEvent.press(screen.getByRole('button'));
  expect(onToggle).toHaveBeenCalledWith(item.id);
  act(() => { selected = false; notify(); });
  expect(screen.queryByTestId('media-selection-overlay')).toBeNull();
 });
 it('preserves the drag gesture suppression of a subsequent tap', () => {
  const onToggle = jest.fn();
  const suppressNextPress = { current: true };
  const store = { isSelected: () => true, subscribe: () => () => {} } as unknown as SelectionStore;
  const screen = render(<MediaGridItem item={item} itemSize={120} itemMargin={1} selectionStore={store} suppressNextPress={suppressNextPress} onToggleSelection={onToggle} />);
  fireEvent.press(screen.getByRole('button'));
  expect(onToggle).not.toHaveBeenCalled();
  expect(suppressNextPress.current).toBe(false);
 });
});
