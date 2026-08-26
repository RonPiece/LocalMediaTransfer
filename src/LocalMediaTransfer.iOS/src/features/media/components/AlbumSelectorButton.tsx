import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';

import { theme } from '@/theme';

type AlbumSelectorButtonProps = {
  albums: MediaLibrary.Album[];
  selectedAlbum: string | null | undefined;
  onPress: () => void;
};

export const AlbumSelectorButton = React.memo(function AlbumSelectorButton({ albums, selectedAlbum, onPress }: AlbumSelectorButtonProps) {
  const title = selectedAlbum ? albums.find(album => album.id === selectedAlbum)?.title : 'Recents';

  return (
    <TouchableOpacity
      className="flex-row justify-between items-center mx-3 mt-3 px-4 py-3 bg-surface border border-border rounded-[16px]"
      onPress={onPress}
    >
      <Text className="text-on-surface text-base font-semibold">{title}</Text>
      <Ionicons name="chevron-down" size={24} color={theme.colors.onSurfaceVariant} />
    </TouchableOpacity>
  );
});
