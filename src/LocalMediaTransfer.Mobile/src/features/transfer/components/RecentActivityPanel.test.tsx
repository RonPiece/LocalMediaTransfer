import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { RecentActivityPanel, recentActivityPreviewCount } from './RecentActivityPanel';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

describe('RecentActivityPanel', () => {
  const items = [
    { id: '1', filename: 'first.jpg', status: 'uploading' as const },
    { id: '2', filename: 'second.jpg', status: 'success' as const },
    { id: '3', filename: 'third.jpg', status: 'error' as const, msg: 'Could not prepare.' },
  ];

  it('shows a compact preview and opens an upward, scrollable activity sheet', () => {
    const screen = render(<RecentActivityPanel items={items} compact={false} />);

    expect(screen.getByText('first.jpg')).toBeTruthy();
    expect(screen.queryByText('third.jpg')).toBeNull();

    fireEvent.press(screen.getByLabelText('Recent activity, 3 recent items. Open full list'));
    expect(screen.getByText('3 most recent items')).toBeTruthy();
    expect(screen.getByText('third.jpg')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Collapse recent activity'));
    expect(screen.queryByText('3 most recent items')).toBeNull();
  });

  it('uses one preview row on compact screens or enlarged text', () => {
    expect(recentActivityPreviewCount(false, 1)).toBe(2);
    expect(recentActivityPreviewCount(true, 1)).toBe(1);
    expect(recentActivityPreviewCount(false, 2)).toBe(1);
  });
});
