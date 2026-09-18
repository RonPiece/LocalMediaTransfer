import React from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { connectionText } from '../content/connectionText';
import { theme } from '@/theme';

export function qrScannerControlsTop(
  initialTopInset = initialWindowMetrics?.insets.top ?? 0,
  platform = Platform.OS,
): number {
  return Math.max(initialTopInset, platform === 'ios' ? 44 : 0) + 12;
}

function QrScannerContent({
  onClose,
  onBarcodeScanned,
}: {
  onClose: () => void;
  onBarcodeScanned: ({ data }: { data: string }) => void;
}) {
  const controlsTop = qrScannerControlsTop();

  return (
    <View className="flex-1 bg-black">
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View
          testID="qr-scanner-controls"
          className="absolute left-4 right-4 flex-row justify-between items-center z-10"
          style={{ top: controlsTop }}
        >
          <TouchableOpacity
            testID="qr-scanner-close"
            accessibilityRole="button"
            accessibilityLabel="Close QR scanner"
            onPress={onClose}
            className="w-11 h-11 bg-black/50 rounded-full items-center justify-center"
          >
            <Ionicons name="close" size={24} color={theme.colors.white} />
          </TouchableOpacity>
          <Text className="text-white font-semibold text-[17px] bg-black/50 px-4 py-2 rounded-[14px]">
            {connectionText.qrTitle}
          </Text>
          <View className="w-11" />
        </View>
        <View style={StyleSheet.absoluteFill} className="items-center justify-center" pointerEvents="none">
          <View className="w-60 h-60 rounded-2xl border-2 border-primary" />
        </View>
    </View>
  );
}

export function QrScannerOverlay({
  onClose,
  onBarcodeScanned,
}: {
  onClose: () => void;
  onBarcodeScanned: ({ data }: { data: string }) => void;
}) {
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <QrScannerContent onClose={onClose} onBarcodeScanned={onBarcodeScanned} />
    </Modal>
  );
}
