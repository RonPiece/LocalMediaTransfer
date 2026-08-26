import type { ReactNode } from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import { api } from '@/api/ApiClient';
import { IOS_APP_VERSION } from '@/version';
import DashboardScreen from './DashboardScreen';
import { formatHistoryDate, historyItemKey, historyStatus, normalizeHistoryItems } from './hooks/useDashboardHistory';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}), { virtual: true });
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
    SafeAreaView: ({ children }: { children: ReactNode }) => children,
  };
});
jest.mock('@/api/ApiClient', () => ({
  api: {
    url: 'http://192.168.1.4:8080',
    uploadToken: 'approved-device-credential',
    serverVersion: '2.0.1',
    getHistory: jest.fn(),
    clearHistory: jest.fn(),
  },
}));

describe('DashboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('formats the server millisecond timestamp and derives a real status', () => {
    expect(formatHistoryDate(1710000000000)).not.toBe('Date unavailable');
    expect(formatHistoryDate(0)).toBe('Date unavailable');
    expect(formatHistoryDate('0')).toBe('Date unavailable');
    expect(formatHistoryDate(undefined)).toBe('Date unavailable');
    expect(historyStatus({ uploadedFiles: 2, skippedFiles: 1, failedFiles: 0 })).toBe('Completed');
    expect(historyStatus({ uploadedFiles: 1, failedFiles: 1 })).toBe('Completed with errors');
  });

  it('normalizes stable history keys when the server omits session IDs', () => {
    const [first, second] = normalizeHistoryItems([
      { completedAt: 1710000000000, uploadedFiles: 1, skippedFiles: 0, failedFiles: 0 },
      { completedAt: 1710000000000, uploadedFiles: 1, skippedFiles: 0, failedFiles: 0 },
    ]);

    expect(historyItemKey(first)).toBe('history:1710000000000:1:0:0');
    expect(historyItemKey(second)).toBe('history:1710000000000:1:0:0:duplicate-1');
  });

  it('renders history fields from the server contract inline', async () => {
    (api.getHistory as jest.Mock).mockResolvedValue([{ sessionId: 'one', completedAt: 1710000000000, uploadedFiles: 2, skippedFiles: 1, failedFiles: 0 }]);
    const screen = render(<DashboardScreen isConnected onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Transfer History'));

    await waitFor(() => expect(api.getHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('2 uploaded · 1 skipped · 0 failed')).toBeTruthy());
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.queryByText('Invalid Date')).toBeNull();
  });

  it('keeps problem-file history compact until the user opens the scrolling details view', async () => {
    (api.getHistory as jest.Mock).mockResolvedValue([{
      sessionId: 'problem-history',
      completedAt: 1710000000000,
      uploadedFiles: 0,
      skippedFiles: 1,
      failedFiles: 1,
      files: [
        { id: 'skip-1', name: 'incoming.jpg', matchedName: 'existing.jpg', size: 10, outcome: 'skipped', avoidedBytes: 10 },
        { id: 'failed-1', name: 'failed.mov', size: 20, outcome: 'failed', error: 'file-read-failed' },
      ],
    }]);
    const screen = render(<DashboardScreen isConnected onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Transfer History'));
    await screen.findByText('View 2 problem files');
    expect(screen.queryByText('incoming.jpg matched existing.jpg')).toBeNull();

    fireEvent.press(screen.getByLabelText('View 2 problem file details'));
    expect(await screen.findByText('incoming.jpg matched existing.jpg')).toBeTruthy();
    expect(screen.getByText('failed.mov')).toBeTruthy();
  });

  it('opens settings and copies only the server address without credentials from the status card', async () => {
    const screen = render(<DashboardScreen isConnected onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('Skip Exact Duplicates')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Copy server address'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(api.url));
  });

  it('shows a failure alert when copying the dashboard address fails', async () => {
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('clipboard denied'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = render(<DashboardScreen isConnected onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Copy server address'));

    await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to copy dashboard server address.',
    ));
    expect(alertSpy).toHaveBeenCalledWith('Copy failed', 'Could not copy the server address. Select and copy it manually.');
  });

  it('keeps the credential hidden and copies only the address from connection details', async () => {
    const screen = render(<DashboardScreen isConnected onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    fireEvent.press(screen.getByText(api.url));
    expect((await screen.findAllByText(api.url)).length).toBeGreaterThan(1);
    expect(screen.queryByText(api.uploadToken)).toBeNull();
    fireEvent.press(screen.getAllByText('Copy Address').at(-1)!);

    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(api.url));
  });

  it('explains Expo Go locked HTTP and disabled nearby discovery in settings', async () => {
    const onExplain = jest.fn();
    const screen = render(
      <DashboardScreen
        isConnected
        nativeHttpsAvailable={false}
        allowInsecureHttp
        onExplainUnencryptedHttp={onExplain}
        onTransferMedia={jest.fn()}
        onDisconnect={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Settings'));

    expect(await screen.findByText('Requires the installed iOS app. Expo Go can connect by QR code or manual HTTP address.')).toBeTruthy();
    expect(screen.getByText('Expo Go uses HTTP and the compatibility uploader because pinned HTTPS and native transfer are available only in the installed IPA.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Explain unencrypted HTTP'));
    expect(onExplain).toHaveBeenCalled();
  });

  it('does not render the authentication credential', () => {
    const screen = render(<DashboardScreen isConnected connectionSecurity={{ mode: 'https', tlsVersion: 'TLS 1.3', certificateVerified: true }} onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    expect(screen.getByText('Encrypted · TLS 1.3 · certificate verified')).toBeTruthy();
    expect(screen.queryByText('approved-device-credential')).toBeNull();
  });

  it('shows iOS and connected server versions in About', () => {
    const screen = render(<DashboardScreen isConnected onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('About'));

    expect(screen.getByText(`App Version ${IOS_APP_VERSION}`)).toBeTruthy();
    expect(screen.getByText('Server Version 2.0.1')).toBeTruthy();
  });

  it('handles a failed About link open without an unhandled promise', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('cannot open'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = render(<DashboardScreen isConnected onTransferMedia={jest.fn()} onDisconnect={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('About'));
    fireEvent.press(screen.getByText('DM me on GitHub'));

    await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to open dashboard about link.',
    ));
    expect(alertSpy).toHaveBeenCalledWith('Could not open link', 'The link could not be opened on this device.');
  });

  it('shows live disconnected state and blocks starting a transfer', () => {
    const onTransferMedia = jest.fn();
    const screen = render(<DashboardScreen isConnected={false} onTransferMedia={onTransferMedia} onDisconnect={jest.fn()} />);

    expect(screen.getByText('Desktop unavailable')).toBeTruthy();
    fireEvent.press(screen.getByText('Choose Media'));
    expect(onTransferMedia).not.toHaveBeenCalled();
  });

  it('shows bounded reconnect state and exposes an explicit retry action', () => {
    const onRetryConnection = jest.fn();
    const screen = render(
      <DashboardScreen
        isConnected={false}
        connectionHealthStatus="disconnected"
        onRetryConnection={onRetryConnection}
        onTransferMedia={jest.fn()}
        onDisconnect={jest.fn()}
      />,
    );

    expect(screen.getByText('Desktop unavailable')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Try reconnecting'));
    expect(onRetryConnection).toHaveBeenCalledTimes(1);
  });

  it('routes the exact-duplicate preference to the iPhone preference owner', async () => {
    const onChange = jest.fn();
    const screen = render(
      <DashboardScreen
        isConnected
        skipExactDuplicates
        onSkipExactDuplicatesChange={onChange}
        onTransferMedia={jest.fn()}
        onDisconnect={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Settings'));
    await screen.findByText('Skip Exact Duplicates');
    fireEvent(screen.getByLabelText('Skip Exact Duplicates'), 'valueChange', false);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
