import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import AppNavigator, { AppNavigatorProps, pageTransitionMotion } from './AppNavigator';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/features/transfer/TransferProgressScreen', () => ({
  __esModule: true,
  default: ({ onTerminalStateChange }: { onTerminalStateChange?: (finished: boolean) => void }) => {
    const { Text, TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity onPress={() => onTerminalStateChange?.(true)}>
        <Text>Finish mock transfer</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('@/features/connection/ConnectionScreen', () => ({ __esModule: true, default: () => <></> }));
jest.mock('@/features/history/HistoryScreen', () => ({ __esModule: true, default: () => <></> }));
jest.mock('@/features/home/HomeScreen', () => ({ __esModule: true, default: () => <></> }));
jest.mock('@/features/media/MediaPickerScreen', () => ({ __esModule: true, default: () => <></> }));
jest.mock('@/features/settings/SettingsScreen', () => ({ __esModule: true, default: () => <></> }));

function props(): AppNavigatorProps {
  return {
    navigation: {
      appState: 'transfer',
      selectedAssets: [],
      scanRequestId: 0,
      onOpenPicker: jest.fn(),
      onTransfer: jest.fn(),
      onCancelPicker: jest.fn(),
      onCancelTransfer: jest.fn(),
      onCompleteTransfer: jest.fn(),
      onSelectTab: jest.fn(),
    },
    connection: {
      isServerConnected: true,
      isConnecting: false,
      pairingDesktopName: null,
      connectionSecurity: { mode: 'https', certificateVerified: true },
      connectionHealthStatus: 'connected',
      savedReceiver: null,
      onConnect: jest.fn().mockResolvedValue(true),
      onConnectDiscovered: jest.fn().mockResolvedValue(undefined),
      onConnectTrusted: jest.fn().mockResolvedValue(undefined),
      onDisconnect: jest.fn().mockResolvedValue(undefined),
      onRetryConnection: jest.fn(),
    },
    preferences: {
      nearbyDiscoveryEnabled: false,
      allowInsecureHttp: false,
      nativeHttpsAvailable: true,
      preparationMode: 'prepare-first',
      skipExactDuplicates: true,
      includeAdditionalMediaComponents: false,
      onAllowInsecureHttpChange: jest.fn().mockResolvedValue(undefined),
      onExplainUnencryptedHttp: jest.fn(),
      onExplainNearbyDiscovery: jest.fn(),
      onNearbyDiscoveryChange: jest.fn(),
      onPreparationModeChange: jest.fn(),
      onSkipExactDuplicatesChange: jest.fn(),
      onIncludeAdditionalMediaComponentsChange: jest.fn(),
    },
    discovery: {
      discoveredServers: [],
      isDiscovering: false,
      discoveryFailed: false,
      onEnableNearbyDiscovery: jest.fn(),
      onRefreshDiscovery: jest.fn(),
    },
    history: {
      items: [],
      loading: false,
      error: null,
      onRefresh: jest.fn(),
      onClear: jest.fn(),
    },
  };
}

describe('AppNavigator transfer tab protection', () => {
  it('uses a brief lift normally and fade-only motion when Reduce Motion is enabled', () => {
    expect(pageTransitionMotion(false)).toEqual({ duration: 180, translateY: 5 });
    expect(pageTransitionMotion(true)).toEqual({ duration: 120, translateY: 0 });
  });

  it('unlocks tabs at terminal completion and treats a tab choice as leaving the summary', () => {
    const input = props();
    const screen = render(<AppNavigator {...input} />);

    expect(screen.getByLabelText('History. Transfer in progress').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByText('Finish mock transfer'));

    expect(screen.getByLabelText('History').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText('History'));
    expect(input.navigation.onCompleteTransfer).toHaveBeenCalledTimes(1);
    expect(input.navigation.onSelectTab).toHaveBeenCalledWith('history');
  });
});
