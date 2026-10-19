import React from 'react';
import { FlatList, useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { MediaPickerView } from '@/platform/ios/media/MediaPickerScreen';
import { calculateMediaGridLayout, createSelectionStore, useMediaSelection } from '@/platform/ios/media/hooks/useMediaSelection';
import type { SelectedMedia } from '@/services/media/SelectedMedia';
import { sampleMedia } from './fixtures';

export function PreviewMediaPicker({ id, onTransfer, onClose }: {
  id: string; onTransfer: () => void; onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [recovered, setRecovered] = React.useState(false);
  const [selectedAlbum, setSelectedAlbum] = React.useState<string | undefined>();
  const [dropdownOpen, setDropdownOpen] = React.useState(id === 'media-albums');
  const [selectionStore] = React.useState(() => {
    const store = createSelectionStore();
    const count = ['media-loading', 'media-empty', 'media-error'].includes(id) ? 0 : id === 'media-large' ? 320 : 5;
    store.replace(new Set(sampleMedia.slice(0, count).map(item => item.id)));
    return store;
  });
  const [selectedCount, setSelectedCount] = React.useState(selectionStore.getSelectedIds().size);
  const suppressNextPress = React.useRef(false);
  const gridListRef = useAnimatedRef<FlatList<SelectedMedia>>();
  const gridScrollOffset = useSharedValue(0);
  const gridScrollHandler = useAnimatedScrollHandler({});
  const media = id === 'media-empty' || (id === 'media-error' && !recovered) || id === 'media-loading'
    ? [] : sampleMedia.slice(0, id === 'media-large' ? 320 : selectedAlbum === 'sample-video' ? 14 : 42);
  const toggleSelection = (itemId: string) => setSelectedCount(selectionStore.toggle(itemId));
  const selection: ReturnType<typeof useMediaSelection> = {
    ...calculateMediaGridLayout(width, 3), media, selectedAlbum, setSelectedAlbum, dropdownOpen, setDropdownOpen,
    selectionStore, selectedCount, suppressNextPress, gridListRef, gridScrollOffset, gridScrollHandler,
    setGridViewportHeight: () => undefined, setGridContentHeight: () => undefined,
    albums: [
      { id: 'sample-recents', title: 'Recents', assetCount: 320, startTime: 1_791_000_000_000, endTime: 1_791_000_000_000 },
      { id: 'sample-video', title: 'Videos', assetCount: 14, startTime: 1_791_000_000_000, endTime: 1_791_000_000_000 },
      { id: 'sample-favorites', title: 'Favorite moments with a longer album name', assetCount: 42, startTime: 1_791_000_000_000, endTime: 1_791_000_000_000 },
    ],
    albumCovers: { 'sample-recents': sampleMedia[0].uri, 'sample-video': sampleMedia[1].uri, 'sample-favorites': sampleMedia[2].uri },
    loading: id === 'media-loading', loadingMore: false, hasNextPage: id === 'media-pagination-error' && !recovered,
    mediaError: id === 'media-error' && !recovered ? 'Photos could not be loaded. Check access and try again.' : null,
    loadMoreError: id === 'media-pagination-error' && !recovered,
    retryMedia: () => setRecovered(true), retryLoadMore: async () => setRecovered(true),
    toggleSelection, loadMoreMedia: async () => undefined,
    beginDragSelection: index => { if (media[index]) toggleSelection(media[index].id); },
    endDragSelection: () => undefined,
    nativeScrollGesture: Gesture.Native(), rangePan: Gesture.Pan().enabled(false),
    deselectAll: () => setSelectedCount(selectionStore.clear()),
    selectAll: async () => setSelectedCount(selectionStore.replace(new Set(media.map(item => item.id)))),
    selectedAssets: async () => sampleMedia.filter(item => selectionStore.isSelected(item.id)),
  };
  return <MediaPickerView selection={selection} onTransfer={onTransfer} onDisconnect={onClose} />;
}
