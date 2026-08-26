import React from 'react';
import { FlatList, ListRenderItemInfo, Modal, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';

import type { IconName } from '@/components/ui';
import { theme } from '@/theme';

type AlbumListItem = Pick<MediaLibrary.Album, 'title'> & {
  id?: string;
  assetCount?: number;
};

const albumListContentStyle = { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 };
const albumColumnStyle = { justifyContent: 'space-between' as const };

const AlbumGridItem = React.memo(function AlbumGridItem({
  item,
  coverUri,
  selected,
  onSelectAlbum,
  onClose,
}: {
  item: AlbumListItem;
  coverUri?: string;
  selected: boolean;
  onSelectAlbum: (albumId?: string) => void;
  onClose: () => void;
}) {
  const iconName = albumIcon(item.title);
  const imageSource = React.useMemo(() => coverUri ? { uri: coverUri } : undefined, [coverUri]);
  const selectAlbum = React.useCallback(() => {
    onSelectAlbum(item.id);
    onClose();
  }, [item.id, onClose, onSelectAlbum]);

  return (
    <TouchableOpacity
      className={`w-[48%] bg-surface rounded-[16px] overflow-hidden border mb-4 ${selected ? 'border-primary border-2' : 'border-border'}`}
      onPress={selectAlbum}
    >
      <View className="h-32 bg-background relative">
        {imageSource ? (
          <Image source={imageSource} className="w-full h-full" contentFit="cover" />
        ) : (
          <View className="w-full h-full items-center justify-center bg-background">
            <Ionicons name="image-outline" size={32} color={theme.colors.border} />
          </View>
        )}
        <View className="absolute bottom-0 left-0 right-0 h-16 bg-black/40 justify-end pb-2 px-3">
          <View className="flex-row items-center">
            <Ionicons name={iconName} size={14} color={theme.colors.white} />
            <Text className="text-white font-bold ml-1.5 text-xs" numberOfLines={1}>{item.title}</Text>
          </View>
        </View>
        {item.assetCount !== undefined && (
          <View className="absolute top-2 right-2 bg-black/60 px-1.5 rounded">
            <Text className="text-white text-[10px] font-mono">{item.assetCount}</Text>
          </View>
        )}
        {selected && (
          <View className="absolute top-2 left-2 bg-primary rounded-full p-0.5">
            <Ionicons name="checkmark" size={14} color={theme.colors.white} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

function albumIcon(title: string): IconName {
  const titleLower = title.toLowerCase();
  if (titleLower === 'recents') return 'time-outline';
  if (titleLower === 'favorites') return 'heart-outline';
  if (titleLower === 'screenshots') return 'phone-portrait-outline';
  if (titleLower === 'instagram') return 'camera-outline';
  if (titleLower === 'whatsapp') return 'chatbubbles-outline';
  if (titleLower === 'videos') return 'videocam-outline';
  if (titleLower === 'selfies') return 'person-outline';
  return 'albums-outline';
}

export const AlbumPickerModal = React.memo(function AlbumPickerModal({
  visible,
  albums,
  albumCovers,
  selectedAlbum,
  onSelectAlbum,
  onClose,
}: {
  visible: boolean;
  albums: MediaLibrary.Album[];
  albumCovers: Record<string, string>;
  selectedAlbum?: string;
  onSelectAlbum: (albumId?: string) => void;
  onClose: () => void;
}) {
  const albumItems = React.useMemo<AlbumListItem[]>(
    () => [{ id: undefined, title: 'Recents', assetCount: undefined }, ...albums],
    [albums],
  );
  const renderAlbum = React.useCallback(({ item }: ListRenderItemInfo<AlbumListItem>) => {
    return (
      <AlbumGridItem
        item={item}
        coverUri={albumCovers[item.id || 'recents']}
        selected={selectedAlbum === item.id}
        onSelectAlbum={onSelectAlbum}
        onClose={onClose}
      />
    );
  }, [albumCovers, onClose, onSelectAlbum, selectedAlbum]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-background">
        <View className="h-16 px-5 flex-row items-center justify-between border-b border-border bg-surface">
          <Text className="text-on-surface text-xl font-bold">Albums</Text>
          <TouchableOpacity onPress={onClose} className="h-10 px-4 rounded-full bg-background items-center justify-center">
            <Text className="text-primary font-semibold">Close</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={albumItems}
          numColumns={2}
          keyExtractor={item => item.id || 'recents'}
          renderItem={renderAlbum}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          contentContainerStyle={albumListContentStyle}
          columnWrapperStyle={albumColumnStyle}
        />
      </SafeAreaView>
    </Modal>
  );
});
