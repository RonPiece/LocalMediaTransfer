import tokens from '@/theme/tokens.json';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert } from 'react-native';
import * as ReactNative from 'react-native';
import { NativeWindStyleSheet } from 'nativewind';
import { StatusBar } from 'expo-status-bar';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ConnectionScreen from './ConnectionScreen';
import { useCameraPermissions } from 'expo-camera';
import { qrScannerControlsTop } from './components/QrScannerOverlay';
import { nearbyHeaderUsesIconOnlyActions } from './components/NearbyDesktopSection';
import * as Haptics from 'expo-haptics';
import type { ActiveConnection } from './connectionPresentation';
import type { SavedConnection } from '@/app/types';

jest.mock('expo-status-bar', () => ({ StatusBar: jest.fn(() => null) }));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SafeAreaProvider: ({ children }: React.PropsWithChildren) => <>{children}</>, SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
    initialWindowMetrics: { insets: { top: 44, bottom: 34, left: 0, right: 0 }, frame: { width: 390, height: 844, x: 0, y: 0 } } };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return {
    Ionicons: () => <></>
  };
}, { virtual: true });

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}), { virtual: true });

let mockScannedQrData = 'http://192.168.1.5:8080/?token=abcxyz';

// Mock expo-camera
jest.mock('expo-camera', () => {
  const React = require('react');
  return {
    useCameraPermissions: jest.fn(),
    CameraView: ({ onBarcodeScanned }: any) => {
      // Create a mock component that triggers onBarcodeScanned when pressed
      const { TouchableOpacity, Text } = require('react-native');
      return (
        <TouchableOpacity testID="mock-camera" onPress={() => onBarcodeScanned({ data: mockScannedQrData })}>
          <Text>Mock Camera</Text>
        </TouchableOpacity>
      );
    }
  };
});

describe('ConnectionScreen QR Logic', () => {
  beforeEach(() => {
    mockScannedQrData = 'http://192.168.1.5:8080/?token=abcxyz';
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: true },
      jest.fn()
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const active: ActiveConnection = { address: 'https://receiver.local:8443', name: 'Receiver', healthStatus: 'connected',
    security: { mode: 'https', certificateVerified: true, tlsVersion: 'TLS 1.3' }, trusted: true };
  const saved: SavedConnection = { version: 3, environment: 'test', serverId: 'current', name: active.name,
    httpsUrl: active.address, certificateFingerprint: '' };
  const servers = [8443, 9443].map(httpsPort => ({ name: active.name, address: 'receiver.local', httpsPort,
    serverId: `server-${httpsPort}`, environment: 'test' as const, certificateFingerprint: '', approvalRequired: true }));

  it.each(['light', 'dark'] as const)('opens shared details from active trusted and nearby rows in %s without reconnecting', mode => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(mode);
    const onConnect = jest.fn(), onConnectTrusted = jest.fn(), onConnectDiscovered = jest.fn();
    const screen = render(<ConnectionScreen onConnect={onConnect} onConnectTrusted={onConnectTrusted} onConnectDiscovered={onConnectDiscovered}
      isConnected activeConnection={active} savedReceiver={saved} nearbyDiscoveryEnabled discoveredServers={servers} />);
    const rows = screen.getAllByLabelText('View connection details for Receiver');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toBeDisabled();
      expect(row).toHaveStyle({ opacity: 1 });
      fireEvent.press(row);
      expect(screen.getByText('Connection details')).toBeTruthy();
      expect(screen.getByText('TLS 1.3')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Back'));
    }
    const other = screen.getByLabelText('Connect to Receiver');
    expect(other).toBeDisabled();
    expect(other.findAllByType(Ionicons).map(icon => icon.props.name)).not.toContain('chevron-forward');
    expect(screen.getByText('Disconnect to connect')).toBeTruthy();
    fireEvent.press(other);
    expect(onConnect).not.toHaveBeenCalled();
    expect(onConnectTrusted).not.toHaveBeenCalled();
    expect(onConnectDiscovered).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Open UI Preview')).toBeNull();
  });

  it('keeps busy rows unavailable and closes details across a disconnect or receiver switch', () => {
    const props = { onConnect: jest.fn(), activeConnection: active, isConnected: true, savedReceiver: saved };
    const screen = render(<ConnectionScreen {...props} isConnecting />);
    const row = screen.getByLabelText('View connection details for Receiver');
    expect(row).toBeDisabled();
    expect(row.props.accessibilityState.busy).toBe(true);
    fireEvent.press(row);
    expect(screen.queryByText('Connection details')).toBeNull();
    screen.rerender(<ConnectionScreen {...props} />);
    fireEvent.press(screen.getByLabelText('View connection details for Receiver'));
    screen.rerender(<ConnectionScreen {...props} activeConnection={{ ...active, address: 'https://other.local' }} />);
    expect(screen.queryByText('Connection details')).toBeNull();
    screen.rerender(<ConnectionScreen {...props} />);
    expect(screen.queryByText('Connection details')).toBeNull();
    fireEvent.press(screen.getByLabelText('View connection details for Receiver'));
    screen.rerender(<ConnectionScreen {...props} isConnected={false} activeConnection={null} />);
    expect(screen.queryByText('Connection details')).toBeNull();
    screen.rerender(<ConnectionScreen {...props} />);
    expect(screen.queryByText('Connection details')).toBeNull();
  });

  it('retains reconnect action when disconnected', () => {
    const onConnectTrusted = jest.fn();
    const screen = render(<ConnectionScreen onConnect={jest.fn()} savedReceiver={saved} onConnectTrusted={onConnectTrusted} />);
    fireEvent.press(screen.getByLabelText('Reconnect to trusted receiver'));
    expect(onConnectTrusted).toHaveBeenCalledTimes(1);
  });

  it('keeps nearby UDP discovery disabled by default', () => {
    const { getByText, queryByText } = render(<ConnectionScreen onConnect={jest.fn()} nativeHttpsAvailable />);

    expect(getByText('Nearby discovery is off. Enable it here and in Local Media Transfer Settings on Windows. QR and manual connection remain available.')).toBeTruthy();
    expect(queryByText('Refresh')).toBeNull();
  });

  it('shows nearby discovery as unavailable in Expo Go', () => {
    const { getByText } = render(<ConnectionScreen onConnect={jest.fn()} nativeHttpsAvailable={false} allowInsecureHttp />);

    expect(getByText('Nearby discovery needs the installed mobile app. Expo Go can still connect by QR code or manual HTTP address.')).toBeTruthy();
    expect(getByText('Installed App Required')).toBeTruthy();
  });

  it('opens nearby discovery help', () => {
    const onExplain = jest.fn();
    const { getByLabelText } = render(
      <ConnectionScreen onConnect={jest.fn()} nativeHttpsAvailable onExplainNearbyDiscovery={onExplain} />,
    );

    fireEvent.press(getByLabelText('Explain nearby desktop discovery'));
    expect(onExplain).toHaveBeenCalled();
  });

  it('explains locked HTTP behavior in Expo Go', () => {
    const onExplain = jest.fn();
    const { getByText, getByLabelText } = render(
      <ConnectionScreen onConnect={jest.fn()} nativeHttpsAvailable={false} allowInsecureHttp onExplainUnencryptedHttp={onExplain} />,
    );

    expect(getByText('Expo Go uses HTTP and the compatibility uploader. Install the mobile app for encrypted, faster native transfers.')).toBeTruthy();
    fireEvent.press(getByLabelText('Explain unencrypted HTTP'));
    expect(onExplain).toHaveBeenCalled();
  });

  it('opens the QR scanner when requested by the discovery trust prompt', async () => {
    const { getByTestId } = render(
      <ConnectionScreen onConnect={jest.fn()} scanRequestId={1} />,
    );

    expect(await waitFor(() => getByTestId('mock-camera'))).toBeTruthy();
  });

  it('shows one non-modal Windows approval state', () => {
    const { getByText } = render(
      <ConnectionScreen onConnect={jest.fn()} pairingDesktopName="Ron's PC" />,
    );

    expect(getByText('Waiting for Windows approval')).toBeTruthy();
    expect(getByText("Approve this phone in Local Media Transfer on Ron's PC. Keep this screen open.")).toBeTruthy();
  });

  it('keeps rounded nearby actions in one row and uses icons only when space is constrained', () => {
    expect(nearbyHeaderUsesIconOnlyActions(390, 1)).toBe(false);
    expect(nearbyHeaderUsesIconOnlyActions(350, 1)).toBe(true);
    expect(nearbyHeaderUsesIconOnlyActions(500, 1.3)).toBe(true);
    const onRefresh = jest.fn();
    const onDisconnect = jest.fn();
    const screen = render(
      <ConnectionScreen
        onConnect={jest.fn()}
        nativeHttpsAvailable
        nearbyDiscoveryEnabled
        onRefreshDiscovery={onRefresh}
        onDisconnect={onDisconnect}
      />,
    );

    const refresh = screen.getByLabelText('Refresh nearby receivers');
    fireEvent(refresh, 'pressIn');
    fireEvent(refresh, 'pressOut');
    fireEvent.press(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);

    const disconnect = screen.getByLabelText('Disconnect');
    expect(disconnect.props.accessibilityState).toEqual({ disabled: true });
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it('does not repeat security marketing on the connection screen', () => {
    const screen = render(<ConnectionScreen onConnect={jest.fn()} nativeHttpsAvailable />);

    expect(screen.queryByText('Secure & Private')).toBeNull();
    expect(screen.queryByText('No cloud')).toBeNull();
  });

  it('places the QR close control below the iPhone status area', async () => {
    const screen = render(<ConnectionScreen onConnect={jest.fn()} />);

    fireEvent.press(screen.getByText('Scan Receiver QR'));
    expect(await screen.findByTestId('qr-scanner-close')).toBeTruthy();
    const controls = screen.getByTestId('qr-scanner-controls');

    expect(controls).toHaveStyle({ top: qrScannerControlsTop() });
    expect(qrScannerControlsTop(59, 'ios')).toBe(71);
    expect(jest.mocked(StatusBar).mock.calls.at(-1)?.[0]).toMatchObject({ style: 'light' });
  });

  it('keeps the disabled QR action readable in dark appearance', () => {
    const colorScheme = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('dark');
    NativeWindStyleSheet.setColorScheme('dark');
    const screen = render(<ConnectionScreen onConnect={jest.fn()} isConnected nativeHttpsAvailable />);
    try {
      expect(screen.getByLabelText('Disconnect before pairing with another receiver')).toHaveStyle({ backgroundColor: tokens.darkColors.disabledFill });
      expect(screen.getByText('Disconnect before pairing with another receiver')).toHaveStyle({ color: tokens.darkColors.onSurfaceVariant });
    } finally {
      screen.unmount();
      NativeWindStyleSheet.setColorScheme('system');
      colorScheme.mockRestore();
    }
  });

  it('uses the shared disabled treatment for the unavailable QR action', () => {
    const screen = render(<ConnectionScreen onConnect={jest.fn()} isConnected nativeHttpsAvailable />);

    const qrAction = screen.getByLabelText('Disconnect before pairing with another receiver');
    expect(qrAction.props.accessibilityState?.disabled ?? qrAction.props.disabled).toBeTruthy();
    expect(qrAction).toHaveStyle({ backgroundColor: tokens.colors.disabledFill });
    expect(qrAction.findAllByType(Ionicons).map(icon => icon.props.name)).toEqual(['qr-code-outline']);
    expect(screen.queryByText('Use Disconnect below when you want to change receivers.')).toBeNull();
    fireEvent.press(qrAction);
    expect(screen.queryByTestId('mock-camera')).toBeNull();
    expect(screen.getByText('Disconnect before pairing with another receiver')).toHaveStyle({ color: tokens.colors.onSurfaceVariant });
  });

  it('extracts URL base and token from a QR code scan', async () => {
    const mockOnConnect = jest.fn();
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={mockOnConnect} />);

    // Tap the redesigned QR action row.
    fireEvent.press(getByText('Scan Receiver QR'));

    // Find the mock camera we created and trigger the fake scan
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);

    // Verify onConnect was called correctly
    expect(mockOnConnect).toHaveBeenCalledWith('http://192.168.1.5:8080', 'abcxyz');
  });

  it('ignores duplicate QR scan callbacks from the same camera session', async () => {
    const mockOnConnect = jest.fn();
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={mockOnConnect} />);

    fireEvent.press(getByText('Scan Receiver QR'));
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);
    fireEvent.press(mockCamera);

    expect(mockOnConnect).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a discovery failure from an empty result and offers retry', () => {
    const onRefresh = jest.fn();
    const { getAllByText, getByText } = render(
      <ConnectionScreen
        onConnect={jest.fn()}
        nativeHttpsAvailable
        nearbyDiscoveryEnabled
        discoveryFailed
        onRefreshDiscovery={onRefresh}
      />,
    );

    expect(getByText('Nearby discovery could not run. Check Wi-Fi access, then try again or scan the QR code.')).toBeTruthy();
    fireEvent.press(getAllByText('Refresh').at(-1)!);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not queue repeated alerts while an unsupported QR leaves the camera frame', async () => {
    mockScannedQrData = 'exp://10.100.102.100:8082';
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={jest.fn()} />);

    fireEvent.press(getByText('Scan Receiver QR'));
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);
    fireEvent.press(mockCamera);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Unsupported QR code',
      'Scan the current pairing QR shown by the Windows application.',
    );
  });

  it('unlocks the QR scanner when an async connection attempt returns false', async () => {
    const mockOnConnect = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={mockOnConnect} />);

    fireEvent.press(getByText('Scan Receiver QR'));
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);

    await waitFor(() => expect(mockOnConnect).toHaveBeenCalledTimes(1));

    fireEvent.press(getByText('Scan Receiver QR'));
    fireEvent.press(await waitFor(() => getByTestId('mock-camera')));

    await waitFor(() => expect(mockOnConnect).toHaveBeenCalledTimes(2));
  });

  it('unlocks the QR scanner when an async connection attempt rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mockOnConnect = jest.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={mockOnConnect} />);

    fireEvent.press(getByText('Scan Receiver QR'));
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);

    await waitFor(() => expect(mockOnConnect).toHaveBeenCalledTimes(1));

    fireEvent.press(getByText('Scan Receiver QR'));
    fireEvent.press(await waitFor(() => getByTestId('mock-camera')));

    await waitFor(() => expect(mockOnConnect).toHaveBeenCalledTimes(2));
  });

  it('shows an update message for newer pairing QR versions', async () => {
    mockScannedQrData = JSON.stringify({
      type: 'lmt-pair',
      version: 4,
      environment: 'production',
      serverId: 'desktop-1',
      httpsUrl: 'https://192.168.1.5:8443',
      certificateFingerprint: 'ab'.repeat(32),
      token: 'qr-token',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={jest.fn()} />);

    fireEvent.press(getByText('Scan Receiver QR'));
    fireEvent.press(await waitFor(() => getByTestId('mock-camera')));

    expect(alertSpy).toHaveBeenCalledWith(
      'Update mobile app',
      'This Windows QR code uses pairing version 4. Install the latest mobile app and scan again.',
    );
  });

  it('defaults a bare manual IP to Expo Go HTTP', () => {
    const mockOnConnect = jest.fn();
    const { getByPlaceholderText, getByText, queryByPlaceholderText } = render(
      <ConnectionScreen onConnect={mockOnConnect} nativeHttpsAvailable={false} allowInsecureHttp />,
    );

    fireEvent.press(getByText('Enter Address Manually'));

    // Find input and type an IP
    const input = getByPlaceholderText('192.168.1.x');
    fireEvent.changeText(input, '192.168.1.100');

    // Press manual connect
    fireEvent.press(getByText('Connect Manually'));

    expect(queryByPlaceholderText('SHA-256 fingerprint from Windows')).toBeNull();
    expect(mockOnConnect).toHaveBeenCalledWith('http://192.168.1.100:8080', '', undefined);
  });

  it('keeps manual field labels visible and prevents malformed addresses or fingerprints', () => {
    const onConnect = jest.fn();
    const screen = render(<ConnectionScreen onConnect={onConnect} nativeHttpsAvailable />);
    fireEvent.press(screen.getByText('Enter Address Manually'));
    expect(screen.getByText('Receiver address')).toBeTruthy();
    expect(screen.getByText('Certificate fingerprint')).toBeTruthy();
    expect(screen.getByText('Session token')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Receiver address'), 'https://receiver.local:8443/path?token=secret');
    expect(screen.getByText('Enter a valid receiver address without a path or query.')).toBeTruthy();
    fireEvent.press(screen.getByText('Connect Manually'));
    expect(onConnect).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Receiver address'), 'receiver.local');
    fireEvent.changeText(screen.getByLabelText('Certificate fingerprint'), 'short');
    expect(screen.getByText('Enter the complete 64-character SHA-256 fingerprint.')).toBeTruthy();
    fireEvent.press(screen.getByText('Connect Manually'));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a recoverable message when camera permission cannot be requested', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false },
      jest.fn().mockRejectedValue(new Error('camera service unavailable')),
    ]);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText } = render(<ConnectionScreen onConnect={jest.fn()} />);

    fireEvent.press(getByText('Scan Receiver QR'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(
      'Camera unavailable',
      'The camera could not be opened. Try again or enter the desktop address manually.',
    ));
  });

  it('requires secure pairing fields for a bare manual IP in the installed app', () => {
    const mockOnConnect = jest.fn();
    const { getByPlaceholderText, getByText, getByLabelText } = render(
      <ConnectionScreen onConnect={mockOnConnect} nativeHttpsAvailable />,
    );

    fireEvent.press(getByText('Enter Address Manually'));
    fireEvent.changeText(getByPlaceholderText('192.168.1.x'), '192.168.1.100');
    fireEvent.press(getByText('Connect Manually'));
    expect(mockOnConnect).not.toHaveBeenCalled();
    fireEvent.changeText(getByLabelText('Certificate fingerprint'), 'ab'.repeat(32));
    fireEvent.changeText(getByLabelText('Session token'), '  ');
    expect(getByText('Enter the session token shown in Windows.')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Session token'), 'test-token');
    fireEvent.press(getByText('Connect Manually'));
    expect(mockOnConnect).toHaveBeenCalledWith('https://192.168.1.100:8443', 'test-token',
      expect.objectContaining({ certificateFingerprint: 'ab'.repeat(32), token: 'test-token' }));
  });

  it('handles a rejected manual connection without an unhandled promise', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const mockOnConnect = jest.fn().mockRejectedValue(new Error('connection setup failed'));
    const { getByPlaceholderText, getByText, getByLabelText } = render(
      <ConnectionScreen onConnect={mockOnConnect} nativeHttpsAvailable />,
    );

    fireEvent.press(getByText('Enter Address Manually'));
    fireEvent.changeText(getByPlaceholderText('192.168.1.x'), '192.168.1.100');
    fireEvent.changeText(getByPlaceholderText('SHA-256 fingerprint from Windows'), 'ab'.repeat(32));
    fireEvent.changeText(getByLabelText('Session token'), 'test-token');
    fireEvent.press(getByText('Connect Manually'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(
      'Connection failed',
      'The connection attempt could not be completed. Check that Windows is running and try again.',
    ));
  });

  it('explains that an explicit HTTPS address cannot run in Expo Go', () => {
    const mockOnConnect = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <ConnectionScreen onConnect={mockOnConnect} nativeHttpsAvailable={false} allowInsecureHttp />,
    );

    fireEvent.press(getByText('Enter Address Manually'));
    fireEvent.changeText(getByPlaceholderText('192.168.1.x'), 'https://192.168.1.100:8443');
    fireEvent.press(getByText('Connect Manually'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Expo Go requires HTTP',
      'Enter the desktop as http://address:8080. Pinned HTTPS is available in the installed mobile app.',
    );
    expect(mockOnConnect).not.toHaveBeenCalled();
  });

  it('keeps manual entry collapsed until the user opens it', () => {
    const { getByText, queryByPlaceholderText } = render(<ConnectionScreen onConnect={jest.fn()} />);

    expect(queryByPlaceholderText('192.168.1.x')).toBeNull();

    fireEvent.press(getByText('Enter Address Manually'));

    expect(queryByPlaceholderText('192.168.1.x')).toBeTruthy();
  });
});
