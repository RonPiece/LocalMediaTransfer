import React from 'react';
import { Alert, Linking, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/AppHeader';
import { api } from '@/api/ApiClient';
import { theme } from '@/theme';
import { IOS_APP_VERSION } from '@/version';
import { dashboardText } from '../content/dashboardText';

export function DashboardAboutModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const openGithub = React.useCallback(async () => {
    const url = 'https://github.com/RonPiece';
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        throw new Error(`No application can open ${url}`);
      }
      await Linking.openURL(url);
    } catch {
      console.error('Failed to open dashboard about link.');
      Alert.alert(dashboardText.linkFailedTitle, dashboardText.linkFailedMessage);
    }
  }, []);

  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.surface }}>
            <AppHeader title="About" onClose={onClose} closeStyle="back" />
          </SafeAreaView>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View className="bg-surface rounded-2xl p-6 items-center mb-6">
              <View className="w-[72px] h-[72px] rounded-2xl items-center justify-center mb-4" style={{ backgroundColor: theme.colors.primarySoft }}>
                <Ionicons name="sync-outline" size={36} color={theme.colors.primary} />
              </View>
              <Text className="text-[22px] font-bold text-on-surface text-center mb-3">Local Media Transfer</Text>
              <Text className="text-[15px] text-on-surface-variant leading-[22px] text-center mb-4">
                I created this app to make it incredibly fast and private to send photos and videos from my iPhone directly to my Windows PC. No cloud storage, no slow cables, and no compressed quality—just connect both devices to the same Wi-Fi and transfer everything locally!
              </Text>
              <TouchableOpacity
                onPress={openGithub}
                className="w-full h-12 rounded-xl items-center justify-center flex-row mt-2"
                style={{ backgroundColor: theme.colors.github }}
                activeOpacity={0.8}
              >
                <Ionicons name="logo-github" size={20} color={theme.colors.white} />
                <Text className="text-white text-base font-semibold ml-2">DM me on GitHub</Text>
              </TouchableOpacity>
            </View>

            <View className="items-center">
              <Text className="text-on-surface-variant text-[12px]">App Version {IOS_APP_VERSION}</Text>
              <Text className="text-on-surface-variant text-[12px] mt-1">Server Version {api.serverVersion || 'unavailable'}</Text>
            </View>
          </ScrollView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
