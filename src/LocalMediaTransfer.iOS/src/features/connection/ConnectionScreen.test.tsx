import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ConnectionScreen from './ConnectionScreen';
import { useCameraPermissions } from 'expo-camera';

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

  it('keeps nearby UDP discovery disabled by default', () => {
    const { getByText, queryByText } = render(<ConnectionScreen onConnect={jest.fn()} nativeHttpsAvailable />);

    expect(getByText('Nearby discovery is off. Enable it here and in Local Media Transfer Settings on Windows. QR and manual connection remain available.')).toBeTruthy();
    expect(queryByText('Refresh')).toBeNull();
  });

  it('shows nearby discovery as unavailable in Expo Go', () => {
    const { getByText } = render(<ConnectionScreen onConnect={jest.fn()} nativeHttpsAvailable={false} allowInsecureHttp />);

    expect(getByText('Nearby discovery needs the installed iOS app. Expo Go can still connect by QR code or manual HTTP address.')).toBeTruthy();
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

    expect(getByText('Expo Go uses HTTP and the compatibility uploader. Install the IPA for encrypted, faster native transfers.')).toBeTruthy();
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
    expect(getByText("Approve this iPhone in Local Media Transfer on Ron's PC. Keep this screen open.")).toBeTruthy();
  });

  it('extracts URL base and token from a QR code scan', async () => {
    const mockOnConnect = jest.fn();
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={mockOnConnect} />);

    // Tap "Scan QR Code" button
    fireEvent.press(getByText('Scan QR Code'));

    // Find the mock camera we created and trigger the fake scan
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);

    // Verify onConnect was called correctly
    expect(mockOnConnect).toHaveBeenCalledWith('http://192.168.1.5:8080', 'abcxyz');
  });

  it('ignores duplicate QR scan callbacks from the same camera session', async () => {
    const mockOnConnect = jest.fn();
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={mockOnConnect} />);

    fireEvent.press(getByText('Scan QR Code'));
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

    fireEvent.press(getByText('Scan QR Code'));
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

    fireEvent.press(getByText('Scan QR Code'));
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);

    await waitFor(() => expect(mockOnConnect).toHaveBeenCalledTimes(1));

    fireEvent.press(getByText('Scan QR Code'));
    fireEvent.press(await waitFor(() => getByTestId('mock-camera')));

    await waitFor(() => expect(mockOnConnect).toHaveBeenCalledTimes(2));
  });

  it('unlocks the QR scanner when an async connection attempt rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mockOnConnect = jest.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    const { getByText, getByTestId } = render(<ConnectionScreen onConnect={mockOnConnect} />);

    fireEvent.press(getByText('Scan QR Code'));
    const mockCamera = await waitFor(() => getByTestId('mock-camera'));
    fireEvent.press(mockCamera);

    await waitFor(() => expect(mockOnConnect).toHaveBeenCalledTimes(1));

    fireEvent.press(getByText('Scan QR Code'));
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

    fireEvent.press(getByText('Scan QR Code'));
    fireEvent.press(await waitFor(() => getByTestId('mock-camera')));

    expect(alertSpy).toHaveBeenCalledWith(
      'Update iPhone app',
      'This Windows QR code uses pairing version 4. Install the latest iPhone app and scan again.',
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
    fireEvent.press(getByText('Connect'));

    expect(queryByPlaceholderText('SHA-256 fingerprint from Windows')).toBeNull();
    expect(mockOnConnect).toHaveBeenCalledWith('http://192.168.1.100:8080', '', undefined);
  });

  it('shows a recoverable message when camera permission cannot be requested', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false },
      jest.fn().mockRejectedValue(new Error('camera service unavailable')),
    ]);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText } = render(<ConnectionScreen onConnect={jest.fn()} />);

    fireEvent.press(getByText('Scan QR Code'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(
      'Camera unavailable',
      'The camera could not be opened. Try again or enter the desktop address manually.',
    ));
  });

  it('keeps a bare manual IP on pinned HTTPS in the installed app', () => {
    const mockOnConnect = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <ConnectionScreen onConnect={mockOnConnect} nativeHttpsAvailable />,
    );

    fireEvent.press(getByText('Enter Address Manually'));
    fireEvent.changeText(getByPlaceholderText('192.168.1.x'), '192.168.1.100');
    fireEvent.press(getByText('Connect'));

    expect(mockOnConnect).toHaveBeenCalledWith('https://192.168.1.100:8443', '', undefined);
  });

  it('handles a rejected manual connection without an unhandled promise', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const mockOnConnect = jest.fn().mockRejectedValue(new Error('connection setup failed'));
    const { getByPlaceholderText, getByText } = render(
      <ConnectionScreen onConnect={mockOnConnect} nativeHttpsAvailable />,
    );

    fireEvent.press(getByText('Enter Address Manually'));
    fireEvent.changeText(getByPlaceholderText('192.168.1.x'), '192.168.1.100');
    fireEvent.press(getByText('Connect'));

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
    fireEvent.press(getByText('Connect'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Expo Go requires HTTP',
      'Enter the desktop as http://address:8080. Pinned HTTPS is available in the installed iOS app.',
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
