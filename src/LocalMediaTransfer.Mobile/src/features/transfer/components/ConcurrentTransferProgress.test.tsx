import React from 'react';
import { render } from '@testing-library/react-native';

import { ConcurrentTransferProgress } from './ConcurrentTransferProgress';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

describe('ConcurrentTransferProgress', () => {
  it('shows two stable phase rows without exposing the native window denominator', () => {
    const screen = render(
      <ConcurrentTransferProgress
        preparedAssets={208}
        totalAssets={1020}
        processedFiles={57}
      />,
    );

    expect(screen.getByText('Preparing media')).toBeTruthy();
    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.getByText('208 of 1,020 media items analyzed')).toBeTruthy();
    expect(screen.getByText('Transferring files')).toBeTruthy();
    expect(screen.getByText('57 files completed')).toBeTruthy();
    expect(screen.queryByText(/0 of 16/)).toBeNull();
    expect(screen.getByTestId('concurrent-preparation-progress')).toHaveStyle({ width: '20%' });
  });

  it('uses an active label before the first file completes and clamps preparation at 100 percent', () => {
    const screen = render(
      <ConcurrentTransferProgress
        preparedAssets={12}
        totalAssets={10}
        processedFiles={0}
      />,
    );

    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('10 of 10 media items analyzed')).toBeTruthy();
    expect(screen.getByText('Transfer active')).toBeTruthy();
  });
});
