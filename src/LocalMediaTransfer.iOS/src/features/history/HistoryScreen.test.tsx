import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

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

  it('uses returned records for aggregates and filters mixed sessions into Needs Attention', () => {
    const onClear = jest.fn();
    const screen = render(
      <HistoryScreen isConnected items={items} loading={false} error={null} onRefresh={jest.fn()} onClear={onClear} onConnect={jest.fn()} />,
    );

    expect(screen.getByText('Recent sessions')).toBeTruthy();
    expect(screen.getByText('Uploaded files')).toBeTruthy();
    expect(screen.getByText('Duplicates skipped')).toBeTruthy();
    expect(screen.getByText('7.0 KB')).toBeTruthy();

    fireEvent.press(screen.getByText('Needs Attention'));
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByText('Canceled')).toBeTruthy();
    expect(screen.getAllByText('Completed')).toHaveLength(1);

    fireEvent.press(screen.getByText('Clear All'));
    expect(onClear).toHaveBeenCalled();
  });

  it('shows expanded real metrics with human-readable durations', () => {
    const screen = render(
      <HistoryScreen isConnected items={items} loading={false} error={null} onRefresh={jest.fn()} onClear={jest.fn()} onConnect={jest.fn()} />,
    );

    fireEvent.press(screen.getByLabelText(/Open canceled transfer/));
    expect(screen.getByText('Transfer Details')).toBeTruthy();
    expect(screen.getByText('6m 28s')).toBeTruthy();
    expect(screen.getByText('Additional components')).toBeTruthy();
    expect(screen.getByText('2 · 2.0 KB')).toBeTruthy();
  });
});
