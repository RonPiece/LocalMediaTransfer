import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { shouldUseCompactStatsLayout, TransferStatsBar } from './TransferStatsBar';

describe('TransferStatsBar', () => {
  it('uses three columns on normal phones and divided rows on narrow or enlarged-text layouts', () => {
    expect(shouldUseCompactStatsLayout(327, 1)).toBe(false);
    expect(shouldUseCompactStatsLayout(254, 1)).toBe(true);
    expect(shouldUseCompactStatsLayout(364, 1)).toBe(false);
    expect(shouldUseCompactStatsLayout(702, 1)).toBe(false);
    expect(shouldUseCompactStatsLayout(702, 1.5)).toBe(true);
  });

  it('moves time left to a full-width row on narrow cards without ellipsizing it', () => {
    const screen = render(
      <TransferStatsBar
        itemsRemaining={171}
        remainingLabel="Files left"
        currentMediaMBps={32.1}
        timeLabel="Elapsed"
        timeText="2m 14s"
        timeHint="Final transfer size is still being determined."
      />,
    );
    fireEvent(screen.getByTestId('transfer-stats-content'), 'layout', {
      nativeEvent: { layout: { width: 254, height: 140, x: 0, y: 0 } },
    });

    expect(screen.getByTestId('transfer-eta-compact')).toBeTruthy();
    expect(screen.getByText('2m 14s').props.numberOfLines).toBeUndefined();
    expect(screen.getByText('Final transfer size is still being determined.')).toBeTruthy();
  });

  it('shows remaining files, transferred bytes, live speed, and time without duplicating ring progress', () => {
    const screen = render(
      <TransferStatsBar
        itemsRemaining={188}
        remainingLabel="Files left"
        transferredBytes={821_300_000}
        currentMediaMBps={42.9}
        timeLabel="Time remaining"
        timeText="About 40s"
      />,
    );

    expect(screen.getByText('188')).toBeTruthy();
    expect(screen.getByText('Transferred')).toBeTruthy();
    expect(screen.getByText('821.3 MB')).toBeTruthy();
    expect(screen.getByText('Speed')).toBeTruthy();
    expect(screen.getByText('42.9 MB/s')).toBeTruthy();
    expect(screen.getByText('About 40s')).toBeTruthy();
    expect(screen.queryByLabelText('File transfer progress')).toBeNull();
  });
});
