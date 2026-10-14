import React from 'react';
import { Alert, FlatList, Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { nativeCapabilities } from '@/services/NativeCapabilities';
import type { SelectedMedia } from '@/services/media/SelectedMedia';

type Props = {
  onTransfer: (items: SelectedMedia[]) => void;
  onDisconnect?: () => void;
};

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

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="px-5 py-4 flex-row items-center justify-between">
        <Pressable onPress={onDisconnect} accessibilityRole="button"><Text className="text-primary">Back</Text></Pressable>
        <Text className="text-lg font-bold text-on-surface dark:text-on-surface-dark">Review media</Text>
        <Pressable onPress={() => void openPicker()} accessibilityRole="button" disabled={opening}>
          <Text className="text-primary">{items.length ? 'Add' : 'Choose'}</Text>
        </Pressable>
      </View>
      <Text className="px-5 pb-3 text-on-surface-variant dark:text-on-surface-variant-dark">
        {items.length ? `${items.length} selected. Remove any item before transfer.` : 'Choose photos and videos with the Android system picker.'}
      </Text>
      <FlatList
        data={items}
        keyExtractor={item => item.nativeReference ?? item.uri}
        numColumns={3}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View style={{ width: '33.33%', padding: 4 }}>
            {item.type === 'photo' || item.thumbnailUri ? (
              <Image source={{ uri: item.thumbnailUri ?? item.uri }} style={{ width: '100%', aspectRatio: 1, borderRadius: 8 }} />
            ) : (
              <View style={{ width: '100%', aspectRatio: 1, borderRadius: 8 }} className="bg-surface dark:bg-surface-dark items-center justify-center">
                <Text className="text-on-surface dark:text-on-surface-dark">Video</Text>
              </View>
            )}
            <Pressable onPress={() => remove(item.nativeReference ?? item.uri)} accessibilityRole="button" accessibilityLabel={`Remove ${item.filename}`}>
              <Text className="text-center text-primary py-2">Remove</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Pressable onPress={() => void openPicker()} accessibilityRole="button" className="p-5"><Text className="text-primary text-center">Open system Photo Picker</Text></Pressable>}
      />
      <Pressable
        className="mx-5 mb-4 rounded-xl bg-primary p-4"
        disabled={items.length === 0}
        style={{ opacity: items.length ? 1 : 0.5 }}
        onPress={() => onTransfer(items)}
        accessibilityRole="button"
      >
        <Text className="text-white font-bold text-center">Transfer {items.length || ''}</Text>
      </Pressable>
    </SafeAreaView>
  );
}
