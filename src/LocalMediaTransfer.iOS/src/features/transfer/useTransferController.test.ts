import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { uploadManager } from '@/services/UploadManager';
import { MediaAsset } from '@/services/MediaScanner';
import { useTransferController } from './useTransferController';

jest.mock('@/services/UploadManager', () => ({
  uploadManager: {
    uploadFilesConcurrent: jest.fn(),
    cancel: jest.fn(),
  },
}));

type UploadCallbacks = {
  progress: (...args: any[]) => void;
  complete: (summary?: any) => void;
  error: (error: unknown, summary?: any) => void;
  fileStatus: (...args: any[]) => void;
};

describe('useTransferController', () => {
  const assets: MediaAsset[] = [
    { id: '1', filename: 'one.jpg', uri: 'file://one.jpg', type: 'photo', modificationTime: 1, width: 10, height: 10 },
    { id: '2', filename: 'two.jpg', uri: 'file://two.jpg', type: 'photo', modificationTime: 2, width: 10, height: 10 },
  ];
  let callbacks: UploadCallbacks;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    jest.clearAllMocks();
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(
      (_assets, observer) => {
        callbacks = {
          progress: observer.onProgress,
          complete: observer.onComplete,
          error: observer.onError,
          fileStatus: observer.onFileStatusChange,
        };
        return new Promise(() => undefined);
      },
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes only the latest high-frequency progress update at the UI cadence', () => {
    const { result, unmount } = renderHook(() => useTransferController({ assets, onCancel: jest.fn() }));

    act(() => {
      for (let index = 1; index <= 50; index += 1) {
        callbacks.progress({
          currentAsset: assets[0],
          bytesSent: index * 10,
          totalBytes: 1000,
          acknowledgedMediaBytes: index * 10,
          plannedUploadMediaBytes: 1000,
          rateSampledAt: 1000,
          currentIndex: 0,
          status: 'uploading',
          preparationComplete: true,
          currentMediaMBps: index,
          averageMediaMBps: index / 2,
          peakMediaMBps: index + 10,
          currentEncodedMBps: index,
        });
      }
      jest.advanceTimersByTime(99);
    });
    expect(result.current.currentProgress).toBeNull();

    act(() => jest.advanceTimersByTime(1));
    expect(result.current.currentProgress?.bytesSent).toBe(500);
    expect(result.current.currentMediaMBps).toBe(0);

    act(() => jest.advanceTimersByTime(900));
    expect(result.current.currentMediaMBps).toBe(50);
    expect(result.current.averageMediaMBps).toBe(25);
    unmount();
  });

  it('publishes rounded ETA buckets once per second, expires stale samples, and recovers', () => {
    const { result, unmount } = renderHook(() => useTransferController({ assets, onCancel: jest.fn() }));

    act(() => callbacks.progress({
      currentAsset: assets[0], bytesSent: 0, totalBytes: 650_000_000,
      acknowledgedMediaBytes: 0, plannedUploadMediaBytes: 650_000_000, rateSampledAt: 1000,
      currentIndex: 0, status: 'uploading', currentMediaMBps: 10,
      preparationComplete: true,
      averageMediaMBps: 10, peakMediaMBps: 10, currentEncodedMBps: 10,
    }));

    act(() => jest.advanceTimersByTime(1000));
    expect(result.current.etaText).toBe('Calculating…');
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current.etaText).toBe('About 1 min');

    act(() => jest.advanceTimersByTime(4000));
    expect(result.current.etaText).toBe('Calculating…');

    act(() => callbacks.progress({
      currentAsset: assets[0], bytesSent: 10_000_000, totalBytes: 650_000_000,
      acknowledgedMediaBytes: 10_000_000, plannedUploadMediaBytes: 650_000_000, rateSampledAt: 7000,
      currentIndex: 0, status: 'uploading', currentMediaMBps: 10,
      preparationComplete: true,
      averageMediaMBps: 10, peakMediaMBps: 10, currentEncodedMBps: 10,
    }));
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current.etaText).toBe('About 1 min');
    unmount();
  });

  it('withholds ETA until preparation completes and starts with a fresh estimate', () => {
    const { result, unmount } = renderHook(() => useTransferController({
      assets,
      onCancel: jest.fn(),
      preparationMode: 'streaming',
    }));

    act(() => callbacks.progress({
      currentAsset: assets[0],
      bytesSent: 50_000_000,
      totalBytes: 0,
      acknowledgedMediaBytes: 50_000_000,
      plannedUploadMediaBytes: 50_000_000,
      rateSampledAt: 1000,
      currentIndex: 0,
      status: 'uploading',
      preparationComplete: false,
      currentMediaMBps: 50,
      averageMediaMBps: 50,
      peakMediaMBps: 50,
      currentEncodedMBps: 50,
    }));
    act(() => jest.advanceTimersByTime(5000));
    expect(result.current.etaText).toBe('Calculating…');
    expect(result.current.elapsedSeconds).toBe(5);
    expect(result.current.hasUploadStarted).toBe(true);

    act(() => callbacks.progress({
      currentAsset: assets[1],
      bytesSent: 0,
      totalBytes: 100_000_000,
      acknowledgedMediaBytes: 0,
      plannedUploadMediaBytes: 100_000_000,
      rateSampledAt: 6000,
      currentIndex: 0,
      status: 'uploading',
      preparationComplete: true,
      currentMediaMBps: 10,
      averageMediaMBps: 10,
      peakMediaMBps: 10,
      currentEncodedMBps: 10,
    }));
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current.etaText).toBe('Calculating…');
    act(() => jest.advanceTimersByTime(1000));
    expect(result.current.etaText).not.toBe('Calculating…');
    unmount();
  });

  it('delays and briefly holds the queue catch-up note without moving preparation backward', () => {
    const { result, unmount } = renderHook(() => useTransferController({
      assets,
      onCancel: jest.fn(),
      preparationMode: 'streaming',
    }));

    act(() => callbacks.progress({
      currentAsset: assets[0], bytesSent: 10, totalBytes: 0,
      acknowledgedMediaBytes: 10, plannedUploadMediaBytes: 100, rateSampledAt: 1000,
      currentIndex: 0, status: 'uploading', preparationActivity: 'preparing',
      preparationComplete: false, preparedFiles: 1, readyFiles: 2, totalFiles: 2,
      currentMediaMBps: 1, averageMediaMBps: 1, peakMediaMBps: 1, currentEncodedMBps: 1,
    }));
    act(() => jest.advanceTimersByTime(100));
    expect(result.current.hasUploadStarted).toBe(true);

    act(() => callbacks.progress({
      currentAsset: assets[0], bytesSent: 10, totalBytes: 0,
      acknowledgedMediaBytes: 10, plannedUploadMediaBytes: 100, rateSampledAt: 1000,
      currentIndex: 0, status: 'waiting', preparationActivity: 'waiting',
      preparationComplete: false, preparedFiles: 1, readyFiles: 2, totalFiles: 2,
      currentMediaMBps: 1, averageMediaMBps: 1, peakMediaMBps: 1, currentEncodedMBps: 1,
    }));
    act(() => jest.advanceTimersByTime(100));
    expect(result.current.phase).toBe('waiting');
    expect(result.current.preparedFiles).toBe(1);
    expect(result.current.queueCatchUpVisible).toBe(false);
    act(() => jest.advanceTimersByTime(999));
    expect(result.current.queueCatchUpVisible).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current.queueCatchUpVisible).toBe(true);

    act(() => callbacks.progress({
      currentAsset: assets[0], bytesSent: 20, totalBytes: 0,
      acknowledgedMediaBytes: 20, plannedUploadMediaBytes: 100, rateSampledAt: 1100,
      currentIndex: 0, status: 'preparing', preparationActivity: 'preparing',
      preparationComplete: false, preparedFiles: 0, readyFiles: 2, totalFiles: 2,
      currentMediaMBps: 1, averageMediaMBps: 1, peakMediaMBps: 1, currentEncodedMBps: 1,
    }));
    act(() => jest.advanceTimersByTime(100));
    expect(result.current.phase).toBe('preparing');
    expect(result.current.preparedFiles).toBe(1);
    expect(result.current.queueCatchUpVisible).toBe(true);
    act(() => jest.advanceTimersByTime(649));
    expect(result.current.queueCatchUpVisible).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current.queueCatchUpVisible).toBe(false);
    unmount();
  });

  it('preserves the duplicate verification stage and counters', () => {
    const { result, unmount } = renderHook(() => useTransferController({ assets, onCancel: jest.fn() }));

    act(() => callbacks.progress({
      currentAsset: assets[0], bytesSent: 0, totalBytes: 0,
      acknowledgedMediaBytes: 0, plannedUploadMediaBytes: 0, rateSampledAt: 0,
      currentIndex: 0, status: 'checking', preparationActivity: 'checking',
      duplicateCheckStage: 'verifying-windows', checkedFiles: 100, duplicateCandidates: 188,
      preparationComplete: false, preparedFiles: 1, readyFiles: 1, totalFiles: 2,
      currentMediaMBps: 0, averageMediaMBps: 0, peakMediaMBps: 0, currentEncodedMBps: 0,
    }));
    act(() => jest.advanceTimersByTime(100));

    expect(result.current.phase).toBe('checking');
    expect(result.current.duplicateCheck).toEqual({
      stage: 'verifying-windows',
      checked: 100,
      total: 188,
    });
    unmount();
  });

  it('snapshots the complete result map once instead of copying it after every file', () => {
    const { result, unmount } = renderHook(() => useTransferController({ assets, onCancel: jest.fn() }));

    act(() => {
      callbacks.fileStatus({
        assetId: '1',
        status: 'success',
        transferFilename: 'IMG_3231.HEIC',
        savedFilename: 'IMG_3231 (2).HEIC',
        message: 'Saved as IMG_3231 (2).HEIC',
      });
      callbacks.fileStatus({
        assetId: '2',
        status: 'error',
        transferFilename: 'two.jpg',
        message: 'failed',
      });
    });
    expect(result.current.resultList).toEqual([]);

    act(() => callbacks.complete({ averageMediaMBps: 20, peakMediaMBps: 60 }));
    expect(result.current.resultList).toEqual([
      expect.objectContaining({
        id: '1',
        filename: 'IMG_3231.HEIC',
        status: 'success',
        msg: 'Saved as IMG_3231 (2).HEIC',
      }),
      expect.objectContaining({ id: '2', status: 'error' }),
    ]);
    expect(result.current.summary).toEqual({ success: 1, skipped: 0, failed: 1 });
    expect(result.current.averageMediaMBps).toBe(20);
    expect(result.current.peakMediaMBps).toBe(60);
    unmount();
  });

  it('ignores late upload callbacks and clears its timer after unmount', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useTransferController({ assets, onCancel: jest.fn() }));

    unmount();
    act(() => {
      callbacks.progress({
        currentAsset: assets[0], bytesSent: 100, totalBytes: 1000,
        acknowledgedMediaBytes: 100, plannedUploadMediaBytes: 1000, rateSampledAt: 1000,
        status: 'uploading',
      });
      callbacks.fileStatus({
        assetId: '1',
        status: 'error',
        transferFilename: 'one.jpg',
        message: 'late error',
      });
      callbacks.error(new Error('late fatal error'));
      callbacks.complete();
      jest.runOnlyPendingTimers();
    });

    expect(uploadManager.cancel).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    alert.mockRestore();
  });

  it('stops UI publication immediately when cancellation is requested', () => {
    const onCancel = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useTransferController({ assets, onCancel }));

    act(() => result.current.cancelTransfer());
    act(() => callbacks.error(new Error('cancelled request completed late')));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(uploadManager.cancel).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    unmount();
    alert.mockRestore();
  });
});
