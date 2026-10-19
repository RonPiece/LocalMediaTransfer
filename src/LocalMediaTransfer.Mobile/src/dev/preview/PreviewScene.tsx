import React from 'react';
import { Alert, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IdleTransfers } from '@/app/AppNavigator';
import type { MainTab } from '@/app/types';
import { BottomTabBar } from '@/components/ui';
import { ConnectionScreenView } from '@/features/connection/ConnectionScreen';
import { useManualConnection } from '@/features/connection/hooks/useManualConnection';
import HomeScreen from '@/features/home/HomeScreen';
import HistoryScreen, { SessionDetails } from '@/features/history/HistoryScreen';
import { HistoryProblemDetailsModal } from '@/features/dashboard/components/HistoryProblemDetailsModal';
import { ConnectionDetailsModal } from '@/features/dashboard/components/ConnectionDetailsModal';
import SettingsScreen from '@/features/settings/SettingsScreen';
import { TransferProgressView, TransferPresentation } from '@/features/transfer/TransferProgressScreen';
import type { PreparationMode } from '@/services/upload/types';
import { sampleActiveConnection, sampleDiscoveredServers, sampleHistory, sampleMedia, sampleSavedReceiver, transferFixture } from './fixtures';
import { PreviewScenario, PreviewScreen } from './scenarios';
import { PreviewMediaPicker } from './PreviewMediaPicker';

const secure = { mode: 'https', certificateVerified: true, tlsVersion: 'TLS 1.3' } as const;
const disconnected = { mode: 'disconnected', certificateVerified: false } as const;

function PreviewConnection({ id, go }: { id: string; go: (screen: PreviewScreen, state?: string) => void }) {
  const [isScanning, setScanning] = React.useState(id === 'connect-qr');
  const [nearby, setNearby] = React.useState(id !== 'connect-offline');
  const [recovered, setRecovered] = React.useState(false);
  const [manualOpen, setManualOpen] = React.useState(id === 'connect-manual');
  const onConnect = async () => { go('connect', 'connected'); return true; };
  const manualConnection = useManualConnection({ onConnect, nativeHttpsAvailable: true });
  const qrScanner = {
    isScanning, startScanning: async () => setScanning(true), stopScanning: () => setScanning(false),
    handleBarCodeScanned: () => { setScanning(false); go('connect', 'pairing'); },
  };
  const cameraContent = <View className="flex-1 items-center justify-center bg-black">
    <Ionicons name="qr-code-outline" size={120} color="#B7C7D8" />
    <Text style={{ color: '#B7C7D8', marginTop: 160 }}>Sample camera · no camera access</Text>
  </View>;
  return <ConnectionScreenView onConnect={onConnect} manualConnection={{ ...manualConnection,
    manualEntryOpen: manualOpen, toggleManualEntry: () => setManualOpen(value => !value) }}
    qrScanner={qrScanner} cameraContent={cameraContent} nativeHttpsAvailable
    isConnecting={id === 'connect-pairing'} pairingDesktopName={id === 'connect-pairing' ? 'Studio Desktop' : null}
    nearbyDiscoveryEnabled={nearby} onEnableNearbyDiscovery={() => setNearby(true)}
    isDiscovering={id === 'connect-searching'} discoveryFailed={id === 'connect-error' && !recovered}
    onRefreshDiscovery={() => setRecovered(true)} isConnected={id === 'connect-connected'}
    activeConnection={id === 'connect-connected' ? sampleActiveConnection : null}
    onDisconnect={async () => go('connect', 'offline')}
    onConnectTrusted={async () => { await onConnect(); }} onConnectDiscovered={async () => { await onConnect(); }}
    savedReceiver={id === 'connect-trusted' || id === 'connect-connected' ? sampleSavedReceiver : null}
    discoveredServers={id === 'connect-found' || id === 'connect-connected' || recovered ? sampleDiscoveredServers : []} />;
}

function PreviewTransfer({ id, progress, onDone, onCancel }: {
  id: string; progress: number; onDone: () => void; onCancel: () => void;
}) {
  const [showAllResults, setShowAllResults] = React.useState(id === 'transfer-results' || id === 'transfer-errors');
  const [showOnlyErrors, setShowOnlyErrors] = React.useState(id === 'transfer-errors');
  const controller: TransferPresentation = {
    ...transferFixture(id, progress), showAllResults, setShowAllResults, showOnlyErrors, setShowOnlyErrors,
    cancelTransfer: onCancel,
  };
  return <TransferProgressView assets={sampleMedia} onCancel={onCancel} onComplete={onDone} controller={controller} />;
}

function PreviewSettings({ connected }: { connected: boolean }) {
  const [nearby, setNearby] = React.useState(false);
  const [http, setHttp] = React.useState(false);
  const [mode, setMode] = React.useState<PreparationMode>('streaming');
  const [duplicates, setDuplicates] = React.useState(true);
  const [components, setComponents] = React.useState(false);
  return <SettingsScreen isConnected={connected} connectionSecurity={connected ? secure : disconnected}
    nativeHttpsAvailable nearbyDiscoveryEnabled={nearby} allowInsecureHttp={http}
    preparationMode={mode} skipExactDuplicates={duplicates} includeAdditionalMediaComponents={components}
    onNearbyDiscoveryChange={setNearby} onAllowInsecureHttpChange={setHttp}
    onExplainUnencryptedHttp={() => Alert.alert('Unencrypted HTTP', 'Sample compatibility explanation. No preference is saved.')}
    onPreparationModeChange={setMode} onSkipExactDuplicatesChange={setDuplicates}
    onIncludeAdditionalMediaComponentsChange={setComponents} />;
}

export function PreviewScene({ scenario, transferId, progress, go, onCatalog }: {
  scenario: PreviewScenario; transferId?: string; progress: number;
  go: (screen: PreviewScreen, state?: string) => void; onCatalog: () => void;
}) {
  const [recovered, setRecovered] = React.useState(false);
  const [cleared, setCleared] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(true);
  const { id, screen } = scenario;
  const connected = !id.endsWith('-offline');
  const loading = id.endsWith('-loading');
  const items = cleared || loading || id.endsWith('-empty') || (id.endsWith('-error') && !id.endsWith('-refresh-error') && !recovered) ? [] : sampleHistory;
  const error = id.endsWith('-error') && !recovered ? 'The receiver could not load transfer history. Try again.' : null;
  const retry = () => setRecovered(true);
  let page: React.ReactNode;
  if (screen === 'home') page = <>
    <HomeScreen isConnected={connected} connectionSecurity={connected ? secure : disconnected}
      activeConnection={connected ? { ...sampleActiveConnection, healthStatus: id === 'home-retrying' ? 'retrying' : 'connected' } : null}
      connectionHealthStatus={id === 'home-retrying' ? 'retrying' : connected ? 'connected' : 'idle'}
      history={items} historyLoading={loading} historyError={error} onRetryHistory={retry}
      onOpenPicker={() => go('media')} onOpenConnect={() => go('connect')} onOpenHistory={() => go('history')}
      onRetryConnection={() => go('home', 'connected')} />
    {id === 'home-details' && <ConnectionDetailsModal visible={dialogOpen} connection={sampleActiveConnection} onClose={() => setDialogOpen(false)} />}
  </>;
  else if (screen === 'connect') page = <PreviewConnection id={id} go={go} />;
  else if (screen === 'media') page = <PreviewMediaPicker id={id} onTransfer={() => go('transfer', 'preparing')} onClose={onCatalog} />;
  else if (screen === 'settings') page = <PreviewSettings connected={connected} />;
  else if (screen === 'history') page = <>
    <HistoryScreen isConnected={connected} items={items} loading={loading} error={error}
      onRefresh={retry} onClear={() => setCleared(true)} onConnect={() => go('connect')} />
    {id === 'history-details' && <SessionDetails item={dialogOpen ? sampleHistory[1] : null} onClose={() => setDialogOpen(false)} />}
    {id === 'history-problems' && <HistoryProblemDetailsModal
      files={dialogOpen ? sampleHistory[1].files!.filter(file => file.outcome !== 'uploaded') : null}
      totalProblems={60} onClose={() => setDialogOpen(false)} />}
  </>;
  else if (id === 'transfer-idle') page = <IdleTransfers isConnected onChooseMedia={() => go('media')} onConnect={() => go('connect')} />;
  else if (id === 'transfer-cancelled') page = <>
    <IdleTransfers isConnected onChooseMedia={() => go('media')} onConnect={() => go('connect')} />
    <SessionDetails item={dialogOpen ? sampleHistory[3] : null} onClose={() => setDialogOpen(false)} />
  </>;
  else page = <PreviewTransfer id={transferId ?? id} progress={progress} onDone={() => go('home', 'connected')}
    onCancel={() => go('transfer', 'cancelled')} />;
  const activeTab: MainTab = screen === 'media' ? 'transfers' : screen === 'transfer' ? 'transfers' : screen;
  return <View className="flex-1 bg-background dark:bg-background-dark">
    <View className="flex-1">{page}</View>
    {screen !== 'media' && <BottomTabBar activeTab={activeTab} onSelect={tab => go(tab === 'transfers' ? 'transfer' : tab, tab === 'transfers' ? 'idle' : undefined)}
      locked={screen === 'transfer' && id !== 'transfer-idle' && !transferFixture(transferId ?? id, progress).isFinished} />}
  </View>;
}
