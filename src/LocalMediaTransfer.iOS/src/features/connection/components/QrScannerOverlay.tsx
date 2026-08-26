import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { connectionText } from '../content/connectionText';
import { theme } from '@/theme';

export function QrScannerOverlay({
  onClose,
  onBarcodeScanned,
}: {
  onClose: () => void;
  onBarcodeScanned: ({ data }: { data: string }) => void;
}) {
  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1">
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View className="absolute top-4 left-4 right-4 flex-row justify-between items-center z-10">
          <TouchableOpacity
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
        <View style={StyleSheet.absoluteFillObject} className="items-center justify-center" pointerEvents="none">
          <View className="w-60 h-60 rounded-2xl border-2 border-primary" />
        </View>
      </View>
    </SafeAreaView>
  );
}
