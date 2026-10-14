import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import MediaSelectionScreen from './MediaSelectionScreen';
import { nativeCapabilities } from '@/services/NativeCapabilities';

jest.mock('@/services/NativeCapabilities', () => ({
  nativeCapabilities: { pickMedia: jest.fn() },
}));

it('reviews picker grants and transfers only the items left after removal', async () => {
  const pickMedia = nativeCapabilities.pickMedia as jest.Mock;
  pickMedia.mockResolvedValueOnce([
    { id: 'content://test/1', nativeReference: 'content://test/1', uri: 'content://test/1', filename: 'first.jpg', type: 'photo', modificationTime: 0, width: 0, height: 0 },
    { id: 'content://test/2', nativeReference: 'content://test/2', uri: 'content://test/2', filename: 'second.mp4', type: 'video', modificationTime: 0, width: 0, height: 0 },
  ]).mockResolvedValueOnce([
    { id: 'content://test/2', nativeReference: 'content://test/2', uri: 'content://test/2', filename: 'second.mp4', type: 'video', modificationTime: 0, width: 0, height: 0 },
  ]);
  const onTransfer = jest.fn();
  const screen = render(<MediaSelectionScreen onTransfer={onTransfer} />);
  fireEvent.press(screen.getByText('Choose'));
  await waitFor(() => expect(screen.getByText('2 selected. Remove any item before transfer.')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Remove first.jpg'));
  fireEvent.press(screen.getByText('Add'));
  await waitFor(() => expect(pickMedia).toHaveBeenCalledTimes(2));
  fireEvent.press(screen.getByText('Transfer 1'));
  expect(onTransfer).toHaveBeenCalledWith([expect.objectContaining({ nativeReference: 'content://test/2' })]);
});
