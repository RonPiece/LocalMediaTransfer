import { Alert } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as MediaLibrary from 'expo-media-library';

import {
  calculateMediaGridLayout,
  dragAutoScrollVelocity,
  dragSelectionDelta,
  gridIndexForPoint,
  nextAutoScrollOffset,
  shouldScheduleDragIndex,
  useMediaSelection,
} from './useMediaSelection';
import { mediaScanner } from '@/services/MediaScanner';

jest.mock('expo-media-library', () => ({
  getAssetsAsync: jest.fn(),
  SortBy: { creationTime: 'creationTime' },
}));

jest.mock('@/services/MediaScanner', () => ({
  mediaScanner: {
    getAlbums: jest.fn().mockResolvedValue([]),
    getMediaPage: jest.fn(),
    getMediaByIds: jest.fn(),
  },
}));

const asset = (id: string) => ({
  id,
  uri: `file://${id}.jpg`,
  type: 'photo' as const,
  modificationTime: 1710000000000,
  width: 100,
  height: 100,
  filename: `${id}.jpg`,
});

describe('useMediaSelection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (mediaScanner.getAlbums as jest.Mock).mockResolvedValue([]);
    (mediaScanner.getMediaPage as jest.Mock).mockResolvedValue({
      assets: [asset('visible-1'), asset('visible-2'), asset('visible-3')],
      hasNextPage: false,
      endCursor: 'end',
    });
    (mediaScanner.getMediaByIds as jest.Mock).mockResolvedValue([asset('visible-1'), asset('hidden-2'), asset('hidden-3')]);
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({ assets: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accounts for grid margins and padding when converting drag coordinates to indexes', () => {
    const layout = calculateMediaGridLayout(300, 3);

    expect(layout.itemSize).toBeCloseTo((300 - 2 - 6) / 3);
    expect(gridIndexForPoint(2, 0, 0, 30, layout)).toBe(0);
    expect(gridIndexForPoint(layout.itemOuterSize + layout.contentPadding + 2, 0, 0, 30, layout)).toBe(1);
    expect(gridIndexForPoint(2, layout.itemOuterSize + 1, 0, 30, layout)).toBe(3);
  });

  it('auto-scrolls only while drag selection is near a grid edge', () => {
    expect(dragAutoScrollVelocity(10, 600)).toBeLessThan(0);
    expect(dragAutoScrollVelocity(300, 600)).toBe(0);
    expect(dragAutoScrollVelocity(590, 600)).toBeGreaterThan(0);
  });

  it('uses frame time so auto-scroll distance is independent of display refresh rate', () => {
    const velocity = 480;
    let offset60Hz = 0;
    let offset120Hz = 0;
    for (let frame = 0; frame < 60; frame++) {
      offset60Hz = nextAutoScrollOffset({ currentOffset: offset60Hz, velocity, elapsedMs: 1000 / 60, maxOffset: 2000 });
    }
    for (let frame = 0; frame < 120; frame++) {
      offset120Hz = nextAutoScrollOffset({ currentOffset: offset120Hz, velocity, elapsedMs: 1000 / 120, maxOffset: 2000 });
    }

    expect(offset60Hz).toBeCloseTo(480, 5);
    expect(offset120Hz).toBeCloseTo(480, 5);
    expect(nextAutoScrollOffset({ currentOffset: 4, velocity: -480, elapsedMs: 50, maxOffset: 2000 })).toBe(0);
    expect(nextAutoScrollOffset({ currentOffset: 1996, velocity: 480, elapsedMs: 50, maxOffset: 2000 })).toBe(2000);
  });

  it('bridges selection work only when the drag enters a different valid cell', () => {
    expect(shouldScheduleDragIndex(4, 3)).toBe(true);
    expect(shouldScheduleDragIndex(4, 4)).toBe(false);
    expect(shouldScheduleDragIndex(-1, 4)).toBe(false);
  });

  it('updates only the delta when a drag range grows or shrinks', () => {
    const media = [asset('0'), asset('1'), asset('2'), asset('3'), asset('4')];
    const baseline = new Set(['0']);

    expect(Array.from(dragSelectionDelta({
      media,
      getBaselineSelection: id => baseline.has(id),
      startIndex: 1,
      previousTargetIndex: 2,
      targetIndex: 4,
      selectMode: true,
    }))).toEqual([
      ['3', true],
      ['4', true],
    ]);

    expect(Array.from(dragSelectionDelta({
      media,
      getBaselineSelection: id => baseline.has(id),
      startIndex: 1,
      previousTargetIndex: 4,
      targetIndex: 2,
      selectMode: true,
    }))).toEqual([
      ['3', false],
      ['4', false],
    ]);
  });

  it('loads only the first media page until the grid requests more', async () => {
    (mediaScanner.getMediaPage as jest.Mock)
      .mockResolvedValueOnce({
        assets: [asset('visible-1'), asset('visible-2')],
        hasNextPage: true,
        endCursor: 'page-1',
      })
      .mockResolvedValueOnce({
        assets: [asset('visible-3'), asset('visible-4')],
        hasNextPage: false,
        endCursor: 'page-2',
      });
    const { result } = renderHook(() => useMediaSelection());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mediaScanner.getMediaPage).toHaveBeenCalledTimes(1);
    expect(mediaScanner.getMediaPage).toHaveBeenCalledWith(120, undefined);
    expect(result.current.media).toHaveLength(2);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.loadMoreMedia();
    });

    expect(mediaScanner.getMediaPage).toHaveBeenLastCalledWith(120, undefined, 'page-1');
    expect(result.current.media).toHaveLength(4);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('loads remaining pages only when Select All explicitly needs them', async () => {
    (mediaScanner.getMediaPage as jest.Mock)
      .mockResolvedValueOnce({
        assets: [asset('visible-1'), asset('visible-2')],
        hasNextPage: true,
        endCursor: 'page-1',
      })
      .mockResolvedValueOnce({
        assets: [asset('visible-3'), asset('visible-4')],
        hasNextPage: false,
        endCursor: 'page-2',
      });
    const { result } = renderHook(() => useMediaSelection());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.selectAll();
    });

    expect(result.current.media).toHaveLength(4);
    expect(result.current.selectedCount).toBe(4);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('bounds concurrent native album-cover lookups', async () => {
    const albums = Array.from({ length: 10 }, (_, index) => ({
      id: `album-${index}`,
      title: `Album ${index}`,
      assetCount: 1,
    }));
    let activeLookups = 0;
    let peakLookups = 0;
    (mediaScanner.getAlbums as jest.Mock).mockResolvedValue(albums);
    (MediaLibrary.getAssetsAsync as jest.Mock).mockImplementation(async () => {
      activeLookups += 1;
      peakLookups = Math.max(peakLookups, activeLookups);
      await new Promise(resolve => setTimeout(resolve, 2));
      activeLookups -= 1;
      return { assets: [] };
    });

    const { result } = renderHook(() => useMediaSelection());
    await waitFor(() => expect(result.current.albums).toHaveLength(10));
    await waitFor(() => expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledTimes(11));
    await waitFor(() => expect(activeLookups).toBe(0));

    expect(peakLookups).toBeLessThanOrEqual(4);
  });

  it('resolves selected assets directly from the complete visible grid', async () => {
    const { result } = renderHook(() => useMediaSelection());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.selectAll();
    });
    const selected = await result.current.selectedAssets();

    expect(mediaScanner.getMediaByIds).not.toHaveBeenCalled();
    expect(selected.map(item => item.id)).toEqual(['visible-1', 'visible-2', 'visible-3']);
  });

  it('does not clone the complete selected set when drag selection activates', async () => {
    const { result } = renderHook(() => useMediaSelection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.toggleSelection('visible-1'));
    const snapshotSpy = jest.spyOn(result.current.selectionStore, 'getSelectedIds');

    act(() => result.current.beginDragSelection(1));

    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(result.current.selectedCount).toBe(2);
  });

  it('clears loading and reports a useful error when recent media fails to load', async () => {
    (mediaScanner.getMediaPage as jest.Mock).mockRejectedValueOnce(new Error('photos unavailable'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useMediaSelection());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.media).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('Failed to load media library.');
    expect(alertSpy).toHaveBeenCalledWith(
      'Media unavailable',
      'Could not load photos and videos. Check Photos permission and try again.',
    );
  });

});
