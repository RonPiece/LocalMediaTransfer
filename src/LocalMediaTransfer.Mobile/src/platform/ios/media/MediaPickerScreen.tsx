import React from 'react';
import {
  Alert,
  LayoutChangeEvent,
  ListRenderItemInfo,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import AppHeader from '@/components/AppHeader';
import { MediaAsset } from '@/platform/ios/media/MediaScanner';
import { AlbumPickerModal } from './components/AlbumPickerModal';
import { AlbumSelectorButton } from './components/AlbumSelectorButton';
import {
  FloatingTransferBar,
  LARGE_TRANSFER_ITEM_THRESHOLD,
} from './components/FloatingTransferBar';
import { MediaGridItem } from './components/MediaGridItem';
import { MediaSelectionHeader } from './components/MediaSelectionHeader';
import { useMediaSelection } from './hooks/useMediaSelection';
import {
  MEDIA_GRID_VIRTUALIZATION,
  mediaGridRowLayout,
} from './mediaGridPerformance';

interface MediaPickerScreenProps {
  onTransfer: (selectedItems: MediaAsset[]) => void;
  onDisconnect?: () => void;
}

export default function MediaPickerScreen({ onTransfer, onDisconnect }: MediaPickerScreenProps) {
  const selection = useMediaSelection();
  return <MediaPickerView onTransfer={onTransfer} onDisconnect={onDisconnect} selection={selection} />;
}

/** Uses the same grid and controls with a supplied selection model. */
export function MediaPickerView({ onTransfer, onDisconnect, selection }: MediaPickerScreenProps & {
  selection: ReturnType<typeof useMediaSelection>;
}) {
  const [transferResolving, setTransferResolving] = React.useState(false);
  const transferResolvingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const {
    itemSize,
    itemOuterSize,
    itemMargin,
    contentPadding,
    numColumns,
    media,
    hasNextPage,
    loadingMore,
    mediaError,
    loadMoreError,
    retryMedia,
    retryLoadMore,
    selectionStore,
    selectedCount,
    suppressNextPress,
    gridListRef,
    gridScrollHandler,
    setGridViewportHeight,
    setGridContentHeight,
    loading,
    albums,
    albumCovers,
    selectedAlbum,
    setSelectedAlbum,
    dropdownOpen,
    setDropdownOpen,
    toggleSelection,
    loadMoreMedia,
    nativeScrollGesture,
    rangePan,
    deselectAll,
    selectAll,
    selectedAssets,
  } = selection;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      transferResolvingRef.current = false;
    };
  }, []);

  const openAlbumPicker = React.useCallback(() => setDropdownOpen(true), [setDropdownOpen]);
  const closeAlbumPicker = React.useCallback(() => setDropdownOpen(false), [setDropdownOpen]);
  const gridContentStyle = React.useMemo(
    () => ({
      paddingHorizontal: contentPadding,
      paddingBottom: selectedCount >= LARGE_TRANSFER_ITEM_THRESHOLD ? 250 : 110,
    }),
    [contentPadding, selectedCount],
  );
  const renderMediaItem = React.useCallback(({ item }: ListRenderItemInfo<MediaAsset>) => (
    <MediaGridItem
      item={item}
      itemSize={itemSize}
      itemMargin={itemMargin}
      selectionStore={selectionStore}
      suppressNextPress={suppressNextPress}
      onToggleSelection={toggleSelection}
    />
  ), [itemMargin, itemSize, selectionStore, suppressNextPress, toggleSelection]);
  const trackGridLayout = React.useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setGridViewportHeight(height);
  }, [setGridViewportHeight]);
  const trackGridContentSize = React.useCallback((_width: number, height: number) => {
    setGridContentHeight(height);
  }, [setGridContentHeight]);
  const getGridItemLayout = React.useCallback((_data: ArrayLike<MediaAsset> | null | undefined, index: number) => {
    return mediaGridRowLayout(itemOuterSize, index);
  }, [itemOuterSize]);

  const startTransfer = React.useCallback(async () => {
    if (transferResolvingRef.current || loading || loadingMore) return;
    transferResolvingRef.current = true;
    setTransferResolving(true);
    try {
      const assets = await selectedAssets();
      if (!mountedRef.current) return;
      if (assets.length === 0) {
        Alert.alert('No media selected', 'Choose at least one photo or video before starting transfer.');
        return;
      }
      onTransfer(assets);
    } catch {
      if (!mountedRef.current) return;
      console.error('Failed to resolve selected media for transfer.');
      Alert.alert('Could not start transfer', 'The selected photos and videos could not be loaded. Check Photos permission and try again.');
    } finally {
      transferResolvingRef.current = false;
      if (mountedRef.current) setTransferResolving(false);
    }
  }, [loading, loadingMore, onTransfer, selectedAssets]);

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <SafeAreaView edges={['top']} className="bg-surface dark:bg-surface-dark">
        <AppHeader title="Media Picker" onClose={onDisconnect} closeStyle="back" />
      </SafeAreaView>

      <AlbumSelectorButton
        albums={albums}
        selectedAlbum={selectedAlbum}
        onPress={openAlbumPicker}
      />

      <AlbumPickerModal
        visible={dropdownOpen}
        albums={albums}
        albumCovers={albumCovers}
        selectedAlbum={selectedAlbum}
        onSelectAlbum={setSelectedAlbum}
        onClose={closeAlbumPicker}
      />

      <MediaSelectionHeader
        selectedCount={selectedCount}
        mediaCount={media.length}
        loading={loading || loadingMore}
        allMediaLoaded={!hasNextPage}
        onSelectAll={selectAll}
        onDeselectAll={deselectAll}
      />

      <GestureDetector gesture={rangePan}>
        <View className="flex-1" collapsable={false}>
          {loading && (
            <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-center py-2">Loading media…</Text>
          )}
          {!loading && mediaError && (
            <View className="items-center px-6 py-10">
              <Text className="text-error dark:text-error-dark text-center mb-3">{mediaError}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={retryMedia} className="min-h-12 justify-center px-5 rounded-xl bg-primary-soft dark:bg-primary-soft-dark">
                <Text className="text-primary dark:text-primary-dark font-semibold">Try loading media again</Text>
              </TouchableOpacity>
            </View>
          )}
          {!loading && !mediaError && media.length === 0 && (
            <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-center px-6 py-10">No photos or videos in this album.</Text>
          )}
          <GestureDetector gesture={nativeScrollGesture}>
            <Animated.FlatList
              ref={gridListRef}
              data={media}
              numColumns={numColumns}
              keyExtractor={(item) => item.id}
              renderItem={renderMediaItem}
              onScroll={gridScrollHandler}
              onLayout={trackGridLayout}
              onContentSizeChange={trackGridContentSize}
              onEndReached={loadMoreMedia}
              onEndReachedThreshold={1.5}
              scrollEventThrottle={16}
              getItemLayout={getGridItemLayout}
              contentContainerStyle={gridContentStyle}
              {...MEDIA_GRID_VIRTUALIZATION}
              ListFooterComponent={loadingMore ? (
                <Text className="text-on-surface-variant dark:text-on-surface-variant-dark text-center py-4">Loading more…</Text>
              ) : loadMoreError ? (
                <TouchableOpacity accessibilityRole="button" onPress={retryLoadMore} className="min-h-12 items-center justify-center px-4">
                  <Text className="text-error dark:text-error-dark text-center">Could not load more media. Tap to retry.</Text>
                </TouchableOpacity>
              ) : null}
            />
          </GestureDetector>
        </View>
      </GestureDetector>

      <FloatingTransferBar
        selectedCount={selectedCount}
        disabled={transferResolving || loading || loadingMore || !!mediaError}
        onTransfer={startTransfer}
      />
    </View>
  );
}
