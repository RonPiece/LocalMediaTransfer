import { CopyAddressButton } from './CopyAddressButton';
import React from 'react';
import { Alert, Modal, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import { addressPanelAppearance, useReduceMotionEnabled, useThemePalette } from '@/theme';
import { dashboardText } from '../content/dashboardText';
import type { ActiveConnection } from '@/features/connection/connectionPresentation';

export function ConnectionDetailsModal({
  visible,
  connection,
  onClose,
}: {
  visible: boolean;
  connection: ActiveConnection | null;
  onClose: () => void;
}) {
  const palette = useThemePalette();
  const address = connection?.address ?? '';
  const reduceMotion = useReduceMotionEnabled();
  const copyAddress = async () => {
    if (!connection) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      await Clipboard.setStringAsync(address);
      Alert.alert(dashboardText.copiedTitle, dashboardText.copiedAddressMessage);
    } catch {
      console.error('Failed to copy dashboard connection address.');
      Alert.alert(dashboardText.copyFailedTitle, dashboardText.copyFailedMessage);
    }
  };

  if (!visible || !connection) return null;
  const https = connection.security.mode === 'https';
  const http = connection.security.mode === 'http';
  const status = { connected: 'Connected', checking: 'Checking connection', retrying: 'Reconnecting',
    disconnected: 'Receiver unavailable', idle: 'Status unavailable' }[connection.healthStatus];
  const fields = [
    ['Connection', status],
    ['Protocol', https ? 'HTTPS' : http ? 'HTTP (unencrypted)' : 'Unavailable'],
    ['Certificate', https ? connection.security.certificateVerified ? 'Verified' : 'Not verified' : http ? 'Not applicable to HTTP' : 'Unavailable'],
    ['TLS version', https ? connection.security.tlsVersion || 'Unavailable' : http ? 'Not applicable to HTTP' : 'Unavailable'],
    ['Saved trust', connection.trusted ? 'Saved on this phone' : 'Not saved for this address'],
  ];
  return (
    <Modal visible animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View className="flex-1 bg-background dark:bg-background-dark">
          <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
            <AppHeader title="Connection details" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View className="bg-surface dark:bg-surface-dark rounded-2xl p-5 mb-6 border border-border dark:border-border-dark">
              <Text className="text-[20px] font-bold text-on-surface dark:text-on-surface-dark mb-4">{connection.name}</Text>
              {http && <View className="flex-row items-start bg-error-soft dark:bg-error-soft-dark p-3 rounded-xl mb-4">
                <Ionicons name="warning-outline" size={20} color={palette.error} accessible={false} />
                <Text className="flex-1 ml-2 text-[14px] text-error dark:text-error-dark">{dashboardText.httpWarning}</Text>
              </View>}
              <View testID="connection-address-panel" style={[addressPanelAppearance(palette), { width: '100%', borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 24 }]}>
                <Text selectable className="text-[14px] text-on-surface dark:text-on-surface-dark text-center leading-5">
                  {address}
                </Text>
              </View>
              <CopyAddressButton fullWidth onPress={() => void copyAddress()} />
              <View className="mt-4">
                {fields.map(([label, value]) => <View key={label} className="py-3 border-b border-separator dark:border-separator-dark">
                  <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark">{label}</Text>
                  <Text className="text-[15px] font-semibold text-on-surface dark:text-on-surface-dark mt-1">{value}</Text>
                </View>)}
              </View>
              <Text className="text-[12px] leading-5 text-on-surface-variant dark:text-on-surface-variant-dark mt-4">{dashboardText.desktopAddressSecret}</Text>
            </View>
          </ScrollView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
