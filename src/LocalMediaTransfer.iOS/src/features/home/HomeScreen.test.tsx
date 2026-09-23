import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import HomeScreen from './HomeScreen';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}), { virtual: true });

jest.mock('@/api/ApiClient', () => ({
  api: { url: 'https://receiver.local:8443' },
}));

jest.mock('@/services/NativeCapabilities', () => ({
  expectedServerEnvironment: jest.fn(() => 'production'),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

describe('HomeScreen', () => {
  it('keeps recent receiver activity compact and opens its details', () => {
    const screen = render(
      <HomeScreen
        isConnected
        connectionSecurity={{ mode: 'https', certificateVerified: true, tlsVersion: 'TLS 1.3' }}
        connectionHealthStatus="connected"
        history={[
          {
            sessionId: 'skipped-session',
            completedAt: '2026-09-12T10:30:00Z',
            selectedAssets: 1,
            expandedFiles: 1,
            uploadedFiles: 0,
            skippedFiles: 1,
            failedFiles: 0,
            completionStatus: 'completed',
          },
          {
            sessionId: 'recent-session',
            completedAt: '2026-09-12T09:30:00Z',
            selectedAssets: 2,
            expandedFiles: 3,
            uploadedFiles: 3,
            skippedFiles: 0,
            failedFiles: 0,
            uploadedBytes: 3_000,
            totalDurationMs: 90_000,
            completionStatus: 'completed',
          },
        ]}
        historyLoading={false}
        onOpenPicker={jest.fn()}
        onOpenConnect={jest.fn()}
        onOpenHistory={jest.fn()}
        onRetryConnection={jest.fn()}
      />,
    );

    expect(screen.queryByText('Ready to Send')).toBeNull();
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.queryByText('Skipped duplicates')).toBeNull();
    expect(screen.getByText(/1 file ·/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Completed\./));
    expect(screen.getByText('Transfer Details')).toBeTruthy();
    expect(screen.getByText('1m 30s')).toBeTruthy();
  });
});
