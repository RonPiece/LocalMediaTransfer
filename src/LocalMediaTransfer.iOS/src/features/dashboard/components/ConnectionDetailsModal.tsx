import React from 'react';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import { api } from '@/api/ApiClient';
import { theme } from '@/theme';
import { dashboardText } from '../content/dashboardText';

export function ConnectionDetailsModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
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
        <View className="flex-1 bg-background">
          <SafeAreaView edges={['top']} className="bg-surface">
            <AppHeader title="Connection Security" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View className="bg-surface rounded-2xl p-6 items-center mb-6">
              <View className="w-16 h-16 rounded-2xl items-center justify-center mb-4" style={{ backgroundColor: theme.colors.primarySoft }}>
                <Ionicons name="link-outline" size={32} color={theme.colors.primary} />
              </View>
              <Text className="text-[20px] font-bold text-on-surface text-center mb-2">{dashboardText.desktopAddress}</Text>
              <Text className="text-[15px] text-on-surface-variant leading-[22px] text-center mb-6">
                {dashboardText.desktopAddressSecret}
              </Text>
              <View className="w-full bg-background rounded-xl p-4 mb-6">
                <Text selectable className="text-[14px] text-on-surface text-center leading-5">
                  {api.url}
                </Text>
              </View>
              <TouchableOpacity
                onPress={copyAddress}
                className="w-full h-12 bg-primary rounded-xl items-center justify-center flex-row"
                activeOpacity={0.8}
              >
                <Ionicons name="copy-outline" size={20} color={theme.colors.white} />
                <Text className="text-white text-[16px] font-semibold ml-2">{dashboardText.copyLink}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
