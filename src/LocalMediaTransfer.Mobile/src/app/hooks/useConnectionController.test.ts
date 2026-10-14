import {
  connectionControllerReducer,
  initialConnectionControllerState,
  useConnectionController,
} from './useConnectionController';
import { act, renderHook } from '@testing-library/react-native';

describe('connectionControllerReducer', () => {
  it('models HTTPS, HTTP, connecting, and disconnected states explicitly', () => {
    const connecting = connectionControllerReducer(initialConnectionControllerState, {
      type: 'connecting',
      value: true,
    });
    expect(connecting.isConnecting).toBe(true);
    expect(connecting.connectionLifecycle).toEqual({ status: 'connecting' });

    const waiting = connectionControllerReducer(connecting, {
      type: 'pairingDesktop',
      value: 'Desktop',
    });
    expect(waiting.connectionLifecycle).toEqual({ status: 'waitingForApproval', desktopName: 'Desktop' });
    expect(waiting.pairingDesktopName).toBe('Desktop');

    const secure = connectionControllerReducer(waiting, {
      type: 'connectedSecure',
      value: { tlsVersion: 'TLS 1.3', certificateVerified: true },
    });
    expect(secure.isServerConnected).toBe(true);
    expect(secure.isConnecting).toBe(false);
    expect(secure.pairingDesktopName).toBeNull();
    expect(secure.connectionLifecycle).toEqual({ status: 'connected', transport: 'https' });
    expect(secure.connectionSecurity).toEqual({
      mode: 'https',
      tlsVersion: 'TLS 1.3',
      certificateVerified: true,
    });

    const http = connectionControllerReducer(secure, { type: 'connectedHttp' });
    expect(http.isServerConnected).toBe(true);
    expect(http.connectionLifecycle).toEqual({ status: 'connected', transport: 'http' });
    expect(http.connectionSecurity).toEqual({ mode: 'http', certificateVerified: false });

    const disconnected = connectionControllerReducer(http, { type: 'disconnected' });
    expect(disconnected.isServerConnected).toBe(false);
    expect(disconnected.isConnecting).toBe(false);
    expect(disconnected.pairingDesktopName).toBeNull();
    expect(disconnected.connectionLifecycle).toEqual({ status: 'disconnected' });
    expect(disconnected.connectionSecurity).toEqual({ mode: 'disconnected', certificateVerified: false });
  });
});

describe('useConnectionController', () => {
  it('keeps action identities stable across connection-state renders', () => {
    const { result } = renderHook(() => useConnectionController());
    const initialActions = {
      setIsConnecting: result.current.setIsConnecting,
      setIsServerConnected: result.current.setIsServerConnected,
      setPairingDesktopName: result.current.setPairingDesktopName,
      setConnectionSecurity: result.current.setConnectionSecurity,
      markSecureConnected: result.current.markSecureConnected,
      markHttpConnected: result.current.markHttpConnected,
      markDisconnected: result.current.markDisconnected,
    };

    act(() => result.current.setIsConnecting(true));

    expect(result.current).toEqual(expect.objectContaining(initialActions));
  });
});
