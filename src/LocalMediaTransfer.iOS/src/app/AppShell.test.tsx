import type { ReactNode } from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import App from '../../App';
import { api } from '@/api/ApiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { nativeCapabilities } from '@/services/NativeCapabilities';

type NativeCapabilitiesMock = typeof nativeCapabilities & { available: boolean };

// Mock the API client
jest.mock('@/api/ApiClient', () => ({
  api: {
    setConfig: jest.fn(),
    setAuthenticationFailureHandler: jest.fn(),
    pingServer: jest.fn().mockResolvedValue(true),
    requestPairing: jest.fn().mockResolvedValue('approved'),
    pairingStatus: jest.fn().mockResolvedValue('approved'),
    logClientEvent: jest.fn().mockResolvedValue(undefined),
    url: 'http://192.168.1.50:8080',
    uploadToken: '',
  }
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return {
    Ionicons: () => <></>
  };
}, { virtual: true });

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}), { virtual: true });

jest.mock('@/services/NativeCapabilities', () => ({
  expectedServerEnvironment: jest.fn(() => 'production'),
  nativeCapabilities: {
    available: true,
    discover: jest.fn().mockResolvedValue([]),
    configureSecureConnection: jest.fn().mockResolvedValue(undefined),
    clearSecureConnection: jest.fn(),
    securityState: jest.fn().mockResolvedValue({ tlsVersion: 'TLS 1.3', certificateVerified: true }),
    cancel: jest.fn(),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('approved-device-credential'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(32).fill(7)),
}));

// Mock expo-camera used inside ConnectionScreen
jest.mock('expo-camera', () => {
  const React = require('react');
  return {
    useCameraPermissions: jest.fn().mockReturnValue([{ granted: true }, jest.fn()]),
    CameraView: ({ onBarcodeScanned }: { onBarcodeScanned: (event: { data: string }) => void }) => {
      const { TouchableOpacity, Text } = require('react-native');
      return (
        <TouchableOpacity testID="mock-camera" onPress={() => onBarcodeScanned({ data: 'http://192.168.1.5:8080/?token=abcxyz' })}>
          <Text>Mock Camera</Text>
        </TouchableOpacity>
      );
    }
  };
});

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
    SafeAreaView: ({ children }: { children: ReactNode }) => children,
  };
});

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getAssetsAsync: jest.fn().mockResolvedValue({ assets: [], hasNextPage: false, endCursor: '' }),
  getAlbumsAsync: jest.fn().mockResolvedValue([{ id: '1', title: 'Favorites' }]),
  SortBy: { creationTime: 'creationTime' },
  MediaType: { photo: 'photo', video: 'video' }
}));

async function renderApp() {
  const screen = render(<App />);
  await act(async () => {
    await new Promise(resolve => setImmediate(resolve));
  });
  return screen;
}

describe('App Routing Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeCapabilities as NativeCapabilitiesMock).available = true;
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'lmt_auto_connect') return Promise.resolve('false');
      return Promise.resolve(null);
    });
    (api.pingServer as jest.Mock).mockResolvedValue(true);
  });

  it('verifies the server and transitions to the dashboard', async () => {
    const { getByText, getByPlaceholderText, queryByText } = await renderApp();

    // Make sure we are on the ConnectionScreen initially
    expect(getByText('Connect to Desktop')).toBeTruthy();

    // Enter the secure endpoint, pinned fingerprint, and one-time QR token.
    fireEvent.press(getByText('Enter Address Manually'));
    const input = getByPlaceholderText('192.168.1.x');
    fireEvent.changeText(input, '192.168.1.50');
    fireEvent.changeText(getByPlaceholderText('SHA-256 fingerprint from Windows'), 'ab'.repeat(32));
    fireEvent.changeText(getByPlaceholderText('Session token from Windows'), 'qr-token');

    // Tap connect
    fireEvent.press(getByText('Connect'));

    await waitFor(() => expect(api.setConfig).toHaveBeenCalledWith('https://192.168.1.50:8443', 'qr-token'));
    expect(nativeCapabilities.configureSecureConnection).toHaveBeenCalledWith('https://192.168.1.50:8443', 'ab'.repeat(32));

    // Verify App state transitioned only after a successful health check
    await waitFor(() => {
      expect(getByText('Dashboard')).toBeTruthy();
    });

    // The ConnectionScreen should be gone
    expect(queryByText('Connect to Desktop')).toBeNull();
  });

  it('waits for the trusted credential before entering the dashboard after HTTPS pairing', async () => {
    (api.pingServer as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { getByText, getByPlaceholderText } = await renderApp();

    fireEvent.press(getByText('Enter Address Manually'));
    fireEvent.changeText(getByPlaceholderText('192.168.1.x'), '192.168.1.50');
    fireEvent.changeText(getByPlaceholderText('SHA-256 fingerprint from Windows'), 'ab'.repeat(32));
    fireEvent.changeText(getByPlaceholderText('Session token from Windows'), 'qr-token');
    fireEvent.press(getByText('Connect'));

    await waitFor(() => expect(api.requestPairing).toHaveBeenCalled());
    await waitFor(() => expect(getByText('Dashboard')).toBeTruthy());
    expect(api.pingServer).toHaveBeenNthCalledWith(2, { notifyUnauthorized: false });
    expect(api.pingServer).toHaveBeenNthCalledWith(3, { notifyUnauthorized: false });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('lmt_last_server', expect.stringContaining('"serverId"'));
  });

  it('does not include pairing URLs or credentials in diagnostic telemetry', async () => {
    (api.pingServer as jest.Mock).mockResolvedValue(false);
    const { getByText, getByPlaceholderText } = await renderApp();

    fireEvent.press(getByText('Enter Address Manually'));
    fireEvent.changeText(getByPlaceholderText('192.168.1.x'), '192.168.1.50');
    fireEvent.changeText(getByPlaceholderText('SHA-256 fingerprint from Windows'), 'ab'.repeat(32));
    fireEvent.changeText(getByPlaceholderText('Session token from Windows'), 'super-secret-qr-token');
    fireEvent.press(getByText('Connect'));

    await waitFor(() => expect(api.logClientEvent).toHaveBeenCalledWith(
      'WARN',
      'ios_https_pairing_failed',
      expect.any(String),
      { stage: 'qr_token_validation' },
    ));
    const serializedTelemetry = JSON.stringify((api.logClientEvent as jest.Mock).mock.calls);
    expect(serializedTelemetry).not.toContain('super-secret-qr-token');
    expect(serializedTelemetry).not.toContain('192.168.1.50');
    expect(serializedTelemetry).not.toContain('ab'.repeat(32));
  });

  it('does not send UDP discovery until the user explicitly enables it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = await renderApp();

    await waitFor(() => expect(screen.getByText('Enable Nearby Discovery')).toBeTruthy());
    expect(nativeCapabilities.discover).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Enable Nearby Discovery'));
    expect(alert.mock.calls.at(-1)?.[1]).toContain('both places');
    expect(alert.mock.calls.at(-1)?.[1]).toContain('Settings on Windows');
    const buttons = alert.mock.calls.at(-1)?.[2];
    const enableButton = Array.isArray(buttons) ? buttons[1] : undefined;
    await act(async () => {
      enableButton?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(nativeCapabilities.discover).toHaveBeenCalled());
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('lmt_nearby_discovery', 'true');
    alert.mockRestore();
  });

  it('does not automatically reconnect to a remembered desktop on app launch', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'lmt_last_server') return Promise.resolve(JSON.stringify({
        version: 3,
        environment: 'production',
        serverId: 'desktop-1',
        httpsUrl: 'https://192.168.1.50:8443',
        certificateFingerprint: 'cd'.repeat(32),
      }));
      return Promise.resolve(null);
    });

    const screen = await renderApp();

    expect(screen.getByText('Connect to Desktop')).toBeTruthy();
    expect(nativeCapabilities.configureSecureConnection).not.toHaveBeenCalled();
  });

  it('reconnects a trusted nearby desktop only after a tap and preserves trust on disconnect', async () => {
    const saved = {
      version: 3,
      environment: 'production',
      serverId: 'desktop-1',
      httpsUrl: 'https://192.168.1.20:8443',
      certificateFingerprint: 'cd'.repeat(32),
    };
    (nativeCapabilities.discover as jest.Mock).mockResolvedValue([{
      serverId: 'desktop-1',
      name: 'Trusted Desktop',
      address: '192.168.1.50',
      httpsPort: 8443,
      certificateFingerprint: 'cd'.repeat(32),
      approvalRequired: true,
      environment: 'production',
    }]);
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'lmt_nearby_discovery') return Promise.resolve('true');
      if (key === 'lmt_last_server') return Promise.resolve(JSON.stringify(saved));
      return Promise.resolve(null);
    });

    const screen = await renderApp();
    expect(await screen.findByText('Trusted Desktop')).toBeTruthy();
    expect(nativeCapabilities.configureSecureConnection).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Trusted Desktop'));

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeTruthy());
    expect(nativeCapabilities.configureSecureConnection).toHaveBeenCalledWith(
      'https://192.168.1.50:8443',
      'cd'.repeat(32),
    );
    expect(api.setConfig).toHaveBeenCalledWith(
      'https://192.168.1.50:8443',
      'approved-device-credential',
    );

    fireEvent.press(screen.getByLabelText('Disconnect'));

    await waitFor(() => expect(screen.getByText('Connect to Desktop')).toBeTruthy());
    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith('lmt_last_server');
    expect(screen.queryByTestId('mock-camera')).toBeNull();
  });

  it('opens the QR scanner from an untrusted discovered desktop prompt', async () => {
    (nativeCapabilities.discover as jest.Mock).mockResolvedValueOnce([{
      serverId: 'new-desktop',
      name: 'New Desktop',
      address: '192.168.1.25',
      httpsPort: 8443,
      certificateFingerprint: 'ef'.repeat(32),
      approvalRequired: true,
      environment: 'production',
    }]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = await renderApp();

    fireEvent.press(await screen.findByText('Enable Nearby Discovery'));
    const enableButtons = alert.mock.calls.at(-1)?.[2];
    await act(async () => {
      if (Array.isArray(enableButtons)) enableButtons[1]?.onPress?.();
      await Promise.resolve();
    });
    fireEvent.press(await screen.findByText('New Desktop'));

    await waitFor(() => expect(alert).toHaveBeenLastCalledWith(
      'Scan QR to trust this desktop',
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ onDismiss: expect.any(Function) }),
    ));
    const scanButtons = alert.mock.calls.at(-1)?.[2];
    await act(async () => {
      if (Array.isArray(scanButtons)) scanButtons[1]?.onPress?.();
      await Promise.resolve();
    });

    expect(await screen.findByTestId('mock-camera')).toBeTruthy();
    alert.mockRestore();
  });

  it('lets Expo Go connect by HTTP without enabling the installed-app HTTPS setting', async () => {
    (nativeCapabilities as NativeCapabilitiesMock).available = false;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = await renderApp();

    expect(await screen.findByText('Expo Go uses HTTP and the compatibility uploader. Install the IPA for encrypted, faster native transfers.')).toBeTruthy();
    fireEvent.press(await screen.findByText('Scan QR Code'));
    fireEvent.press(await screen.findByTestId('mock-camera'));

    await waitFor(() => expect(api.setConfig).toHaveBeenCalledWith('http://192.168.1.5:8080', 'abcxyz'));
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeTruthy());
    expect(alert).not.toHaveBeenCalledWith(
      'HTTP disabled',
      expect.any(String),
      expect.anything(),
      expect.anything(),
    );
    alert.mockRestore();
  });

  it('clears stale trusted server state and asks for QR pairing when the desktop rejects reconnect', async () => {
    (api.pingServer as jest.Mock).mockResolvedValue(false);
    (nativeCapabilities.discover as jest.Mock).mockResolvedValueOnce([{
      serverId: 'desktop-1',
      name: 'Desktop',
      address: '192.168.1.50',
      httpsPort: 8443,
      certificateFingerprint: 'cd'.repeat(32),
      approvalRequired: true,
      environment: 'production',
    }]);
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'lmt_auto_connect') return Promise.resolve('false');
      if (key === 'lmt_last_server') return Promise.resolve(JSON.stringify({
        version: 3,
        environment: 'production',
        serverId: 'desktop-1',
        httpsUrl: 'https://192.168.1.20:8443',
        certificateFingerprint: 'cd'.repeat(32),
      }));
      return Promise.resolve(null);
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = await renderApp();

    fireEvent.press(await screen.findByText('Enable Nearby Discovery'));
    const enableButtons = alert.mock.calls.at(-1)?.[2];
    await act(async () => {
      if (Array.isArray(enableButtons)) enableButtons[1]?.onPress?.();
      await Promise.resolve();
    });
    fireEvent.press(await screen.findByText('Desktop'));

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith('lmt_last_server');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith('lmt_device_credential');
    expect(alert).toHaveBeenLastCalledWith(
      'Could not reconnect',
      expect.stringContaining('Your saved trust was kept'),
      expect.any(Array),
      expect.objectContaining({ onDismiss: expect.any(Function) }),
    );
    const repairButtons = alert.mock.calls.at(-1)?.[2];
    await act(async () => {
      if (Array.isArray(repairButtons)) repairButtons[1]?.onPress?.();
      await new Promise(resolve => setImmediate(resolve));
    });
    expect(await screen.findByTestId('mock-camera')).toBeTruthy();
    alert.mockRestore();
  });

  it('clears the saved trusted server when its Keychain credential is missing', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (nativeCapabilities.discover as jest.Mock).mockResolvedValueOnce([{
      serverId: 'desktop-1',
      name: 'Desktop',
      address: '192.168.1.50',
      httpsPort: 8443,
      certificateFingerprint: 'cd'.repeat(32),
      approvalRequired: true,
      environment: 'production',
    }]);
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'lmt_auto_connect') return Promise.resolve('false');
      if (key === 'lmt_last_server') return Promise.resolve(JSON.stringify({
        version: 3,
        environment: 'production',
        serverId: 'desktop-1',
        httpsUrl: 'https://192.168.1.20:8443',
        certificateFingerprint: 'cd'.repeat(32),
      }));
      return Promise.resolve(null);
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = await renderApp();

    fireEvent.press(await screen.findByText('Enable Nearby Discovery'));
    const enableButtons = alert.mock.calls.at(-1)?.[2];
    await act(async () => {
      if (Array.isArray(enableButtons)) enableButtons[1]?.onPress?.();
      await Promise.resolve();
    });
    fireEvent.press(await screen.findByText('Desktop'));

    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalledWith('lmt_last_server'));
    expect(alert).toHaveBeenLastCalledWith(
      'Pairing required',
      expect.stringContaining('Scan the Windows QR again'),
      expect.any(Array),
      expect.objectContaining({ onDismiss: expect.any(Function) }),
    );
    alert.mockRestore();
  });
});
