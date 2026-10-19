import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

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

  it('discloses automatic streaming and keeps a quiet catch-up status in the transfer row', () => {
    const screen = render(<ConcurrentTransferProgress preparedAssets={20} totalAssets={300}
      processedFiles={2} hasUploadStarted automaticallyStreamsLargeSelection queueCatchUpVisible />);
    expect(screen.getByText('Transfer is catching up with prepared files.')).toBeTruthy();
    const details = screen.getByLabelText('Why transfer started while preparing media');
    expect(details.props.accessibilityState.expanded).toBe(false);
    fireEvent.press(details);
    expect(screen.getByText(/protect phone storage/)).toBeTruthy();
    expect(screen.getByLabelText('Why transfer started while preparing media').props.accessibilityState.expanded).toBe(true);
  });

  it('uses terminal files for the transfer bar and clamps counts above the total', () => {
    const screen = render(<ConcurrentTransferProgress preparedAssets={10} totalAssets={10} processedFiles={11} totalFiles={10} preparationComplete hasUploadStarted />);
    expect(screen.getByLabelText('File transfer progress').props.accessibilityValue.now).toBe(100);
    expect(screen.getByTestId('concurrent-file-progress')).toHaveStyle({ width: '100%' });
    screen.rerender(<ConcurrentTransferProgress preparedAssets={5} totalAssets={10} processedFiles={2} totalFiles={10} hasUploadStarted />);
    expect(screen.queryByLabelText('File transfer progress')).toBeNull();
    expect(screen.getByText('2 of 10 files completed')).toBeTruthy();
  });
});
