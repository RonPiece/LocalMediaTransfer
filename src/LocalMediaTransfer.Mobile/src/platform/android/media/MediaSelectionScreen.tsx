import React from 'react';
import { BackButton } from '@/components/ui/BackButton';
import { Alert, FlatList, Image, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui';
import { nativeCapabilities } from '@/services/NativeCapabilities';
import type { SelectedMedia } from '@/services/media/SelectedMedia';
import { useThemePalette } from '@/theme';

type Props = {
  onTransfer: (items: SelectedMedia[]) => void;
  onDisconnect?: () => void;
};

export function mediaReviewColumns(width: number, fontScale: number): number {
  if (width < 360 || fontScale >= 1.8) return 1;
  if (width < 430 || fontScale >= 1.25) return 2;
  return 3;
}

/** The system picker grants access only to the user's chosen items. */
export default function MediaSelectionScreen({ onTransfer, onDisconnect }: Props) {
  const [items, setItems] = React.useState<SelectedMedia[]>([]);
  const [opening, setOpening] = React.useState(false);
  const openPicker = React.useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const picked = await nativeCapabilities.pickMedia();
      setItems(current => {
        const byUri = new Map(current.map(item => [item.nativeReference ?? item.uri, item]));
        picked.forEach(item => byUri.set(item.nativeReference ?? item.uri, item));
        return [...byUri.values()];
      });
    } catch (error) {
      Alert.alert('Media picker unavailable', error instanceof Error ? error.message : 'Could not open the system picker.');
    } finally {
      setOpening(false);
    }
  }, [opening]);

  const remove = React.useCallback((uri: string) => {
    setItems(current => current.filter(item => (item.nativeReference ?? item.uri) !== uri));
  }, []);

  return <MediaReviewView items={items} opening={opening} openPicker={openPicker} remove={remove}
    onTransfer={onTransfer} onDisconnect={onDisconnect} />;
}

/** Shared Android review presentation; native picker access belongs to the wrapper. */
export function MediaReviewView({ items, opening, openPicker, remove, onTransfer, onDisconnect }: Props & {
  items: SelectedMedia[]; opening: boolean; openPicker: () => void | Promise<void>; remove: (uri: string) => void;
}) {
  const palette = useThemePalette();
  const { width, fontScale } = useWindowDimensions();
  const columns = mediaReviewColumns(width, fontScale);

  const countLabel = `${items.length.toLocaleString()} ${items.length === 1 ? 'item' : 'items'} selected`;

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="bg-surface dark:bg-surface-dark border-b border-border dark:border-border-dark px-4 min-h-[56px] flex-row items-center justify-between">
        <BackButton onPress={() => onDisconnect?.()} disabled={!onDisconnect} accessibilityLabel="Back to Home" />
        <Text accessibilityRole="header" className="text-[17px] font-semibold text-on-surface dark:text-on-surface-dark">Review media</Text>
        <Pressable onPress={() => void openPicker()} accessibilityRole="button" accessibilityLabel="Add media"
          disabled={opening} accessibilityState={{ disabled: opening, busy: opening }}
          className="min-w-[48px] min-h-[48px] items-end justify-center">
          <Text className="text-primary dark:text-primary-dark text-[16px] font-semibold">Add</Text>
        </Pressable>
      </View>

      <View className="px-5 pt-5 pb-3">
        <Text className="text-[22px] font-bold text-on-surface dark:text-on-surface-dark">{countLabel}</Text>
        <Text className="text-[14px] leading-5 text-on-surface-variant dark:text-on-surface-variant-dark mt-1">
          Review your selection before transferring to Windows. You can add or remove items here.
        </Text>
      </View>

      <FlatList
        key={`media-review-${columns}`}
        data={items}
        keyExtractor={item => item.nativeReference ?? item.uri}
        numColumns={columns}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, flexGrow: 1 }}
        renderItem={({ item }) => (
          <View style={{ width: (width - 24) / columns, padding: 4 }}>
            <View className="bg-surface dark:bg-surface-dark rounded-xl border border-border dark:border-border-dark overflow-hidden">
              {item.type === 'photo' || item.thumbnailUri ? (
                <Image source={{ uri: item.thumbnailUri ?? item.uri }} style={{ width: '100%', aspectRatio: 1 }}
                  accessibilityLabel={item.filename} />
              ) : (
                <View style={{ width: '100%', aspectRatio: 1 }} className="bg-primary-soft dark:bg-primary-soft-dark items-center justify-center">
                  <Ionicons name="videocam-outline" size={26} color={palette.primary} />
                  <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-[12px] mt-1">Video</Text>
                </View>
              )}
              <Text numberOfLines={2} className="px-2 pt-2 text-[13px] text-on-surface dark:text-on-surface-dark">{item.filename}</Text>
              <Pressable onPress={() => remove(item.nativeReference ?? item.uri)} accessibilityRole="button"
                accessibilityLabel={`Remove ${item.filename}`} className="min-h-[48px] items-center justify-center flex-row">
                <Ionicons name="close-circle-outline" size={17} color={palette.error} />
                <Text className="text-error dark:text-error-dark text-[13px] font-semibold ml-1">Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center px-8 pb-12">
            <View className="w-16 h-16 rounded-2xl bg-primary-soft dark:bg-primary-soft-dark items-center justify-center mb-4">
              <Ionicons name="images-outline" size={30} color={palette.primary} />
            </View>
            <Text className="text-[19px] font-bold text-on-surface dark:text-on-surface-dark text-center">Choose photos and videos</Text>
            <Text className="text-[14px] leading-5 text-on-surface-variant dark:text-on-surface-variant-dark text-center mt-2 mb-5">
              The Android photo picker lets you choose only the media you want to share.
            </Text>
            <PrimaryButton title={opening ? 'Opening picker…' : 'Choose media'} icon="images-outline"
              disabled={opening} onPress={() => void openPicker()} />
          </View>
        }
      />

      <View className="bg-surface dark:bg-surface-dark border-t border-border dark:border-border-dark px-5 py-3">
        <PrimaryButton title={`Transfer ${items.length.toLocaleString()} ${items.length === 1 ? 'item' : 'items'}`}
          icon="arrow-forward-outline" disabled={items.length === 0} onPress={() => onTransfer(items)}
          className="h-14" />
      </View>
    </SafeAreaView>
  );
}
