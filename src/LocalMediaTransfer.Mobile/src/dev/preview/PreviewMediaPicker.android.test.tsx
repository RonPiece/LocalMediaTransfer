import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { nativeCapabilities } from '@/services/NativeCapabilities';
import { PreviewMediaPicker } from './PreviewMediaPicker.android';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('@/services/NativeCapabilities', () => ({ nativeCapabilities: { pickMedia: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: React.PropsWithChildren) => children }));

it('uses the real Android review view with isolated Add and Remove callbacks', () => {
  const onTransfer = jest.fn();
  const screen = render(<PreviewMediaPicker id="media-selected" onTransfer={onTransfer} onClose={jest.fn()} />);
  expect(screen.getByText('12 items selected')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Remove Sample_001.MOV'));
  expect(screen.getByText('11 items selected')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Add media'));
  expect(screen.getByText('24 items selected')).toBeTruthy();
  expect(nativeCapabilities.pickMedia).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Transfer 24 items'));
  expect(onTransfer).toHaveBeenCalledTimes(1);
});
