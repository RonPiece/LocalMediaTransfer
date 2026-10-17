import { AlbumPickerModal, albumGridColumns } from './AlbumPickerModal';
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('expo-image', () => ({ Image: () => null }));

it('uses one album column when width or text size needs it', () => {
  expect(albumGridColumns(390, 1)).toBe(2);
  expect(albumGridColumns(320, 1)).toBe(1);
  expect(albumGridColumns(390, 1.8)).toBe(1);
});

it('labels the selected album and the close control for assistive technology', () => {
  const screen = render(<AlbumPickerModal visible albums={[]} albumCovers={{}}
    onSelectAlbum={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByLabelText('Recents album').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('Close albums').props.accessibilityRole).toBe('button');
});
