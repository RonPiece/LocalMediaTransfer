import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { connectionText } from '../content/connectionText';
import { theme } from '@/theme';
import {
  Card,
  Divider,
  IconTile,
  PrimaryButton,
  SectionLabel,
  SettingRow,
  TextField,
} from '@/components/ui';

export function ConnectionOptionsSection({
  ip,
  fingerprint,
  manualToken,
  manualEntryOpen,
  isConnecting,
  canConnectManually,
  nativeHttpsAvailable,
  allowInsecureHttp,
  onIpChange,
  onFingerprintChange,
  onManualTokenChange,
  onToggleManualEntry,
  onConnectManually,
  onAllowInsecureHttpChange,
  onExplainUnencryptedHttp,
}: {
  ip: string;
  fingerprint: string;
  manualToken: string;
  manualEntryOpen: boolean;
  isConnecting: boolean;
  canConnectManually: boolean;
  nativeHttpsAvailable: boolean;
  allowInsecureHttp: boolean;
  onIpChange: (value: string) => void;
  onFingerprintChange: (value: string) => void;
  onManualTokenChange: (value: string) => void;
  onToggleManualEntry: () => void;
  onConnectManually: () => void;
  onAllowInsecureHttpChange: (enabled: boolean) => void;
  onExplainUnencryptedHttp: () => void;
}) {
  return (
    <View className="w-full mb-3">
      <SectionLabel>{connectionText.connectionOptionsTitle}</SectionLabel>
      <Card>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: manualEntryOpen }}
          onPress={onToggleManualEntry}
          className="p-4 flex-row items-center"
          activeOpacity={0.7}
        >
          <IconTile icon="create-outline" />
          <View className="flex-1">
            <Text className="text-[17px] text-on-surface">{connectionText.manualEntryTitle}</Text>
            <Text className="text-[13px] text-on-surface-variant leading-[18px] mt-0.5">
              {connectionText.manualEntrySubtitle}
            </Text>
          </View>
          <Ionicons name={manualEntryOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
        </TouchableOpacity>

        {manualEntryOpen && (
          <View className="px-4 pb-4">
            <Divider className="mb-3" inset={false} />
            <SectionLabel className="mb-2">{connectionText.manualServerAddressLabel}</SectionLabel>
            <View className="bg-background rounded-xl overflow-hidden">
              <TextField
                value={ip}
                onChangeText={onIpChange}
                placeholder={connectionText.manualIpPlaceholder}
                keyboardType="url"
              />
              {nativeHttpsAvailable && (
                <>
                  <Divider />
                  <TextField
                    value={fingerprint}
                    onChangeText={onFingerprintChange}
                    placeholder={connectionText.manualFingerprintPlaceholder}
                    textSizeClass="text-[14px]"
                  />
                </>
              )}
              <Divider />
              <TextField
                value={manualToken}
                onChangeText={onManualTokenChange}
                placeholder={connectionText.manualTokenPlaceholder}
                secureTextEntry
                textSizeClass="text-[14px]"
              />
            </View>
            <PrimaryButton
              title={isConnecting ? connectionText.connecting : connectionText.connect}
              onPress={onConnectManually}
              disabled={isConnecting || !canConnectManually}
              className="mt-3"
            />
          </View>
        )}

        <Divider />
        <SettingRow
          title={connectionText.useUnencryptedHttp}
          detail={nativeHttpsAvailable ? connectionText.httpNativeDetail : connectionText.httpExpoDetail}
          value={allowInsecureHttp}
          disabled={!nativeHttpsAvailable}
          onChange={onAllowInsecureHttpChange}
          onInfo={onExplainUnencryptedHttp}
          infoLabel={connectionText.explainUnencryptedHttp}
          danger
        />
      </Card>
    </View>
  );
}
