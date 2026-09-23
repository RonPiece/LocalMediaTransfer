import React from 'react';
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api/ApiClient';
import { ConnectionSecurityState } from '@/app/types';
import { Divider, ScreenHeader, SettingRow, StatusBadge } from '@/components/ui';
import { expectedServerEnvironment } from '@/services/NativeCapabilities';
import {
  DiagnosticReportSummary,
  exportAllDiagnosticReports,
  exportDiagnosticReport,
  listDiagnosticReports,
} from '@/services/diagnostics/DiagnosticStore';
import { PreparationMode } from '@/services/upload/types';
import { useThemePalette } from '@/theme';
import { IOS_APP_VERSION } from '@/version';

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <View className="rounded-[18px] bg-surface dark:bg-surface-dark border border-border dark:border-border-dark overflow-hidden">{children}</View>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text className="text-[19px] font-bold text-on-surface dark:text-on-surface-dark mt-6 mb-2 px-1">{children}</Text>;
}

function InfoRow({ icon, title, detail, badge }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; detail: string; badge?: React.ReactNode }) {
  const palette = useThemePalette();
  return (
    <View className="px-4 py-3 flex-row items-center min-h-[64px]">
      <View className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-primary-dark/20 items-center justify-center mr-3">
        <Ionicons name={icon} size={20} color={palette.primary} />
      </View>
      <View className="flex-1 mr-2">
        <Text className="text-[16px] text-on-surface dark:text-on-surface-dark">{title}</Text>
        <Text className="text-[12px] leading-4 text-on-surface-variant dark:text-on-surface-variant-dark mt-0.5">{detail}</Text>
      </View>
      {badge}
    </View>
  );
}

export default function SettingsScreen({
  isConnected,
  connectionSecurity,
  nativeHttpsAvailable,
  nearbyDiscoveryEnabled,
  allowInsecureHttp,
  preparationMode,
  skipExactDuplicates,
  includeAdditionalMediaComponents,
  onNearbyDiscoveryChange,
  onAllowInsecureHttpChange,
  onExplainUnencryptedHttp,
  onPreparationModeChange,
  onSkipExactDuplicatesChange,
  onIncludeAdditionalMediaComponentsChange,
}: {
  isConnected: boolean;
  connectionSecurity: ConnectionSecurityState;
  nativeHttpsAvailable: boolean;
  nearbyDiscoveryEnabled: boolean;
  allowInsecureHttp: boolean;
  preparationMode: PreparationMode;
  skipExactDuplicates: boolean;
  includeAdditionalMediaComponents: boolean;
  onNearbyDiscoveryChange: (enabled: boolean) => void;
  onAllowInsecureHttpChange: (enabled: boolean) => void;
  onExplainUnencryptedHttp: () => void;
  onPreparationModeChange: (mode: PreparationMode) => void;
  onSkipExactDuplicatesChange: (enabled: boolean) => void;
  onIncludeAdditionalMediaComponentsChange: (enabled: boolean) => void;
}) {
  const palette = useThemePalette();
  const [reports, setReports] = React.useState<DiagnosticReportSummary[]>([]);
  const [diagnosticState, setDiagnosticState] = React.useState<'loading' | 'loaded' | 'failed'>('loading');

  const loadDiagnostics = React.useCallback(async () => {
    setDiagnosticState('loading');
    try {
      setReports(await listDiagnosticReports());
      setDiagnosticState('loaded');
    } catch {
      setReports([]);
      setDiagnosticState('failed');
    }
  }, []);

  React.useEffect(() => {
    const timeout = setTimeout(() => { void loadDiagnostics(); }, 0);
    return () => clearTimeout(timeout);
  }, [loadDiagnostics]);

  const exportReport = React.useCallback(async (path: string) => {
    try {
      if (!await exportDiagnosticReport(path)) Alert.alert('Diagnostics unavailable', 'That diagnostic report is no longer available.');
    } catch {
      Alert.alert('Could not export diagnostics', 'The diagnostic report could not be opened.');
    }
  }, []);

  const exportAll = React.useCallback(async () => {
    try {
      if (!await exportAllDiagnosticReports()) Alert.alert('No diagnostics available', 'Complete or start a transfer before exporting diagnostics.');
    } catch {
      Alert.alert('Could not export diagnostics', 'The diagnostic reports could not be opened.');
    }
  }, []);

  const openGithub = React.useCallback(async () => {
    try {
      if (!await Linking.canOpenURL('https://github.com/RonPiece')) throw new Error('Unavailable');
      await Linking.openURL('https://github.com/RonPiece');
    } catch {
      Alert.alert('Could not open link', 'The GitHub page could not be opened on this device.');
    }
  }, []);

  const secure = isConnected && connectionSecurity.mode === 'https' && connectionSecurity.certificateVerified;
  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <SafeAreaView edges={['top']} className="flex-1">
        <ScreenHeader title="Settings" subtitle="Transfer preferences and privacy" />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {expectedServerEnvironment() === 'test' && (
            <View className="items-center mb-1"><StatusBadge label="TEST ENVIRONMENT" tone="warning" icon="flask-outline" /></View>
          )}

          <SectionTitle>Connection</SectionTitle>
          <SettingsGroup>
            <SettingRow
              title="Nearby Discovery"
              detail={nativeHttpsAvailable ? 'Find enabled receivers on this Wi-Fi network.' : 'Requires the installed app; QR and manual connection remain available.'}
              value={nearbyDiscoveryEnabled}
              onChange={onNearbyDiscoveryChange}
              disabled={!nativeHttpsAvailable}
            />
            <Divider />
            <InfoRow
              icon="desktop-outline"
              title="Current Receiver"
              detail={isConnected ? 'Connected receiver is available for transfers.' : 'No receiver is connected.'}
              badge={<StatusBadge label={isConnected ? 'Connected' : 'Offline'} tone={isConnected ? 'success' : 'neutral'} />}
            />
          </SettingsGroup>

          <SectionTitle>Transfers</SectionTitle>
          <SettingsGroup>
            <SettingRow
              title="Skip Exact Duplicates"
              detail="Recommended. Windows verifies byte-identical files with SHA-256 before skipping."
              value={skipExactDuplicates}
              onChange={onSkipExactDuplicatesChange}
            />
            <Divider />
            <SettingRow
              title="Include Additional Media Components"
              detail="Also transfer Live Photo motion, RAW companions, and original edited versions."
              value={includeAdditionalMediaComponents}
              onChange={onIncludeAdditionalMediaComponentsChange}
            />
            <Divider />
            <SettingRow
              title="Transfer While Preparing"
              detail="Start sending prepared groups while remaining media is analyzed. Large selections use this automatically to protect storage."
              value={preparationMode === 'streaming'}
              onChange={enabled => onPreparationModeChange(enabled ? 'streaming' : 'prepare-first')}
            />
          </SettingsGroup>

          <SectionTitle>Security & Compatibility</SectionTitle>
          <SettingsGroup>
            <InfoRow
              icon="shield-checkmark-outline"
              title="Pinned TLS"
              detail={secure ? `${connectionSecurity.tlsVersion || 'TLS'} certificate verified.` : nativeHttpsAvailable ? 'Verified when securely connected.' : 'Requires the installed app.'}
              badge={<StatusBadge label={secure ? 'Verified' : 'Not verified'} tone={secure ? 'success' : 'neutral'} />}
            />
            <Divider />
            <InfoRow icon="people-outline" title="Windows Approval" detail="First trust requires explicit approval on the receiver." />
            <Divider />
            <InfoRow icon="cloud-offline-outline" title="No Cloud Required" detail="Files transfer directly to your receiver without cloud storage." />
            <Divider />
            <SettingRow
              title="Use Unencrypted HTTP"
              detail={nativeHttpsAvailable ? 'Compatibility only. HTTPS remains preferred.' : 'Expo Go uses HTTP with the compatibility uploader.'}
              value={allowInsecureHttp}
              onChange={onAllowInsecureHttpChange}
              disabled={!nativeHttpsAvailable}
              onInfo={onExplainUnencryptedHttp}
              infoLabel="Explain unencrypted HTTP"
              danger
            />
          </SettingsGroup>

          <SectionTitle>Support & Diagnostics</SectionTitle>
          <SettingsGroup>
            <InfoRow icon="document-text-outline" title="Transfer Diagnostics" detail="Privacy-redacted reports exclude filenames, credentials, Photos identifiers, locations, and fingerprints." />
            {reports.map((report, index) => (
              <React.Fragment key={report.path}>
                <Divider />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Export diagnostic transfer ${index + 1}`} onPress={() => void exportReport(report.path)} className="px-4 py-3 flex-row items-center">
                  <Ionicons name="document-outline" size={20} color={palette.primary} />
                  <View className="flex-1 ml-3">
                    <Text className="text-[14px] font-semibold text-on-surface dark:text-on-surface-dark">{new Date(report.startedAt).toLocaleString()}</Text>
                    <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark">{report.selectedAssets.toLocaleString()} assets · {report.completionStatus}</Text>
                  </View>
                  <Ionicons name="share-outline" size={20} color={palette.primary} />
                </TouchableOpacity>
              </React.Fragment>
            ))}
            {diagnosticState === 'loading' && <Text className="px-4 pb-4 text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark">Loading diagnostics…</Text>}
            {diagnosticState === 'failed' && <TouchableOpacity onPress={() => void loadDiagnostics()} className="px-4 pb-4"><Text className="text-error dark:text-error-dark text-[13px]">Diagnostics could not be loaded. Tap to retry.</Text></TouchableOpacity>}
            {diagnosticState === 'loaded' && reports.length === 0 && <Text className="px-4 pb-4 text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark">No diagnostic reports are available.</Text>}
            <Divider />
            <TouchableOpacity accessibilityRole="button" onPress={() => void exportAll()} disabled={reports.length === 0} className={`px-4 py-4 flex-row items-center ${reports.length === 0 ? 'opacity-35' : ''}`}>
              <Ionicons name="documents-outline" size={21} color={palette.primary} />
              <Text className="text-primary dark:text-primary-dark font-semibold ml-3">Export all available reports</Text>
            </TouchableOpacity>
          </SettingsGroup>

          <SectionTitle>About</SectionTitle>
          <SettingsGroup>
            <InfoRow icon="information-circle-outline" title="App Version" detail={`Local Media Transfer for iOS · ${IOS_APP_VERSION}`} />
            <Divider />
            <InfoRow icon="server-outline" title="Server Version" detail={api.serverVersion || 'Unavailable while disconnected'} />
            <Divider />
            <TouchableOpacity accessibilityRole="link" onPress={() => void openGithub()} className="px-4 py-4 flex-row items-center">
              <Ionicons name="logo-github" size={22} color={palette.onSurface} />
              <Text className="text-[16px] text-on-surface dark:text-on-surface-dark ml-3 flex-1">Project on GitHub</Text>
              <Ionicons name="open-outline" size={18} color={palette.onSurfaceVariant} />
            </TouchableOpacity>
          </SettingsGroup>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
