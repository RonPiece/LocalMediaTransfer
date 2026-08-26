import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { shouldUseCompactStatsLayout, TransferStatsBar } from './TransferStatsBar';

describe('TransferStatsBar', () => {
  it('uses compact layout at 393-point/SE widths and three columns on wider iPhones or iPad', () => {
    expect(shouldUseCompactStatsLayout(327, 1)).toBe(true);
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
      nativeEvent: { layout: { width: 300, height: 140, x: 0, y: 0 } },
    });

    expect(screen.getByTestId('transfer-eta-compact')).toBeTruthy();
    expect(screen.getByText('2m 14s').props.numberOfLines).toBeUndefined();
    expect(screen.getByText('Final transfer size is still being determined.')).toBeTruthy();
  });

  it('shows authoritative file progress separately from media analysis', () => {
    const screen = render(
      <TransferStatsBar
        itemsRemaining={188}
        remainingLabel="Files left"
        currentMediaMBps={42.9}
        timeLabel="Time remaining"
        timeText="About 40s"
        processedFiles={200}
        totalFiles={388}
      />,
    );

    expect(screen.getByText('200 of 388 processed')).toBeTruthy();
    expect(screen.getByLabelText('File transfer progress')).toHaveAccessibilityValue({
      min: 0,
      max: 388,
      now: 200,
    });
  });
});
