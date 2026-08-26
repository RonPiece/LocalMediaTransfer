import React from 'react';
import { Alert, FlatList, useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import {
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { MediaAsset, mediaScanner } from '@/services/MediaScanner';

const ALBUM_COVER_CONCURRENCY = 4;
const MEDIA_PAGE_SIZE = 120;

export type MediaGridLayout = {
  itemSize: number;
  itemOuterSize: number;
  itemMargin: number;
  contentPadding: number;
  numColumns: number;
};

export type SelectionStore = {
  isSelected: (id: string) => boolean;
  subscribe: (id: string, listener: () => void) => () => void;
  toggle: (id: string) => number;
  update: (entries: Iterable<readonly [string, boolean]>) => number;
  replace: (next: Set<string>) => number;
  clear: () => number;
  getSelectedIds: () => Set<string>;
};

export function dragAutoScrollVelocity(y: number, viewportHeight: number): number {
  'worklet';
  if (viewportHeight <= 0) return 0;
  const edgeSize = Math.min(80, viewportHeight * 0.2);
  if (y < edgeSize) return -480 * (1 - Math.max(0, y) / edgeSize);
  if (y > viewportHeight - edgeSize) {
    return 480 * ((Math.min(viewportHeight, y) - (viewportHeight - edgeSize)) / edgeSize);
  }
  return 0;
}

export function nextAutoScrollOffset({
  currentOffset,
  velocity,
  elapsedMs,
  maxOffset,
}: {
  currentOffset: number;
  velocity: number;
  elapsedMs: number;
  maxOffset: number;
}): number {
  'worklet';
  const safeElapsedMs = Math.max(0, Math.min(50, elapsedMs));
  return Math.max(0, Math.min(maxOffset, currentOffset + velocity * safeElapsedMs / 1000));
}

export function shouldScheduleDragIndex(targetIndex: number, previousIndex: number): boolean {
  'worklet';
  return targetIndex >= 0 && targetIndex !== previousIndex;
}

export function calculateMediaGridLayout(windowWidth: number, numColumns: number = 3): MediaGridLayout {
  const itemMargin = 1;
  const contentPadding = 1;
  const itemSize = (windowWidth - (contentPadding * 2) - (itemMargin * 2 * numColumns)) / numColumns;
  return {
    itemSize,
    itemOuterSize: itemSize + (itemMargin * 2),
    itemMargin,
    contentPadding,
    numColumns,
  };
}

export function gridIndexForPoint(
  x: number,
  y: number,
  scrollOffset: number,
  itemCount: number,
  layout: MediaGridLayout,
): number {
  'worklet';
  if (itemCount <= 0) return -1;
  const relativeX = Math.max(0, x - layout.contentPadding);
  const relativeY = Math.max(0, y + scrollOffset);
  const column = Math.max(0, Math.min(layout.numColumns - 1, Math.floor(relativeX / layout.itemOuterSize)));
  const row = Math.max(0, Math.floor(relativeY / layout.itemOuterSize));
  return Math.min(itemCount - 1, row * layout.numColumns + column);
}

export function dragSelectionDelta({
  media,
  getBaselineSelection,
  startIndex,
  previousTargetIndex,
  targetIndex,
  selectMode,
}: {
  media: MediaAsset[];
  getBaselineSelection: (id: string) => boolean;
  startIndex: number;
  previousTargetIndex: number | null;
  targetIndex: number;
  selectMode: boolean;
}): Map<string, boolean> {
  const updates = new Map<string, boolean>();
  const updateRange = (first: number, last: number, entering: boolean) => {
    for (let index = first; index <= last; index += 1) {
      const id = media[index]?.id;
      if (!id) continue;
      const baselineSelected = getBaselineSelection(id);
      updates.set(id, entering ? selectMode : baselineSelected);
    }
  };

  if (previousTargetIndex === null) {
    updateRange(Math.min(startIndex, targetIndex), Math.max(startIndex, targetIndex), true);
    return updates;
  }

  const previousFirst = Math.min(startIndex, previousTargetIndex);
  const previousLast = Math.max(startIndex, previousTargetIndex);
  const nextFirst = Math.min(startIndex, targetIndex);
  const nextLast = Math.max(startIndex, targetIndex);
  if (previousFirst < nextFirst) updateRange(previousFirst, nextFirst - 1, false);
  if (nextFirst < previousFirst) updateRange(nextFirst, previousFirst - 1, true);
  if (previousLast < nextLast) updateRange(previousLast + 1, nextLast, true);
  if (nextLast < previousLast) updateRange(nextLast + 1, previousLast, false);
  return updates;
}

function createSelectionStore(): SelectionStore {
  let selectedIds = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();

  const notify = (ids: Iterable<string>) => {
    const notified = new Set<() => void>();
    for (const id of ids) {
      listeners.get(id)?.forEach(listener => {
        if (notified.has(listener)) return;
        notified.add(listener);
        listener();
      });
    }
  };

  const changedSubscribedIds = (previous: Set<string>, next: Set<string>) => {
    const changed = new Set<string>();
    listeners.forEach((_listeners, id) => {
      if (previous.has(id) !== next.has(id)) changed.add(id);
    });
    return changed;
  };

  return {
    isSelected: (id: string) => selectedIds.has(id),
    subscribe: (id: string, listener: () => void) => {
      const entry = listeners.get(id) ?? new Set<() => void>();
      entry.add(listener);
      listeners.set(id, entry);
      return () => {
        entry.delete(listener);
        if (entry.size === 0) listeners.delete(id);
      };
    },
    toggle: (id: string) => {
      if (!selectedIds.delete(id)) selectedIds.add(id);
      notify([id]);
      return selectedIds.size;
    },
    update: (entries: Iterable<readonly [string, boolean]>) => {
      const changed: string[] = [];
      for (const [id, shouldSelect] of entries) {
        const wasSelected = selectedIds.has(id);
        if (wasSelected === shouldSelect) continue;
        if (shouldSelect) selectedIds.add(id);
        else selectedIds.delete(id);
        changed.push(id);
      }
      notify(changed);
      return selectedIds.size;
    },
    replace: (next: Set<string>) => {
      const previous = selectedIds;
      const changed = changedSubscribedIds(previous, next);
      selectedIds = new Set(next);
      notify(changed);
      return selectedIds.size;
    },
    clear: () => {
      const changed = Array.from(listeners.keys()).filter(id => selectedIds.has(id));
      selectedIds = new Set<string>();
      notify(changed);
      return 0;
    },
    getSelectedIds: () => new Set(selectedIds),
  };
}

export function useMediaSelection() {
  const { width: windowWidth } = useWindowDimensions();
  const layout = React.useMemo(() => calculateMediaGridLayout(windowWidth, 3), [windowWidth]);
  const [selectionStore] = React.useState(createSelectionStore);
  const gridListRef = useAnimatedRef<FlatList<MediaAsset>>();
  const gridScrollOffset = useSharedValue(0);
  const gridViewportHeight = useSharedValue(0);
  const gridContentHeight = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragActive = useSharedValue(false);
  const dragVelocity = useSharedValue(0);
  const lastScheduledIndex = useSharedValue(-1);

  const [media, setMedia] = React.useState<MediaAsset[]>([]);
  const [selectedCount, setSelectedCount] = React.useState(0);
  const dragStartIndex = React.useRef<number | null>(null);
  const dragLastIndex = React.useRef<number | null>(null);
  const dragSelectMode = React.useRef(true);
  const dragBaseline = React.useRef(new Map<string, boolean>());
  const suppressNextPress = React.useRef(false);
  const [loading, setLoading] = React.useState(true);
  const [albums, setAlbums] = React.useState<MediaLibrary.Album[]>([]);
  const [albumCovers, setAlbumCovers] = React.useState<Record<string, string>>({});
  const [selectedAlbum, setSelectedAlbum] = React.useState<string | undefined>(undefined);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const selectionOperationRef = React.useRef(0);
  const pageCursorRef = React.useRef<string | undefined>(undefined);
  const hasNextPageRef = React.useRef(false);
  const loadingMoreRef = React.useRef(false);
  const loadedMediaIdsRef = React.useRef(new Set<string>());
  const [hasNextPage, setHasNextPage] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const applySelection = React.useCallback((next: Set<string>) => {
    setSelectedCount(selectionStore.replace(next));
  }, [selectionStore]);

  React.useEffect(() => {
    let active = true;

    const fetchAlbums = async () => {
      try {
        const fetchedAlbums = await mediaScanner.getAlbums();
        if (!active) return;
        setAlbums(fetchedAlbums);
        const coverTargets = [
          { key: 'recents', albumId: undefined as string | undefined },
          ...fetchedAlbums.map(album => ({ key: album.id, albumId: album.id })),
        ];
        const covers: Record<string, string> = {};
        let coverIndex = 0;
        const coverWorker = async () => {
          while (active && coverIndex < coverTargets.length) {
            const target = coverTargets[coverIndex++];
            try {
              const assets = await MediaLibrary.getAssetsAsync({
                album: target.albumId,
                first: 1,
                sortBy: [MediaLibrary.SortBy.creationTime],
              });
              if (assets.assets.length > 0) covers[target.key] = assets.assets[0].uri;
            } catch {
              // Album covers are cosmetic; ignore missing cover failures.
            }
          }
        };
        await Promise.all(Array.from(
          { length: Math.min(ALBUM_COVER_CONCURRENCY, coverTargets.length) },
          () => coverWorker(),
        ));
        if (active) setAlbumCovers(covers);
      } catch {
        console.error('Failed to load media albums.');
        if (active) {
          setAlbums([]);
          Alert.alert('Media unavailable', 'Could not load albums. Check Photos permission and try again.');
        }
      }
    };

    void fetchAlbums();
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    let active = true;
    const operation = ++selectionOperationRef.current;
    const fetchMedia = async () => {
      setLoading(true);
      selectionStore.clear();
      setSelectedCount(0);
      setMedia([]);
      pageCursorRef.current = undefined;
      hasNextPageRef.current = false;
      loadingMoreRef.current = false;
      loadedMediaIdsRef.current = new Set<string>();
      setHasNextPage(false);
      setLoadingMore(false);
      try {
        const page = await mediaScanner.getMediaPage(MEDIA_PAGE_SIZE, selectedAlbum);
        if (!active || operation !== selectionOperationRef.current) return;
        loadedMediaIdsRef.current = new Set(page.assets.map(asset => asset.id));
        pageCursorRef.current = page.endCursor;
        hasNextPageRef.current = page.hasNextPage;
        setHasNextPage(page.hasNextPage);
        setMedia(page.assets);
      } catch {
        if (active && operation === selectionOperationRef.current) {
          console.error('Failed to load media library.');
          selectionStore.clear();
          setSelectedCount(0);
          setMedia([]);
          Alert.alert('Media unavailable', 'Could not load photos and videos. Check Photos permission and try again.');
        }
      } finally {
        if (active && operation === selectionOperationRef.current) setLoading(false);
      }
    };
    void fetchMedia();
    return () => { active = false; };
  }, [selectedAlbum, selectionStore]);

  const loadMoreMedia = React.useCallback(async () => {
    if (loading || loadingMoreRef.current || !hasNextPageRef.current) return;
    const operation = selectionOperationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await mediaScanner.getMediaPage(
        MEDIA_PAGE_SIZE,
        selectedAlbum,
        pageCursorRef.current,
      );
      if (operation !== selectionOperationRef.current) return;
      const additions = page.assets.filter(asset => {
        if (loadedMediaIdsRef.current.has(asset.id)) return false;
        loadedMediaIdsRef.current.add(asset.id);
        return true;
      });
      if (additions.length > 0) {
        setMedia(current => current.concat(additions));
      }
      pageCursorRef.current = page.endCursor;
      hasNextPageRef.current = page.hasNextPage;
      setHasNextPage(page.hasNextPage);
    } catch {
      if (operation === selectionOperationRef.current) {
        console.error('Failed to load more media.');
      }
    } finally {
      if (operation === selectionOperationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [loading, selectedAlbum]);

  const toggleSelection = React.useCallback((id: string) => {
    setSelectedCount(selectionStore.toggle(id));
  }, [selectionStore]);

  const updateDragSelection = React.useCallback((targetIndex: number) => {
    const start = dragStartIndex.current;
    if (start === null || targetIndex < 0 || targetIndex === dragLastIndex.current) return;
    const previousTarget = dragLastIndex.current;
    dragLastIndex.current = targetIndex;
    const getBaselineSelection = (id: string) => {
      const existing = dragBaseline.current.get(id);
      if (existing !== undefined || dragBaseline.current.has(id)) return Boolean(existing);
      const selected = selectionStore.isSelected(id);
      dragBaseline.current.set(id, selected);
      return selected;
    };
    const updates = dragSelectionDelta({
      media,
      getBaselineSelection,
      startIndex: start,
      previousTargetIndex: previousTarget,
      targetIndex,
      selectMode: dragSelectMode.current,
    });
    setSelectedCount(selectionStore.update(updates));
  }, [media, selectionStore]);

  const beginDragSelection = React.useCallback((index: number, forceSelect = false) => {
    const id = media[index]?.id;
    if (!id) return;
    dragStartIndex.current = index;
    dragLastIndex.current = null;
    dragBaseline.current.clear();
    dragSelectMode.current = forceSelect || !selectionStore.isSelected(id);
    suppressNextPress.current = true;
    updateDragSelection(index);
  }, [media, selectionStore, updateDragSelection]);

  const endDragSelection = React.useCallback(() => {
    dragStartIndex.current = null;
    dragLastIndex.current = null;
    dragBaseline.current.clear();
  }, []);

  const updateDragAtIndex = React.useCallback((index: number) => {
    updateDragSelection(index);
  }, [updateDragSelection]);

  const stopDragOnRN = React.useCallback(() => {
    endDragSelection();
  }, [endDragSelection]);

  const beginDragOnRN = React.useCallback((index: number) => {
    beginDragSelection(index, true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [beginDragSelection]);

  const frameCallback = useFrameCallback(React.useCallback((frameInfo) => {
    'worklet';
    if (!dragActive.value || frameInfo.timeSincePreviousFrame === null) return;
    const velocity = dragAutoScrollVelocity(dragY.value, gridViewportHeight.value);
    dragVelocity.value = velocity;
    if (velocity === 0) return;

    const maxOffset = Math.max(0, gridContentHeight.value - gridViewportHeight.value);
    const nextOffset = nextAutoScrollOffset({
      currentOffset: gridScrollOffset.value,
      velocity,
      elapsedMs: frameInfo.timeSincePreviousFrame,
      maxOffset,
    });
    if (nextOffset === gridScrollOffset.value) {
      dragVelocity.value = 0;
      return;
    }

    gridScrollOffset.value = nextOffset;
    scrollTo(gridListRef, 0, nextOffset, false);
    const targetIndex = gridIndexForPoint(
      dragX.value,
      dragY.value,
      nextOffset,
      media.length,
      layout,
    );
    if (shouldScheduleDragIndex(targetIndex, lastScheduledIndex.value)) {
      lastScheduledIndex.value = targetIndex;
      scheduleOnRN(updateDragAtIndex, targetIndex);
    }
  }, [
    dragActive,
    dragVelocity,
    dragX,
    dragY,
    gridContentHeight,
    gridListRef,
    gridScrollOffset,
    gridViewportHeight,
    lastScheduledIndex,
    layout,
    media.length,
    updateDragAtIndex,
  ]), false);

  const beginFrameUpdates = React.useCallback((index: number) => {
    frameCallback.setActive(true);
    beginDragOnRN(index);
  }, [beginDragOnRN, frameCallback]);

  const stopFrameUpdates = React.useCallback(() => {
    frameCallback.setActive(false);
    stopDragOnRN();
  }, [frameCallback, stopDragOnRN]);

  React.useEffect(() => () => {
    frameCallback.setActive(false);
  }, [frameCallback]);

  const gridScrollHandler = useAnimatedScrollHandler({
    onScroll: event => {
      gridScrollOffset.value = event.contentOffset.y;
    },
  });

  const setGridViewportHeight = React.useCallback((height: number) => {
    gridViewportHeight.value = height;
  }, [gridViewportHeight]);

  const setGridContentHeight = React.useCallback((height: number) => {
    gridContentHeight.value = height;
  }, [gridContentHeight]);

  const nativeScrollGesture = React.useMemo(() => Gesture.Native(), []);
  const rangePan = React.useMemo(() => Gesture.Pan()
    .enabled(media.length > 0)
    .activateAfterLongPress(250)
    .blocksExternalGesture(nativeScrollGesture)
    .onStart(event => {
      const originX = event.x - event.translationX;
      const originY = event.y - event.translationY;
      dragX.value = event.x;
      dragY.value = event.y;
      dragActive.value = true;
      const startIndex = gridIndexForPoint(
        originX,
        originY,
        gridScrollOffset.value,
        media.length,
        layout,
      );
      lastScheduledIndex.value = startIndex;
      scheduleOnRN(beginFrameUpdates, startIndex);
    })
    .onUpdate(event => {
      dragX.value = event.x;
      dragY.value = event.y;
      const targetIndex = gridIndexForPoint(
        event.x,
        event.y,
        gridScrollOffset.value,
        media.length,
        layout,
      );
      if (shouldScheduleDragIndex(targetIndex, lastScheduledIndex.value)) {
        lastScheduledIndex.value = targetIndex;
        scheduleOnRN(updateDragAtIndex, targetIndex);
      }
    })
    .onFinalize(() => {
      dragActive.value = false;
      dragVelocity.value = 0;
      lastScheduledIndex.value = -1;
      scheduleOnRN(stopFrameUpdates);
    }), [
      beginFrameUpdates,
      dragActive,
      dragVelocity,
      dragX,
      dragY,
      gridScrollOffset,
      lastScheduledIndex,
      layout,
      media.length,
      nativeScrollGesture,
      stopFrameUpdates,
      updateDragAtIndex,
    ]);

  const deselectAll = React.useCallback(() => {
    setSelectedCount(selectionStore.clear());
  }, [selectionStore]);

  const selectAll = React.useCallback(async () => {
    if (loading || loadingMoreRef.current) return;
    const operation = selectionOperationRef.current;
    setLoading(true);
    try {
      const allMedia = media.slice();
      let after = pageCursorRef.current;
      let hasMore = hasNextPageRef.current;
      while (hasMore) {
        const page = await mediaScanner.getMediaPage(MEDIA_PAGE_SIZE, selectedAlbum, after);
        if (operation !== selectionOperationRef.current) return;
        for (const asset of page.assets) {
          if (loadedMediaIdsRef.current.has(asset.id)) continue;
          loadedMediaIdsRef.current.add(asset.id);
          allMedia.push(asset);
        }
        after = page.endCursor;
        hasMore = page.hasNextPage;
      }
      pageCursorRef.current = after;
      hasNextPageRef.current = false;
      setHasNextPage(false);
      setMedia(allMedia);
      applySelection(new Set(allMedia.map(asset => asset.id)));
    } catch {
      if (operation === selectionOperationRef.current) {
        console.error('Failed to select the complete media library.');
        Alert.alert('Selection unavailable', 'Could not load every photo and video. Try again.');
      }
    } finally {
      if (operation === selectionOperationRef.current) setLoading(false);
    }
  }, [applySelection, loading, media, selectedAlbum]);

  const selectedAssets = React.useCallback(async () => {
    const ids = selectionStore.getSelectedIds();
    const visibleById = new Map(media.map(item => [item.id, item]));
    const visibleSelection = Array.from(ids)
      .map(id => visibleById.get(id))
      .filter((item): item is MediaAsset => Boolean(item));
    if (visibleSelection.length === ids.size) return visibleSelection;
    return mediaScanner.getMediaByIds(ids, selectedAlbum);
  }, [media, selectedAlbum, selectionStore]);

  return {
    itemSize: layout.itemSize,
    itemOuterSize: layout.itemOuterSize,
    itemMargin: layout.itemMargin,
    contentPadding: layout.contentPadding,
    numColumns: layout.numColumns,
    media,
    hasNextPage,
    loadingMore,
    selectionStore,
    selectedCount,
    suppressNextPress,
    gridScrollOffset,
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
    beginDragSelection,
    endDragSelection,
    nativeScrollGesture,
    rangePan,
    deselectAll,
    selectAll,
    selectedAssets,
  };
}
