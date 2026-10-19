import React from 'react';
import { Alert } from 'react-native';
import * as ReactNative from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import tokens from '@/theme/tokens.json';
import { ConnectionStatusCard } from './ConnectionStatusCard';
import { ConnectionDetailsModal } from './ConnectionDetailsModal';
import { UiPreviewContext } from '@/dev/preview/UiPreviewContext';
import type { ActiveConnection } from '@/features/connection/connectionPresentation';

const connection: ActiveConnection = { address: 'https://receiver.local:8443', name: 'Receiver',
  security: { mode: 'https', certificateVerified: true, tlsVersion: 'TLS 1.3' }, healthStatus: 'connected', trusted: true };

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }), { virtual: true });
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn().mockResolvedValue(undefined), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: React.PropsWithChildren) => children, SafeAreaView: ({ children }: React.PropsWithChildren) => children }));
jest.mock('@/api/ApiClient', () => ({ api: { url: 'https://receiver.local:8443' } }));

describe.each(['light', 'dark'] as const)('%s connection address treatments', mode => {
 beforeEach(() => { jest.clearAllMocks(); jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode); jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
 afterEach(() => jest.restoreAllMocks());
 it('separates the address and gives Copy Address a visible outline', () => {
  const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
  const onOpenDetails = jest.fn();
  const screen = render(<ConnectionStatusCard isConnected connectionSecurity={{ mode: 'https', certificateVerified: true }} connectionHealthStatus="connected" onOpenDetails={onOpenDetails} onRetryConnection={jest.fn()} />);
  const address = screen.getByRole('button', { name: 'Open connection security details' });
  expect(address).toHaveStyle({ backgroundColor: palette.surfaceInset, borderColor: palette.border, borderWidth: 1 });
  expect(screen.getByRole('button', { name: 'Copy server address' })).toHaveStyle({ backgroundColor: palette.primarySoft, borderColor: palette.primary, borderWidth: 1, minHeight: 44 });
  fireEvent.press(address);
  expect(onOpenDetails).toHaveBeenCalledTimes(1);
 });
 it('uses an inset panel and filled copy action inside security details', async () => {
  const palette = mode === 'dark' ? tokens.darkColors : tokens.colors;
  const screen = render(<ConnectionDetailsModal visible connection={connection} onClose={jest.fn()} />);
  expect(screen.getByTestId('connection-address-panel')).toHaveStyle({ backgroundColor: palette.surfaceInset, borderWidth: 1 });
  expect(screen.getByRole('button', { name: 'Copy server address' })).toHaveStyle({ backgroundColor: palette.primaryFill, width: '100%', minHeight: 48 });
  fireEvent.press(screen.getByRole('button', { name: 'Copy server address' }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://receiver.local:8443'));
 });
 it('blocks disabled address and copy actions', () => {
  const onOpenDetails = jest.fn();
  const screen = render(<ConnectionStatusCard isConnected={false} connectionSecurity={{ mode: 'disconnected', certificateVerified: false }} connectionHealthStatus="disconnected" onOpenDetails={onOpenDetails} onRetryConnection={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Copy server address' }));
  fireEvent.press(screen.getByRole('button', { name: 'Open connection security details' }));
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(onOpenDetails).not.toHaveBeenCalled();
 });
 it('shows truthful HTTP and unavailable verification states independently of saved trust', () => {
  const screen = render(<ConnectionDetailsModal visible connection={{ ...connection, healthStatus: 'retrying',
    security: { mode: 'http', certificateVerified: false } }} onClose={jest.fn()} />);
  expect(screen.getByText('Reconnecting')).toBeTruthy();
  expect(screen.getByText('HTTP (unencrypted)')).toBeTruthy();
  expect(screen.getByText('Files and authentication credentials may be visible on this network.')).toBeTruthy();
  expect(screen.queryByText('Verified')).toBeNull();
  screen.rerender(<ConnectionDetailsModal visible connection={{ ...connection, security: { mode: 'https', certificateVerified: false } }} onClose={jest.fn()} />);
  expect(screen.getByText('Saved on this phone')).toBeTruthy();
  expect(screen.getByText('Not verified')).toBeTruthy();
  expect(screen.getByText('Unavailable')).toBeTruthy();
  screen.rerender(<ConnectionDetailsModal visible connection={null} onClose={jest.fn()} />);
  expect(screen.queryByText('Connection details')).toBeNull();
 });
});

it('uses only the sample receiver address when previewing and copying connection details', async () => {
  jest.mocked(Clipboard.setStringAsync).mockClear();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    const screen = render(<UiPreviewContext.Provider value={{ active: true, receiverAddress: 'https://sample-receiver.invalid:18443' }}>
      <ConnectionStatusCard isConnected connectionSecurity={{ mode: 'https', certificateVerified: true }}
        connectionHealthStatus="connected" onOpenDetails={jest.fn()} onRetryConnection={jest.fn()} />
    </UiPreviewContext.Provider>);
    expect(screen.queryByText('https://receiver.local:8443')).toBeNull();
    expect(screen.getByText('https://sample-receiver.invalid:18443')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Copy server address' }));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://sample-receiver.invalid:18443'));
  } finally { alert.mockRestore(); }
});
