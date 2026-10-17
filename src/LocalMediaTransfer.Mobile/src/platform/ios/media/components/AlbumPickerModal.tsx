import React from 'react';
import { FlatList, ListRenderItemInfo, Modal, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library/legacy';

import type { IconName } from '@/components/ui';
import { theme, useReduceMotionEnabled, useThemePalette } from '@/theme';

type AlbumListItem = Pick<MediaLibrary.Album, 'title'> & {
  id?: string;
  assetCount?: number;
};

const albumListContentStyle = { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 };
const albumColumnStyle = { justifyContent: 'space-between' as const };

export function albumGridColumns(width: number, fontScale: number): number {
  return width < 350 || fontScale >= 1.7 ? 1 : 2;
}

const AlbumGridItem = React.memo(function AlbumGridItem({
  item,
  coverUri,
  selected,
  columns,
  onSelectAlbum,
  onClose,
}: {
  item: AlbumListItem;
  coverUri?: string;
  selected: boolean;
  columns: number;
  onSelectAlbum: (albumId?: string) => void;
  onClose: () => void;
}) {
  const palette = useThemePalette();
  const iconName = albumIcon(item.title);
  const imageSource = React.useMemo(() => coverUri ? { uri: coverUri } : undefined, [coverUri]);
  const selectAlbum = React.useCallback(() => {
    onSelectAlbum(item.id);
    onClose();
  }, [item.id, onClose, onSelectAlbum]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${item.title} album${item.assetCount === undefined ? '' : `, ${item.assetCount} items`}`}
      accessibilityState={{ selected }}
      className={`bg-surface dark:bg-surface-dark rounded-[16px] overflow-hidden border mb-4 ${selected ? 'border-primary dark:border-primary-dark border-2' : 'border-border dark:border-border-dark'}`}
      style={{ width: columns === 1 ? '100%' : '48%' }}
      onPress={selectAlbum}
    >
      <View className={`${columns === 1 ? 'h-40' : 'h-32'} bg-background dark:bg-background-dark relative`}>
        {imageSource ? (
          <Image source={imageSource} className="w-full h-full" contentFit="cover" />
        ) : (
          <View className="w-full h-full items-center justify-center bg-background dark:bg-background-dark">
            <Ionicons name="image-outline" size={32} color={palette.border} />
          </View>
        )}
        <View className="absolute bottom-0 left-0 right-0 min-h-[64px] bg-black/40 justify-end py-2 px-3">
          <View className="flex-row items-center">
            <Ionicons name={iconName} size={14} color={theme.colors.white} />
            <Text className="text-white font-bold ml-1.5 text-[14px] flex-1" numberOfLines={2}>{item.title}</Text>
          </View>
        </View>
        {item.assetCount !== undefined && (
          <View className="absolute top-2 right-2 bg-black/60 px-1.5 rounded">
            <Text className="text-white text-[12px] font-mono">{item.assetCount}</Text>
          </View>
        )}
        {selected && (
          <View className="absolute top-2 left-2 bg-primary-fill dark:bg-primary-fill-dark rounded-full p-0.5">
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
  const reduceMotion = useReduceMotionEnabled();
  const { width, fontScale } = useWindowDimensions();
  const columns = albumGridColumns(width, fontScale);
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
        columns={columns}
        onSelectAlbum={onSelectAlbum}
        onClose={onClose}
      />
    );
  }, [albumCovers, columns, onClose, onSelectAlbum, selectedAlbum]);

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
        <View className="h-16 px-5 flex-row items-center justify-between border-b border-separator dark:border-separator-dark bg-surface dark:bg-surface-dark">
          <Text accessibilityRole="header" className="text-on-surface dark:text-on-surface-dark text-xl font-bold">Albums</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close albums" onPress={onClose} className="min-h-[44px] px-4 rounded-full bg-background dark:bg-background-dark items-center justify-center">
            <Text className="text-primary dark:text-primary-dark font-semibold">Close</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          key={`album-columns-${columns}`}
          data={albumItems}
          numColumns={columns}
          keyExtractor={item => item.id || 'recents'}
          renderItem={renderAlbum}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          contentContainerStyle={albumListContentStyle}
          columnWrapperStyle={columns === 2 ? albumColumnStyle : undefined}
        />
      </SafeAreaView>
    </Modal>
  );
});
