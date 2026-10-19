import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IconTile, StatusBadge } from '@/components/ui';
import { interactionAppearance, useThemePalette } from '@/theme';
import { ActiveConnection, receiverOrigin, receiverRowState } from '../connectionPresentation';

/** One action/state presentation for saved and nearby receivers. */
export function ReceiverRow({ name, address, trusted = false, activeConnection, isConnected, isConnecting, onConnect, onOpenDetails }: {
  name: string; address: string; trusted?: boolean; activeConnection: ActiveConnection | null;
  isConnected: boolean; isConnecting: boolean; onConnect: () => void; onOpenDetails: () => void;
}) {
  const palette = useThemePalette();
  const state = receiverRowState({ address, activeConnection, isConnected, isConnecting });
  return <TouchableOpacity accessibilityRole="button"
    accessibilityLabel={state.connected ? `View connection details for ${name}` : trusted ? 'Reconnect to trusted receiver' : `Connect to ${name}`}
    accessibilityHint={state.action} accessibilityState={{ disabled: state.disabled, busy: state.busy }}
    disabled={state.disabled} onPress={state.connected ? onOpenDetails : onConnect}
    activeOpacity={interactionAppearance('row', { disabled: state.disabled }).activeOpacity}
    style={{ opacity: 1 }} className="p-4 flex-row items-center">
    <IconTile icon={trusted ? 'star-outline' : 'desktop-outline'} />
    <View className="flex-1 min-w-0">
      <Text className="text-[16px] font-semibold text-on-surface dark:text-on-surface-dark">{name}</Text>
      <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1">{receiverOrigin(address) ?? 'Address unavailable'}</Text>
      <Text className="text-[12px] text-on-surface-variant dark:text-on-surface-variant-dark mt-1">{state.action}</Text>
      {(state.connected || trusted) && <View className="self-start mt-2">
        <StatusBadge label={state.connected ? 'Connected' : 'Trusted'} tone="success" icon="checkmark-circle" />
      </View>}
    </View>
    {!state.disabled && <Ionicons name="chevron-forward" size={18} color={palette.primary} accessible={false} style={{ marginLeft: 8 }} />}
  </TouchableOpacity>;
}
