import React from 'react';
import * as ReactNative from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ControlGroup, GroupAction, SegmentedControl, groupedControlMetrics, controlTransitionConfig } from './controls';
import tokens from '@/theme/tokens.json';
import * as Reanimated from 'react-native-reanimated';
import { segmentAppearance, useReduceMotionEnabled } from '@/theme';
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'), useReduceMotionEnabled: jest.fn(() => false) }));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
describe.each(['light', 'dark'] as const)('%s grouped controls', mode => {
  afterEach(() => { jest.restoreAllMocks(); jest.mocked(useReduceMotionEnabled).mockReturnValue(false); });
  it('keeps action backgrounds present through pressed and disabled states', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
    const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
    const onPress = jest.fn();
    const screen = render(<ControlGroup><GroupAction label="Refresh" icon="refresh" onPress={onPress} />
      <GroupAction label="Disconnect" icon="power-outline" destructive disabled onPress={onPress} /></ControlGroup>);
    const action = screen.getByRole('button', { name: 'Refresh' });
    expect(action).toHaveStyle({ backgroundColor: palette.primarySoft });
    fireEvent(action, 'pressIn');
    expect(action).toHaveStyle({ backgroundColor: palette.primarySoft });
    fireEvent(action, 'pressOut');
    fireEvent.press(action);
    expect(onPress).toHaveBeenCalledTimes(1);
    const disabled = screen.getByRole('button', { name: 'Disconnect' });
    expect(disabled).toHaveStyle({ backgroundColor: palette.disabledFill });
    fireEvent.press(disabled);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('preserves selection during presses and exposes scrollable options', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
    const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
    const onChange = jest.fn();
    const screen = render(<SegmentedControl label="Filter" scrollable value="all" onChange={onChange}
      options={[{ value: 'all', label: 'All' }, { value: 'skipped', label: 'Skipped' }, { value: 'locked', label: 'Unavailable', disabled: true }]} />);
    const all = screen.getByRole('button', { name: 'All' });
    expect(all.props.accessibilityState.selected).toBe(true);
    expect(all).toHaveStyle({ backgroundColor: palette.primarySoft });
    fireEvent(all, 'pressIn');
    expect(all).toHaveStyle({ backgroundColor: palette.primarySoft });
    expect(screen.getByLabelText('Filter')).toHaveStyle({ backgroundColor: palette.elevatedSurface });
    fireEvent.press(screen.getByRole('button', { name: 'Skipped' }));
    expect(onChange).toHaveBeenCalledWith('skipped');
    fireEvent.press(screen.getByRole('button', { name: 'Unavailable' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(segmentAppearance(palette, { selected: true, pressed: true, disabled: true })).toMatchObject({ backgroundColor: palette.disabledFill, foreground: palette.onSurfaceVariant });
  });
});

it('shares pill geometry and keeps labeled actions the same width while busy', () => {
 const screen = render(<GroupAction label="Refresh" icon="refresh" onPress={jest.fn()} />);
 const action = () => screen.getByRole('button');
 expect(action()).toHaveStyle({ width: 104, minHeight: groupedControlMetrics.height, borderRadius: groupedControlMetrics.radius });
 screen.rerender(<GroupAction label="Searching…" icon="refresh" busy disabled onPress={jest.fn()} />);
 expect(action()).toHaveStyle({ width: 104, minHeight: 36, borderRadius: 999 });
 expect(action().props.hitSlop).toEqual({ top: 4, bottom: 4 });
 screen.unmount();
 const segments = render(<SegmentedControl label="History filters" value="all" onChange={jest.fn()} options={[{ value: 'all', label: 'All' }, { value: 'skipped', label: 'Skipped' }]} />);
 expect(segments.getByRole('button', { name: 'All' })).toHaveStyle({ minHeight: groupedControlMetrics.height, borderRadius: groupedControlMetrics.radius });
});

describe.each(['light', 'dark'] as const)('%s control transitions', mode => {
 afterEach(() => { jest.restoreAllMocks(); jest.mocked(useReduceMotionEnabled).mockReturnValue(false); });
 it('moves the highlight to the measured selection without changing the selected handler', async () => {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
  const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
  const options = [{ value: 'all', label: 'All' }, { value: 'failed', label: 'Failed' }, { value: 'locked', label: 'Unavailable', disabled: true }];
  const onChange = jest.fn();
  const screen = render(<SegmentedControl label="History" options={options} value="all" onChange={onChange} />);
  for (const [index, label] of ['All', 'Failed', 'Unavailable'].entries()) {
   fireEvent(screen.getByRole('button', { name: label }), 'layout', { nativeEvent: { layout: { x: 4 + index * 90, y: 4, width: 86, height: 36 } } });
  }
  expect(screen.getByTestId('segment-selection-indicator')).toHaveStyle({ width: 86, height: 36, backgroundColor: palette.primarySoft, transform: [{ translateX: 4 }, { translateY: 4 }] });
  fireEvent.press(screen.getByRole('button', { name: 'Failed' }));
  expect(onChange).toHaveBeenCalledWith('failed');
  screen.rerender(<SegmentedControl label="History" options={options} value="failed" onChange={onChange} />);
  await waitFor(() => expect(screen.getByTestId('segment-selection-indicator')).toHaveAnimatedStyle({ transform: [{ translateX: 94 }, { translateY: 4 }] }));
  expect(screen.getByRole('button', { name: 'Failed' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: 'Unavailable' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent(screen.getByRole('button', { name: 'Failed' }), 'layout', { nativeEvent: { layout: { x: 110, y: 4, width: 106, height: 48 } } });
  await waitFor(() => expect(screen.getByTestId('segment-selection-indicator')).toHaveAnimatedStyle({ width: 106, height: 48, transform: [{ translateX: 110 }, { translateY: 4 }] }));
 });
 it('snaps with Reduce Motion and clears stale press feedback when disabled', async () => {
  jest.mocked(useReduceMotionEnabled).mockReturnValue(true);
  const screen = render(<GroupAction label="Refresh" icon="refresh" onPress={jest.fn()} />);
  fireEvent(screen.getByRole('button'), 'pressIn');
  expect(controlTransitionConfig(true)).toMatchObject({ duration: 0, reduceMotion: Reanimated.ReduceMotion.System });
  await waitFor(() => expect(screen.getByRole('button')).toHaveAnimatedStyle({ opacity: 0.8 }));
  screen.rerender(<GroupAction label="Refresh" icon="refresh" disabled onPress={jest.fn()} />);
  screen.rerender(<GroupAction label="Refresh" icon="refresh" onPress={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('button')).toHaveAnimatedStyle({ opacity: 1 }));
  expect(controlTransitionConfig(false).duration).toBe(180);
 });
});
