import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import MediaSelectionScreen, { mediaReviewColumns } from './MediaSelectionScreen';
import { nativeCapabilities } from '@/services/NativeCapabilities';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('@/services/NativeCapabilities', () => ({
  nativeCapabilities: { pickMedia: jest.fn() },
}));

it('adapts the media review grid to width and text scale', () => {
  expect(mediaReviewColumns(480, 1)).toBe(3);
  expect(mediaReviewColumns(390, 1)).toBe(2);
  expect(mediaReviewColumns(320, 1)).toBe(1);
  expect(mediaReviewColumns(480, 2)).toBe(1);
});

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
  expect(screen.getByText('Choose photos and videos')).toBeTruthy();
  fireEvent.press(screen.getByText('Choose media'));
  await waitFor(() => expect(screen.getByText('2 items selected')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Remove first.jpg'));
  fireEvent.press(screen.getByLabelText('Add media'));
  await waitFor(() => expect(pickMedia).toHaveBeenCalledTimes(2));
  fireEvent.press(screen.getByText('Transfer 1 item'));
  expect(onTransfer).toHaveBeenCalledWith([expect.objectContaining({ nativeReference: 'content://test/2' })]);
});
