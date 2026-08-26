import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/api/ApiClient';
import { connectionStorageKeys } from '@/config/storageKeys';
import { MediaAsset } from '@/services/MediaScanner';
import { nativeCapabilities } from '@/services/NativeCapabilities';
import AppNavigator from './AppNavigator';
import { useAlertGate } from './hooks/useAlertGate';
import { useConnectionController } from './hooks/useConnectionController';
import { useConnectionHealth } from './hooks/useConnectionHealth';
import { useConnectionPreferences } from './hooks/useConnectionPreferences';
import { useDiscoveryController } from './hooks/useDiscoveryController';
import { usePairingController } from './hooks/usePairingController';
import { useTrustedConnection } from './hooks/useTrustedConnection';
import { useTransferPreferences } from './hooks/useTransferPreferences';
import { ScreenState } from './types';
import { PreparationMode } from '@/services/upload/types';

export default function AppShell() {
  const [appState, setAppState] = React.useState<ScreenState>('connection');
  const [selectedAssets, setSelectedAssets] = React.useState<MediaAsset[]>([]);
  const [qrScanRequestId, setQrScanRequestId] = React.useState(0);
  const [activeTransferPreferences, setActiveTransferPreferences] = React.useState<{
    preparationMode: PreparationMode;
    skipExactDuplicates: boolean;
    includeAdditionalMediaComponents: boolean;
  }>({
    preparationMode: 'prepare-first',
    skipExactDuplicates: true,
    includeAdditionalMediaComponents: false,
  });
  const connectionAttemptRef = React.useRef(false);

  const {
    isServerConnected,
    setIsServerConnected,
    pairingDesktopName,
    setPairingDesktopName,
    connectionSecurity,
    setConnectionSecurity,
    isConnecting,
    setIsConnecting,
    markDisconnected,
    markHttpConnected,
    markSecureConnected,
  } = useConnectionController();

  const nativeHttpsAvailable = nativeCapabilities.available;
  const { showAlertOnce, confirmOnce } = useAlertGate();
  const reportPreferencePersistenceError = React.useCallback(() => {
    showAlertOnce(
      'Setting not saved',
      'The choice is active for this session, but it could not be saved for the next time you open the app.',
    );
  }, [showAlertOnce]);
  const {
    nearbyDiscoveryEnabled,
    setNearbyDiscoveryEnabled,
    allowInsecureHttp,
    persistNearbyDiscovery,
    persistAllowInsecureHttp,
  } = useConnectionPreferences({ onPersistenceError: reportPreferencePersistenceError });
  const effectiveAllowInsecureHttp = allowInsecureHttp || !nativeHttpsAvailable;
  const {
    preparationMode,
    persistPreparationMode,
    skipExactDuplicates,
    persistSkipExactDuplicates,
    includeAdditionalMediaComponents,
    persistIncludeAdditionalMediaComponents,
  } = useTransferPreferences({ onPersistenceError: reportPreferencePersistenceError });
  const {
    discoveredServers,
    isDiscovering,
    discoveryFailed,
    performDiscovery,
    discoverServers,
    clearDiscoveredServers,
  } = useDiscoveryController({ enabled: nearbyDiscoveryEnabled });

  const requestQrScan = React.useCallback(() => {
    setAppState('connection');
    setTimeout(() => setQrScanRequestId(value => value + 1), 0);
  }, []);
  const resetConnectionAttempt = React.useCallback(() => {
    connectionAttemptRef.current = false;
    setIsConnecting(false);
    setPairingDesktopName(null);
  }, [setIsConnecting, setPairingDesktopName]);
  const { getDeviceIdentity, connectTrusted } = useTrustedConnection({
    setAppState,
    setConnectionSecurity,
    setIsServerConnected,
    setIsConnecting,
    setPairingDesktopName,
    showAlertOnce,
    requestQrScan,
    resetConnectionAttempt,
  });

  const {
    handleConnect,
    handleDiscoveredServer,
    updateAllowInsecureHttp,
    explainUnencryptedHttp,
    explainNearbyDiscovery,
    resetHttpSessionApproval,
  } = usePairingController({
    nativeHttpsAvailable,
    effectiveAllowInsecureHttp,
    connectionSecurity,
    setAppState,
    setIsConnecting,
    setPairingDesktopName,
    markDisconnected,
    markHttpConnected,
    markSecureConnected,
    getDeviceIdentity,
    connectTrusted,
    showAlertOnce,
    confirmOnce,
    requestQrScan,
    persistAllowInsecureHttp,
    connectionAttemptRef,
  });

  React.useEffect(() => {
    if (appState === 'connection' && nearbyDiscoveryEnabled) performDiscovery();
  }, [appState, nearbyDiscoveryEnabled, performDiscovery]);

  React.useEffect(() => {
    api.setAuthenticationFailureHandler(() => {
      api.setConfig('', '');
      nativeCapabilities.clearSecureConnection();
      markDisconnected();
      AsyncStorage.removeItem(connectionStorageKeys.lastServer()).catch(() => undefined);
      setQrScanRequestId(0);
      setAppState('connection');
    });
    return () => api.setAuthenticationFailureHandler(null);
  }, [markDisconnected]);

  const { status: connectionHealthStatus, retryConnection } = useConnectionHealth({
    appState,
    setIsServerConnected,
  });

  const handleTransfer = React.useCallback((assets: MediaAsset[]) => {
    setActiveTransferPreferences({
      preparationMode,
      skipExactDuplicates,
      includeAdditionalMediaComponents,
    });
    setSelectedAssets(assets);
    setAppState('transfer');
  }, [includeAdditionalMediaComponents, preparationMode, skipExactDuplicates]);

  const updateNearbyDiscovery = React.useCallback((enabled: boolean) => {
    if (!enabled) {
      setNearbyDiscoveryEnabled(false);
      clearDiscoveredServers();
      persistNearbyDiscovery(false);
      return;
    }
    showAlertOnce(
      'Enable nearby discovery?',
      'Enable Nearby Desktop Discovery in both places: here on iPhone and in Local Media Transfer > Settings on Windows. The app sends credential-free UDP requests on this Wi-Fi network; QR pairing and Windows approval are still required for first trust.',
      [
        { text: 'Keep disabled', style: 'cancel' },
        { text: 'Enable discovery', onPress: () => persistNearbyDiscovery(true) },
      ],
    );
  }, [clearDiscoveredServers, persistNearbyDiscovery, setNearbyDiscoveryEnabled, showAlertOnce]);

  const handleDisconnect = React.useCallback(async () => {
    api.setConfig('', '');
    nativeCapabilities.clearSecureConnection();
    resetHttpSessionApproval();
    markDisconnected();
    setQrScanRequestId(0);
    setAppState('connection');
  }, [markDisconnected, resetHttpSessionApproval]);

  return (
    <AppNavigator
      appState={appState}
      selectedAssets={selectedAssets}
      isServerConnected={isServerConnected}
      isConnecting={isConnecting}
      pairingDesktopName={pairingDesktopName}
      connectionSecurity={connectionSecurity}
      connectionHealthStatus={connectionHealthStatus}
      discoveredServers={discoveredServers}
      isDiscovering={isDiscovering}
      discoveryFailed={discoveryFailed}
      nearbyDiscoveryEnabled={nearbyDiscoveryEnabled}
      allowInsecureHttp={effectiveAllowInsecureHttp}
      nativeHttpsAvailable={nativeHttpsAvailable}
      preparationMode={appState === 'transfer'
        ? activeTransferPreferences.preparationMode
        : preparationMode}
      skipExactDuplicates={appState === 'transfer'
        ? activeTransferPreferences.skipExactDuplicates
        : skipExactDuplicates}
      includeAdditionalMediaComponents={appState === 'transfer'
        ? activeTransferPreferences.includeAdditionalMediaComponents
        : includeAdditionalMediaComponents}
      scanRequestId={qrScanRequestId}
      onConnect={handleConnect}
      onConnectDiscovered={handleDiscoveredServer}
      onAllowInsecureHttpChange={updateAllowInsecureHttp}
      onExplainUnencryptedHttp={explainUnencryptedHttp}
      onExplainNearbyDiscovery={explainNearbyDiscovery}
      onEnableNearbyDiscovery={() => updateNearbyDiscovery(true)}
      onRefreshDiscovery={discoverServers}
      onNearbyDiscoveryChange={updateNearbyDiscovery}
      onPreparationModeChange={persistPreparationMode}
      onSkipExactDuplicatesChange={persistSkipExactDuplicates}
      onIncludeAdditionalMediaComponentsChange={persistIncludeAdditionalMediaComponents}
      onOpenPicker={() => setAppState('picker')}
      onTransfer={handleTransfer}
      onCancelPicker={() => setAppState('dashboard')}
      onCancelTransfer={() => setAppState('dashboard')}
      onCompleteTransfer={() => setAppState('dashboard')}
      onDisconnect={handleDisconnect}
      onRetryConnection={retryConnection}
    />
  );
}
