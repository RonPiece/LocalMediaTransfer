import { CopyAddressButton } from './CopyAddressButton';
import React from 'react';
import { Alert, Modal, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import { api } from '@/api/ApiClient';
import { addressPanelAppearance, useThemePalette } from '@/theme';
import { dashboardText } from '../content/dashboardText';

export function ConnectionDetailsModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const palette = useThemePalette();
  const copyAddress = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      await Clipboard.setStringAsync(api.url);
      Alert.alert(dashboardText.copiedTitle, dashboardText.copiedAddressMessage);
    } catch {
      console.error('Failed to copy dashboard connection address.');
      Alert.alert(dashboardText.copyFailedTitle, dashboardText.copyFailedMessage);
    }
  };

  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View className="flex-1 bg-background dark:bg-background-dark">
          <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
            <AppHeader title="Connection Security" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View className="bg-surface-elevated dark:bg-surface-elevated-dark rounded-2xl p-6 items-center mb-6">
              <View className="w-16 h-16 rounded-2xl items-center justify-center mb-4" style={{ backgroundColor: palette.primarySoft }}>
                <Ionicons name="link-outline" size={32} color={palette.primary} />
              </View>
              <Text className="text-[20px] font-bold text-on-surface dark:text-on-surface-dark text-center mb-2">{dashboardText.desktopAddress}</Text>
              <Text className="text-[15px] text-on-surface-variant dark:text-on-surface-variant-dark leading-[22px] text-center mb-6">
                {dashboardText.desktopAddressSecret}
              </Text>
              <View testID="connection-address-panel" style={[addressPanelAppearance(palette), { width: '100%', borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 24 }]}>
                <Text selectable className="text-[14px] text-on-surface dark:text-on-surface-dark text-center leading-5">
                  {api.url}
                </Text>
              </View>
              <CopyAddressButton fullWidth onPress={() => void copyAddress()} />
            </View>
          </ScrollView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
