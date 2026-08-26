import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import AppHeader from '@/components/AppHeader';
import { theme } from '@/theme';
import { ConnectionDetailsModal } from './components/ConnectionDetailsModal';
import { ConnectionStatusCard } from './components/ConnectionStatusCard';
import { DashboardAboutModal } from './components/DashboardAboutModal';
import { DashboardActionList } from './components/DashboardActionList';
import { DashboardHistoryModal } from './components/DashboardHistoryModal';
import { DashboardSettingsModal } from './components/DashboardSettingsModal';
import { dashboardText } from './content/dashboardText';
import { useDashboardHistory } from './hooks/useDashboardHistory';
import { DashboardScreenProps } from './types';

export default function DashboardScreen({
  isConnected,
  connectionSecurity = { mode: 'disconnected', certificateVerified: false },
  connectionHealthStatus = isConnected ? 'connected' : 'disconnected',
  allowInsecureHttp = false,
  nativeHttpsAvailable = true,
  onAllowInsecureHttpChange = () => undefined,
  onExplainUnencryptedHttp = () => undefined,
  nearbyDiscoveryEnabled = false,
  onNearbyDiscoveryChange = () => undefined,
  preparationMode = 'prepare-first',
  onPreparationModeChange = () => undefined,
  skipExactDuplicates = true,
  onSkipExactDuplicatesChange = () => undefined,
  includeAdditionalMediaComponents = false,
  onIncludeAdditionalMediaComponentsChange = () => undefined,
  onTransferMedia,
  onDisconnect,
  onRetryConnection = () => undefined,
}: DashboardScreenProps) {
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [connectionDetailsOpen, setConnectionDetailsOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const {
    historyOpen,
    setHistoryOpen,
    historyData,
    openHistory,
    confirmClearHistory,
  } = useDashboardHistory();

  const chooseMedia = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onTransferMedia();
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={['top']} className="bg-surface">
        <AppHeader title={dashboardText.title} showIcon />
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <ConnectionStatusCard
          isConnected={isConnected}
          connectionSecurity={connectionSecurity}
          connectionHealthStatus={connectionHealthStatus}
          onOpenDetails={() => setConnectionDetailsOpen(true)}
          onRetryConnection={onRetryConnection}
        />

        <TouchableOpacity
          disabled={!isConnected}
          onPress={chooseMedia}
          activeOpacity={0.8}
          className={`h-[50px] rounded-[14px] items-center justify-center flex-row mb-6 ${isConnected ? 'bg-primary' : ''}`}
          style={!isConnected ? { backgroundColor: theme.colors.disabledFill } : undefined}
        >
          <Ionicons name="images-outline" size={22} color={theme.colors.white} />
          <Text className="text-white text-[17px] font-semibold ml-2">{dashboardText.chooseMedia}</Text>
        </TouchableOpacity>

        <DashboardActionList
          onOpenHistory={openHistory}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAbout={() => setAboutOpen(true)}
          onDisconnect={onDisconnect}
        />
      </ScrollView>

      <DashboardSettingsModal
        visible={settingsOpen}
        settings={{
          skipDuplicates: skipExactDuplicates,
          includeAdditionalMediaComponents,
        }}
        loading={false}
        nativeHttpsAvailable={nativeHttpsAvailable}
        nearbyDiscoveryEnabled={nearbyDiscoveryEnabled}
        allowInsecureHttp={allowInsecureHttp}
        preparationMode={preparationMode}
        onClose={() => setSettingsOpen(false)}
        onSaveSettings={settings => {
          onSkipExactDuplicatesChange(settings.skipDuplicates);
          onIncludeAdditionalMediaComponentsChange(
            settings.includeAdditionalMediaComponents,
          );
        }}
        onNearbyDiscoveryChange={onNearbyDiscoveryChange}
        onAllowInsecureHttpChange={onAllowInsecureHttpChange}
        onPreparationModeChange={onPreparationModeChange}
        onExplainUnencryptedHttp={onExplainUnencryptedHttp}
      />
      <DashboardAboutModal visible={aboutOpen} onClose={() => setAboutOpen(false)} />
      <DashboardHistoryModal
        visible={historyOpen}
        historyData={historyData}
        onClose={() => setHistoryOpen(false)}
        onClear={confirmClearHistory}
      />
      <ConnectionDetailsModal visible={connectionDetailsOpen} onClose={() => setConnectionDetailsOpen(false)} />
    </View>
  );
}
