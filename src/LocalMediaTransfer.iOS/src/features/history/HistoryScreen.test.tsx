import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

import HistoryScreen from './HistoryScreen';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const items = [
  {
    sessionId: 'complete',
    completedAt: '2026-09-12T08:00:00Z',
    expandedFiles: 2,
    uploadedFiles: 2,
    skippedFiles: 0,
    failedFiles: 0,
    uploadedBytes: 1_000,
  },
  {
    sessionId: 'mixed',
    completedAt: '2026-09-12T09:00:00Z',
    expandedFiles: 3,
    uploadedFiles: 1,
    skippedFiles: 1,
    failedFiles: 1,
    uploadedBytes: 2_000,
  },
  {
    sessionId: 'cancelled',
    completedAt: '2026-09-12T09:30:00Z',
    selectedAssets: 10,
    expandedFiles: 12,
    uploadedFiles: 4,
    skippedFiles: 1,
    failedFiles: 0,
    uploadedBytes: 4_000,
    selectedBytes: 12_000,
    selectedMediaFiles: 10,
    selectedMediaBytes: 10_000,
    additionalComponentsFiles: 2,
    additionalComponentsBytes: 2_000,
    checkDurationMs: 8_000,
    uploadDurationMs: 380_000,
    totalDurationMs: 388_000,
    completionStatus: 'cancelled' as const,
  },
];

describe('HistoryScreen', () => {
  it('explains receiver-hosted history while disconnected', () => {
    const onConnect = jest.fn();
    const screen = render(
      <HistoryScreen isConnected={false} items={[]} loading={false} error={null} onRefresh={jest.fn()} onClear={jest.fn()} onConnect={onConnect} />,
    );

    expect(screen.getByText('Connect to view history')).toBeTruthy();
    expect(screen.getByText(/stored by the receiver/)).toBeTruthy();
    fireEvent.press(screen.getByText('Open Connect'));
    expect(onConnect).toHaveBeenCalled();
  });

  it('keeps problem sessions in All without a Needs Attention segment', () => {
    const onClear = jest.fn();
    const screen = render(
      <HistoryScreen isConnected items={items} loading={false} error={null} onRefresh={jest.fn()} onClear={onClear} onConnect={jest.fn()} />,
    );

    expect(screen.getByText('Recent sessions')).toBeTruthy();
    expect(screen.getByText('Uploaded files')).toBeTruthy();
    expect(screen.getByText('Duplicates skipped')).toBeTruthy();
    expect(screen.getByText('7.0 KB')).toBeTruthy();

    expect(screen.queryByText('Needs Attention')).toBeNull();
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByText('Canceled')).toBeTruthy();
    expect(screen.getAllByText('Completed')).toHaveLength(2);

    fireEvent.press(screen.getByText('Clear All'));
    expect(onClear).toHaveBeenCalled();
  });

  it('shows expanded real metrics with human-readable durations', async () => {
    const screen = render(
      <HistoryScreen isConnected items={items} loading={false} error={null} onRefresh={jest.fn()} onClear={jest.fn()} onConnect={jest.fn()} />,
    );

    fireEvent.press(screen.getByLabelText(/Open canceled transfer/));
    await waitFor(() => expect(screen.getByText('Transfer Details')).toBeTruthy());
    expect(screen.getByText('6m 28s')).toBeTruthy();
    expect(screen.getByText('Additional components')).toBeTruthy();
    expect(screen.getByText('2 · 2.0 KB')).toBeTruthy();
  });
});

it('includes partial skips in the Skipped segment', () => {
  const screen = render(<HistoryScreen isConnected items={items} loading={false} error={null} onRefresh={jest.fn()} onClear={jest.fn()} onConnect={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Skipped' }));
  expect(screen.getByText('Mixed')).toBeTruthy();
  expect(screen.getByText('Canceled')).toBeTruthy();
  expect(screen.queryByLabelText(/Open completed transfer/)).toBeNull();
});

 it('labels partial duplicate skips without changing successful completion', () => {
  const screen = render(<HistoryScreen isConnected items={[{ ...items[0], expandedFiles: 4, skippedFiles: 2 }]} loading={false} error={null} onRefresh={jest.fn()} onClear={jest.fn()} onConnect={jest.fn()} />);
  expect(screen.getByText('2 duplicates skipped')).toBeTruthy();
  expect(screen.getByLabelText(/Open completed transfer/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Skipped' }));
  expect(screen.getByText('2 duplicates skipped')).toBeTruthy();
});
it('uses smaller text for all-skipped badges', () => {
 const screen = render(<HistoryScreen isConnected items={[{ ...items[0], uploadedFiles: 0, skippedFiles: 2 }]} loading={false} error={null} onRefresh={jest.fn()} onClear={jest.fn()} onConnect={jest.fn()} />);
 expect(screen.getByText('Skipped duplicates')).toHaveStyle({ fontSize: 10 });
});

it('filters failed sessions and mixed sessions with failed files without including cancellation alone', () => {
 const screen = render(<HistoryScreen isConnected items={[...items, { ...items[0], sessionId: 'fatal', uploadedFiles: 0, completionStatus: 'fatal' }]} loading={false} error={null} onRefresh={jest.fn()} onClear={jest.fn()} onConnect={jest.fn()} />);
 fireEvent.press(within(screen.getByLabelText('History filters')).getByRole('button', { name: 'Failed' }));
 expect(screen.getByLabelText(/Open mixed transfer|Open completed with errors transfer/)).toBeTruthy();
 expect(screen.getByLabelText(/Open failed transfer/)).toBeTruthy();
 expect(screen.queryByLabelText(/Open completed transfer/)).toBeNull();
 expect(screen.queryByLabelText(/Open canceled transfer/)).toBeNull();
 fireEvent.press(screen.getByRole('button', { name: 'All' }));
 expect(screen.getByLabelText(/Open canceled transfer/)).toBeTruthy();
});
