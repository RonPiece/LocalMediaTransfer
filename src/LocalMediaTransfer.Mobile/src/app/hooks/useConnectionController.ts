import React from 'react';
import { ConnectionSecurityState } from '../types';

export type ConnectionLifecycle =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'waitingForApproval'; desktopName: string }
  | { status: 'connected'; transport: 'https' | 'http' }
  | { status: 'disconnected' };

export type ConnectionControllerState = {
  connectionLifecycle: ConnectionLifecycle;
  isServerConnected: boolean;
  isConnecting: boolean;
  pairingDesktopName: string | null;
  connectionSecurity: ConnectionSecurityState;
};

export type ConnectionControllerAction =
  | { type: 'connecting'; value: boolean }
  | { type: 'serverConnected'; value: boolean }
  | { type: 'pairingDesktop'; value: string | null }
  | { type: 'security'; value: ConnectionSecurityState }
  | { type: 'connectedSecure'; value: { tlsVersion?: string; certificateVerified: boolean } }
  | { type: 'connectedHttp' }
  | { type: 'disconnected' };

export const disconnectedSecurity: ConnectionSecurityState = {
  mode: 'disconnected',
  certificateVerified: false,
};

export const initialConnectionControllerState: ConnectionControllerState = {
  connectionLifecycle: { status: 'idle' },
  isServerConnected: false,
  isConnecting: false,
  pairingDesktopName: null,
  connectionSecurity: disconnectedSecurity,
};

export function connectionControllerReducer(state: ConnectionControllerState, action: ConnectionControllerAction): ConnectionControllerState {
  switch (action.type) {
    case 'connecting':
      return {
        ...state,
        connectionLifecycle: action.value ? { status: 'connecting' } : state.connectionLifecycle,
        isConnecting: action.value,
      };
    case 'serverConnected':
      return {
        ...state,
        connectionLifecycle: action.value
          ? state.connectionLifecycle
          : { status: 'disconnected' },
        isServerConnected: action.value,
      };
    case 'pairingDesktop':
      return {
        ...state,
        connectionLifecycle: action.value
          ? { status: 'waitingForApproval', desktopName: action.value }
          : state.connectionLifecycle,
        pairingDesktopName: action.value,
      };
    case 'security':
      return { ...state, connectionSecurity: action.value };
    case 'connectedSecure':
      return {
        ...state,
        connectionLifecycle: { status: 'connected', transport: 'https' },
        isServerConnected: true,
        isConnecting: false,
        pairingDesktopName: null,
        connectionSecurity: {
          mode: 'https',
          tlsVersion: action.value.tlsVersion,
          certificateVerified: action.value.certificateVerified,
        },
      };
    case 'connectedHttp':
      return {
        ...state,
        connectionLifecycle: { status: 'connected', transport: 'http' },
        isServerConnected: true,
        isConnecting: false,
        pairingDesktopName: null,
        connectionSecurity: { mode: 'http', certificateVerified: false },
      };
    case 'disconnected':
      return {
        ...state,
        connectionLifecycle: { status: 'disconnected' },
        isServerConnected: false,
        isConnecting: false,
        pairingDesktopName: null,
        connectionSecurity: disconnectedSecurity,
      };
    default:
      return state;
  }
}

export function useConnectionController() {
  const [state, dispatch] = React.useReducer(connectionControllerReducer, initialConnectionControllerState);

  // These actions feed other hooks' dependency arrays. Keep their identities
  // stable so a connection-state render cannot restart pairing/reconnect effects.
  const setIsConnecting = React.useCallback((value: boolean) => dispatch({ type: 'connecting', value }), []);
  const setIsServerConnected = React.useCallback((value: boolean) => dispatch({ type: 'serverConnected', value }), []);
  const setPairingDesktopName = React.useCallback((value: string | null) => dispatch({ type: 'pairingDesktop', value }), []);
  const setConnectionSecurity = React.useCallback((value: ConnectionSecurityState) => dispatch({ type: 'security', value }), []);
  const markSecureConnected = React.useCallback(
    (value: { tlsVersion?: string; certificateVerified: boolean }) => dispatch({ type: 'connectedSecure', value }),
    [],
  );
  const markHttpConnected = React.useCallback(() => dispatch({ type: 'connectedHttp' }), []);
  const markDisconnected = React.useCallback(() => dispatch({ type: 'disconnected' }), []);

  return {
    ...state,
    setIsConnecting,
    setIsServerConnected,
    setPairingDesktopName,
    setConnectionSecurity,
    markSecureConnected,
    markHttpConnected,
    markDisconnected,
  };
}
