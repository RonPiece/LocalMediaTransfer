import React from 'react';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import { SettingRow } from '@/components/ui';
import { dashboardText } from '../content/dashboardText';
import { DashboardSettings } from '../types';
import {
  DiagnosticReportSummary,
  exportAllDiagnosticReports,
  exportDiagnosticReport,
  listDiagnosticReports,
} from '@/services/diagnostics/DiagnosticStore';
import { theme } from '@/theme';
import { PreparationMode } from '@/services/upload/types';

export function DashboardSettingsModal({
  visible,
  settings,
  loading,
  nativeHttpsAvailable,
  nearbyDiscoveryEnabled,
  allowInsecureHttp,
  preparationMode = 'prepare-first',
  onClose,
  onSaveSettings,
  onNearbyDiscoveryChange,
  onAllowInsecureHttpChange,
  onPreparationModeChange = () => undefined,
  onExplainUnencryptedHttp,
}: {
  visible: boolean;
  settings: DashboardSettings;
  loading: boolean;
  nativeHttpsAvailable: boolean;
  nearbyDiscoveryEnabled: boolean;
  allowInsecureHttp: boolean;
  preparationMode?: PreparationMode;
  onClose: () => void;
  onSaveSettings: (settings: DashboardSettings) => void;
  onNearbyDiscoveryChange: (enabled: boolean) => void;
  onAllowInsecureHttpChange: (enabled: boolean) => void;
  onPreparationModeChange?: (mode: PreparationMode) => void;
  onExplainUnencryptedHttp: () => void;
}) {
  const [diagnosticReports, setDiagnosticReports] = React.useState<DiagnosticReportSummary[]>([]);
  const [diagnosticsLoadState, setDiagnosticsLoadState] = React.useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  const diagnosticsLoadRequest = React.useRef(0);

  const loadDiagnostics = React.useCallback(async () => {
    const requestId = diagnosticsLoadRequest.current + 1;
    diagnosticsLoadRequest.current = requestId;
    setDiagnosticsLoadState('loading');
    try {
      const reports = await listDiagnosticReports();
      if (diagnosticsLoadRequest.current !== requestId) return;
      setDiagnosticReports(reports);
      setDiagnosticsLoadState('loaded');
    } catch {
      if (diagnosticsLoadRequest.current !== requestId) return;
      setDiagnosticReports([]);
      setDiagnosticsLoadState('failed');
    }
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    void loadDiagnostics();
    return () => {
      diagnosticsLoadRequest.current += 1;
    };
  }, [loadDiagnostics, visible]);

  const exportDiagnostics = React.useCallback(async (path: string) => {
    try {
      const exported = await exportDiagnosticReport(path);
      if (!exported) {
        Alert.alert('Diagnostics unavailable', 'That diagnostic report is no longer available.');
      }
    } catch {
      Alert.alert('Could not export diagnostics', 'The diagnostic report could not be opened.');
    }
  }, []);

  const exportAllDiagnostics = React.useCallback(async () => {
    try {
      const exported = await exportAllDiagnosticReports();
      if (!exported) {
        Alert.alert('No diagnostics available', 'Complete or start a transfer before exporting diagnostics.');
      }
    } catch {
      Alert.alert('Could not export diagnostics', 'The diagnostic reports could not be opened.');
    }
  }, []);

  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View className="flex-1 bg-background">
          <SafeAreaView edges={['top']} className="bg-surface">
            <AppHeader title="Settings" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {loading && <Text className="text-on-surface-variant mb-3 text-[15px]">{dashboardText.loadingSettings}</Text>}
            <Text className="text-[13px] font-semibold text-on-surface-variant uppercase tracking-[0.5px] mb-2 px-1">Preferences</Text>
            <View className="bg-surface rounded-xl overflow-hidden">
              <SettingRow title="Skip Exact Duplicates" detail="Recommended. When off, byte-identical files are deliberately transferred again, consuming network bandwidth and storage; filename collisions use (2), (3), and later numbers." value={settings.skipDuplicates} onChange={(value) => onSaveSettings({ ...settings, skipDuplicates: value })} />
              <View className="h-[0.5px] bg-border ml-4" />
              <SettingRow
                title="Include additional media components"
                detail="Also transfers Live Photo motion, RAW companions, and original versions of edited media. Off transfers the primary/current version shown in Photos."
                value={settings.includeAdditionalMediaComponents}
                onChange={(value) => onSaveSettings({ ...settings, includeAdditionalMediaComponents: value })}
              />
              <View className="h-[0.5px] bg-border ml-4" />
              <SettingRow
                title="Transfer while preparing"
                detail="Off waits until all selected media is prepared before uploading and may use substantial temporary storage. On uploads prepared groups while the remaining media is prepared."
                value={preparationMode === 'streaming'}
                onChange={enabled => onPreparationModeChange(enabled ? 'streaming' : 'prepare-first')}
              />
              <View className="h-[0.5px] bg-border ml-4" />
              <SettingRow title="Nearby Desktop Discovery" detail={nativeHttpsAvailable ? 'Use credential-free UDP requests to find desktops on this Wi-Fi network.' : 'Requires the installed iOS app. Expo Go can connect by QR code or manual HTTP address.'} value={nearbyDiscoveryEnabled} onChange={onNearbyDiscoveryChange} disabled={!nativeHttpsAvailable} />
              <View className="h-[0.5px] bg-border ml-4" />
              <SettingRow title="Use Unencrypted HTTP" detail={nativeHttpsAvailable ? 'Only for older desktop builds. HTTPS stays preferred and each HTTP session still asks for confirmation.' : 'Expo Go uses HTTP and the compatibility uploader because pinned HTTPS and native transfer are available only in the installed IPA.'} value={allowInsecureHttp} onChange={onAllowInsecureHttpChange} disabled={!nativeHttpsAvailable} onInfo={onExplainUnencryptedHttp} infoLabel="Explain unencrypted HTTP" danger />
            </View>
            <Text className="text-[13px] font-semibold text-on-surface-variant uppercase tracking-[0.5px] mt-6 mb-2 px-1">Support</Text>
            <View className="bg-surface rounded-xl overflow-hidden">
              <View className="px-4 py-4">
                <Text className="text-on-surface text-[16px] font-semibold">Transfer diagnostics</Text>
                <Text className="text-on-surface-variant text-[13px] mt-1">
                  Choose one of the five latest privacy-redacted reports, or export all available reports together. Filenames, Photos identifiers, locations, credentials, and server fingerprints are excluded.
                </Text>
              </View>
              {diagnosticReports.map((report, index) => (
                <React.Fragment key={report.path}>
                  <View className="h-[0.5px] bg-border ml-4" />
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Export diagnostic transfer ${index + 1}`}
                    onPress={() => void exportDiagnostics(report.path)}
                    className="px-4 py-3 flex-row items-center"
                  >
                    <Ionicons name="document-text-outline" size={21} color={theme.colors.primary} />
                    <View className="flex-1 ml-3">
                      <Text className="text-on-surface text-[15px] font-semibold">
                        {new Date(report.startedAt).toLocaleString()}
                      </Text>
                      <Text className="text-on-surface-variant text-[12px] mt-0.5">
                        {report.selectedAssets.toLocaleString()} assets · {report.completionStatus} · {report.environment}
                      </Text>
                    </View>
                    <Ionicons name="share-outline" size={20} color={theme.colors.primary} />
                  </TouchableOpacity>
                </React.Fragment>
              ))}
              {diagnosticsLoadState === 'loading' && (
                <Text className="text-on-surface-variant text-[13px] px-4 pb-4">
                  Loading transfer diagnostics...
                </Text>
              )}
              {diagnosticsLoadState === 'failed' && (
                <View className="px-4 pb-4">
                  <Text className="text-error text-[13px] mb-3">
                    Transfer diagnostics could not be loaded from this device.
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading transfer diagnostics"
                    onPress={() => void loadDiagnostics()}
                  >
                    <Text className="text-primary text-[15px] font-semibold">Try again</Text>
                  </TouchableOpacity>
                </View>
              )}
              {diagnosticsLoadState === 'loaded' && diagnosticReports.length === 0 && (
                <Text className="text-on-surface-variant text-[13px] px-4 pb-4">
                  No transfer diagnostics are available yet.
                </Text>
              )}
              <View className="h-[0.5px] bg-border ml-4" />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Export all transfer diagnostics"
                onPress={() => void exportAllDiagnostics()}
                disabled={diagnosticsLoadState !== 'loaded' || diagnosticReports.length === 0}
                className={`px-4 py-4 flex-row items-center ${diagnosticsLoadState !== 'loaded' || diagnosticReports.length === 0 ? 'opacity-40' : ''}`}
              >
                <Ionicons name="documents-outline" size={22} color={theme.colors.primary} />
                <Text className="text-primary text-[15px] font-semibold ml-3">
                  Export all available reports
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
