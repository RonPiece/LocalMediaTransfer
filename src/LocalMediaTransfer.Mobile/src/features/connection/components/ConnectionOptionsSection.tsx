import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { connectionText } from '../content/connectionText';
import { interactionAppearance, useThemePalette } from '@/theme';
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
  addressError,
  fingerprintError,
  tokenError,
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
  addressError: string | null;
  fingerprintError: string | null;
  tokenError: string | null;
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
  const palette = useThemePalette();
  return (
    <View className="w-full mb-3">
      <SectionLabel>{connectionText.connectionOptionsTitle}</SectionLabel>
      <Card className="dark:bg-surface-dark border border-border dark:border-border-dark">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: manualEntryOpen }}
          onPress={onToggleManualEntry}
          className="p-4 flex-row items-center"
          activeOpacity={interactionAppearance('row').activeOpacity}
        >
          <IconTile icon="create-outline" />
          <View className="flex-1">
            <Text className="text-[17px] text-on-surface dark:text-on-surface-dark">{connectionText.manualEntryTitle}</Text>
            <Text className="text-[13px] text-on-surface-variant dark:text-on-surface-variant-dark leading-[18px] mt-0.5">
              {connectionText.manualEntrySubtitle}
            </Text>
          </View>
          <Ionicons name={manualEntryOpen ? 'chevron-up' : 'chevron-down'} size={18} color={palette.onSurfaceVariant} />
        </TouchableOpacity>

        {manualEntryOpen && (
          <View className="px-4 pb-4">
            <Divider className="mb-3" inset={false} />
            <SectionLabel className="mb-2">{connectionText.manualServerAddressLabel}</SectionLabel>
            <View className="bg-surface-inset dark:bg-surface-inset-dark rounded-xl overflow-hidden">
              <TextField
                value={ip}
                onChangeText={onIpChange}
                placeholder={connectionText.manualIpPlaceholder}
                label="Receiver address"
                hint="Use the address shown in the Windows app."
                keyboardType="url"
              />
              {addressError && <Text accessibilityRole="alert" className="text-error dark:text-error-dark text-[12px] px-4 pb-2">{addressError}</Text>}
              {nativeHttpsAvailable && (
                <>
                  <Divider />
                  <TextField
                    value={fingerprint}
                    onChangeText={onFingerprintChange}
                    placeholder={connectionText.manualFingerprintPlaceholder}
                    label="Certificate fingerprint"
                    hint="Required for secure pairing. Copy the SHA-256 fingerprint shown in Windows."
                    textSizeClass="text-[14px]"
                  />
                  {fingerprintError && <Text accessibilityRole="alert" className="text-error dark:text-error-dark text-[12px] px-4 pb-2">{fingerprintError}</Text>}
                </>
              )}
              <Divider />
              <TextField
                value={manualToken}
                onChangeText={onManualTokenChange}
                placeholder={connectionText.manualTokenPlaceholder}
                label="Session token"
                hint="Required for secure pairing. Copy the token shown in Windows."
                secureTextEntry
                textSizeClass="text-[14px]"
              />
              {tokenError && <Text accessibilityRole="alert" className="text-error dark:text-error-dark text-[12px] px-4 pb-2">{tokenError}</Text>}
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
