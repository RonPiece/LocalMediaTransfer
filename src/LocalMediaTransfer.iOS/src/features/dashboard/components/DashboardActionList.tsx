import React from 'react';
import { Text, View } from 'react-native';

import { ActionRow } from '@/components/ui';
import { IOS_APP_VERSION } from '@/version';
import { api } from '@/api/ApiClient';

export function DashboardActionList({
  onOpenHistory,
  onOpenSettings,
  onOpenAbout,
  onDisconnect,
}: {
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onDisconnect: () => void;
}) {
  return (
    <>
      <Text className="text-[13px] font-semibold text-on-surface-variant uppercase tracking-[0.5px] mb-2 px-1">Manage</Text>
      <View className="bg-surface rounded-xl overflow-hidden mb-6">
        <ActionRow icon="time-outline" title="Transfer History" subtitle="Review previous uploads" onPress={onOpenHistory} />
        <View className="h-[0.5px] bg-border ml-16" />
        <ActionRow icon="options-outline" title="Settings" subtitle="Duplicates and transfer preferences" onPress={onOpenSettings} />
        <View className="h-[0.5px] bg-border ml-16" />
        <ActionRow icon="information-circle-outline" title="About" subtitle={`iOS ${IOS_APP_VERSION} · Server ${api.serverVersion || 'unknown'}`} onPress={onOpenAbout} />
        <View className="h-[0.5px] bg-border ml-16" />
        <ActionRow icon="log-out-outline" title="Disconnect" subtitle="Return to the connection screen" onPress={onDisconnect} danger />
      </View>
    </>
  );
}
