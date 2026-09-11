import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TransferProgressScreen, { transferProgressLayout } from './TransferProgressScreen';
import { uploadManager } from '@/services/UploadManager';
import { TransferProgressRing } from './components/TransferProgressRing';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: () => <></> };
}, { virtual: true });

jest.mock('expo-keep-awake', () => ({
  useKeepAwake: jest.fn()
}));

// Mock UploadManager
jest.mock('@/services/UploadManager', () => ({
  uploadManager: {
    uploadFilesConcurrent: jest.fn(),
    cancel: jest.fn()
  }
}));

describe('TransferProgressScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockAssets: any[] = [
    { id: '1', filename: 'photo1.jpg', uri: 'file://photo1.jpg', type: 'photo', size: 1000 },
    { id: '2', filename: 'photo2.jpg', uri: 'file://photo2.jpg', type: 'photo', size: 2000 }
  ];

  it('caps the ring on iPad and compacts spacing on short iPhones', () => {
    expect(transferProgressLayout(393, 852)).toEqual({ compactHeight: false, ringSize: 220.08 });
    expect(transferProgressLayout(768, 1024)).toEqual({ compactHeight: false, ringSize: 240 });
    expect(transferProgressLayout(320, 568)).toEqual({ compactHeight: true, ringSize: 179.20000000000002 });
  });

  it('renders correctly and initiates upload', async () => {
    const mockOnComplete = jest.fn();
    const mockOnCancel = jest.fn();

    (uploadManager.uploadFilesConcurrent as jest.Mock).mockResolvedValue(undefined);

    render(
      <TransferProgressScreen 
        assets={mockAssets} 
        onCancel={mockOnCancel} 
        onComplete={mockOnComplete} 
      />
    );

    await waitFor(() => expect(uploadManager.uploadFilesConcurrent).toHaveBeenCalledWith(
      mockAssets,
      expect.objectContaining({
        onProgress: expect.any(Function),
        onComplete: expect.any(Function),
        onError: expect.any(Function),
        onFileStatusChange: expect.any(Function),
      }),
      {
        preparationMode: 'prepare-first',
        thermalPolicy: 'monitor-only',
        skipExactDuplicates: true,
        includeAdditionalMediaComponents: false,
      },
    ));
  });

  it('cancels transfer when Cancel is pressed', async () => {
    const mockOnComplete = jest.fn();
    const mockOnCancel = jest.fn();

    // Mock uploadFilesConcurrent to hang so we can cancel it
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(() => new Promise(() => {}));

    const { getByText } = render(
      <TransferProgressScreen 
        assets={mockAssets} 
        onCancel={mockOnCancel} 
        onComplete={mockOnComplete} 
      />
    );

    const cancelButton = getByText('Cancel Transfer');
    fireEvent.press(cancelButton);

    expect(uploadManager.cancel).toHaveBeenCalled();
    expect(mockOnCancel).toHaveBeenCalled();
    await waitFor(() => expect(getByText('Done')).toBeTruthy());
  });

  it('marks unfinished files failed when the upload manager reports an asynchronous fatal error', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(async (assets, observer) => {
      observer.onProgress({
        currentAsset: assets[0], bytesSent: 0, totalBytes: 1000, currentIndex: 0,
        acknowledgedMediaBytes: 0, plannedUploadMediaBytes: 1000, rateSampledAt: 0,
        status: 'uploading', currentMediaMBps: 0, averageMediaMBps: 0,
        peakMediaMBps: 0, currentEncodedMBps: 0,
      });
      await Promise.resolve();
      observer.onError(new Error('Desktop connection timed out'));
    });

    const screen = render(
      <TransferProgressScreen
        assets={mockAssets}
        onCancel={jest.fn()}
        onComplete={jest.fn()}
      />
    );

    expect(await screen.findByText('FAILED')).toBeTruthy();
    expect(await screen.findByText('View 2 errors')).toBeTruthy();
    fireEvent.press(screen.getByText('View 2 errors'));
    expect(screen.getByText('2 files · 1 reason group')).toBeTruthy();
    expect(screen.getByText('Files affected')).toBeTruthy();
    expect(alert).toHaveBeenCalledWith('Upload Fatal Error', 'Desktop connection timed out');
    alert.mockRestore();
  });

  it('shows completion metrics without retaining a live current-speed card', async () => {
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(async (_assets, observer) => {
      observer.onProgress({
        currentAsset: mockAssets[0], bytesSent: 3_000_000, totalBytes: 3_000_000, currentIndex: 2,
        acknowledgedMediaBytes: 1_000_000, plannedUploadMediaBytes: 1_000_000, rateSampledAt: 1000,
        status: 'uploading', currentMediaMBps: 23.1, averageMediaMBps: 23.1,
        peakMediaMBps: 23.4, currentEncodedMBps: 23.1,
      });
      observer.onFileStatusChange({ assetId: '1', status: 'success', transferFilename: 'photo1.jpg' });
      observer.onFileStatusChange({ assetId: '2', status: 'skipped', transferFilename: 'photo2.jpg' });
      observer.onComplete({
        sessionId: 'session', selectedFiles: 2, uploadedFiles: 1, skippedFiles: 1,
        failedFiles: 0, selectedBytes: 3_000_000, uploadedBytes: 1_000_000, skippedBytes: 2_000_000,
        uploadDurationMs: 1000, averageMediaMBps: 1, peakMediaMBps: 1.5,
      });
    });

    const screen = render(
      <TransferProgressScreen assets={mockAssets} onCancel={jest.fn()} onComplete={jest.fn()} />,
    );

    expect(await screen.findByText('Transfer summary')).toBeTruthy();
    expect(screen.queryByText('Current speed')).toBeNull();
    expect(screen.getByText('Average speed')).toBeTruthy();
    expect(screen.getByText('Peak speed')).toBeTruthy();
    expect(screen.getByText('1.0 MB')).toBeTruthy();
  });

  it('moves incomplete-size guidance into errors and exposes every affected filename', async () => {
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(async (_assets, observer) => {
      for (const asset of mockAssets) {
        observer.onFileStatusChange({
          assetId: asset.id,
          status: 'error',
          transferFilename: asset.filename,
          stage: 'rendition',
          errorCode: 'temporary-storage-limit',
          message: 'This iPhone does not have enough free space to prepare this media item.',
        });
      }
      observer.onComplete({
        sessionId: 'session', selectedFiles: 2, expandedFiles: 2,
        uploadedFiles: 0, skippedFiles: 0, failedFiles: 2,
        selectedBytes: 0, selectedMediaBytes: 0, additionalComponentsBytes: 0,
        selectedMediaFiles: 0, additionalComponentsFiles: 0, byteTotalComplete: false,
        uploadedBytes: 0, skippedBytes: 0, avoidedBytes: 0,
        finalizationDuplicateBytes: 0, preparationDurationMs: 28_000,
        uploadDurationMs: 30_000, averageMediaMBps: 0, peakMediaMBps: 0,
        completionStatus: 'mixed', diagnosticReportAvailable: true,
      });
    });

    const screen = render(
      <TransferProgressScreen assets={mockAssets} onCancel={jest.fn()} onComplete={jest.fn()} />,
    );

    expect(await screen.findByText('Preparation time')).toBeTruthy();
    expect(screen.queryByText('Size excludes media that could not be prepared.')).toBeNull();
    fireEvent.press(screen.getByText('View 2 errors'));
    expect(screen.getByText(/File-size totals include only media that could be prepared/)).toBeTruthy();
    expect(screen.getByText(/tap Done, open Settings, and turn on Transfer while preparing/)).toBeTruthy();
    fireEvent.press(screen.getByText('View all 2 affected filenames'));
    expect(screen.getByText('Affected files')).toBeTruthy();
    expect(screen.getByText('2 filenames')).toBeTruthy();
    expect(screen.getByText('photo1.jpg')).toBeTruthy();
    expect(screen.getByText('photo2.jpg')).toBeTruthy();
  });

  it('clamps progress ring display at 100 percent when bytes exceed total', () => {
    const screen = render(
      <TransferProgressRing
        size={200}
        isFinished={false}
        finalColor="#00ff00"
        completedItems={3}
        totalItems={2}
        unit="files"
        phaseLabel="Processing files"
      />,
    );

    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.getByText('files')).toBeTruthy();
    expect(screen.getByTestId('transfer-progress-count')).toHaveStyle({
      fontSize: 16,
      lineHeight: 19,
    });
  });

  it('keeps large final counts readable instead of scaling the subtitle down', () => {
    const screen = render(
      <TransferProgressRing
        size={220}
        isFinished
        finalColor="#00ff00"
        completedItems={19_807}
        totalItems={19_807}
        unit="files"
        phaseLabel="Transfer complete"
      />,
    );

    expect(screen.getByText('19,807 / 19,807')).toBeTruthy();
    expect(screen.getByTestId('transfer-progress-count')).toHaveStyle({
      fontSize: 16,
      lineHeight: 19,
    });
    expect(screen.getByTestId('transfer-progress-count').props.adjustsFontSizeToFit).toBeUndefined();
  });

  it('renders the percentage ring on a white circular surface', () => {
    const screen = render(
      <TransferProgressRing
        size={200}
        isFinished={false}
        finalColor="#00ff00"
        completedItems={1}
        totalItems={2}
        unit="files"
        phaseLabel="Processing files"
      />,
    );

    expect(screen.getByTestId('transfer-progress-ring')).toHaveStyle({
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: '#FFFFFF',
    });
  });

  it('keeps preparation visible during uploads and shows a green completion state', async () => {
    let observer: any;
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(
      async (_assets, nextObserver) => {
        observer = nextObserver;
        nextObserver.onProgress({
          currentAsset: mockAssets[0],
          bytesSent: 0,
          totalBytes: 0,
          acknowledgedMediaBytes: 0,
          plannedUploadMediaBytes: 1000,
          rateSampledAt: 0,
          status: 'uploading',
          currentMediaMBps: 0,
          averageMediaMBps: 0,
          peakMediaMBps: 0,
          currentEncodedMBps: 0,
          preparedFiles: 1,
          readyFiles: 1,
          totalFiles: 2,
          preparationComplete: false,
        });
        return new Promise(() => {});
      },
    );

    const screen = render(
      <TransferProgressScreen assets={mockAssets} onCancel={jest.fn()} onComplete={jest.fn()} />,
    );

    expect(await screen.findByText('Preparing media')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1 of 2 media items analyzed')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Preparing media. 1 of 2 media items analyzed. Show details'));
    expect(screen.getByText(/Upload begins after all selected media is ready/)).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('assets')).toBeTruthy();

    observer.onProgress({
      currentAsset: mockAssets[1],
      bytesSent: 0,
      totalBytes: 1000,
      acknowledgedMediaBytes: 0,
      plannedUploadMediaBytes: 1000,
      rateSampledAt: 0,
      status: 'uploading',
      currentMediaMBps: 0,
      averageMediaMBps: 0,
      peakMediaMBps: 0,
      currentEncodedMBps: 0,
      preparedFiles: 2,
      readyFiles: 3,
      totalFiles: 3,
      preparationComplete: true,
    });

    expect(await screen.findByText('Transferring files')).toBeTruthy();
    expect(screen.getByText('3 files remaining')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Transferring files. 3 files remaining. Hide details'));
    fireEvent.press(screen.getByLabelText('Transferring files. 3 files remaining. Show details'));
    expect(screen.getByText('2 selected Photos items produced 3 transfer entries. 3 files were prepared.')).toBeTruthy();
    expect(screen.getByText('Files processed')).toBeTruthy();
    expect(screen.getByText('0 / 3')).toBeTruthy();
    expect(screen.getByText('files')).toBeTruthy();
  });

  it('explains streaming preparation and passes the optional mode to scheduling', async () => {
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(
      () => new Promise(() => {}),
    );

    const screen = render(
      <TransferProgressScreen
        assets={mockAssets}
        preparationMode="streaming"
        onCancel={jest.fn()}
        onComplete={jest.fn()}
      />,
    );

    expect(await screen.findByText('Preparing media')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Preparing media. 0 of 2 media items analyzed. Show details'));
    expect(screen.getByText(
      'Media selected ✓ · Prepare and check · Transfer. In this mode, preparation and transfer overlap while the final size is determined.',
    )).toBeTruthy();
    expect(uploadManager.uploadFilesConcurrent).toHaveBeenCalledWith(
      mockAssets,
      expect.any(Object),
      {
        preparationMode: 'streaming',
        thermalPolicy: 'monitor-only',
        skipExactDuplicates: true,
        includeAdditionalMediaComponents: false,
      },
    );
  });

  it('uses stable compact preparation and transfer rows without exposing window-local counters', async () => {
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(
      async (_assets, observer) => {
        observer.onProgress({
          currentAsset: mockAssets[0],
          bytesSent: 100,
          totalBytes: 0,
          acknowledgedMediaBytes: 100,
          plannedUploadMediaBytes: 1000,
          rateSampledAt: 1,
          status: 'uploading',
          preparationActivity: 'preparing',
          currentMediaMBps: 1,
          averageMediaMBps: 1,
          peakMediaMBps: 1,
          currentEncodedMBps: 1,
          preparedFiles: 1,
          readyFiles: 2,
          totalFiles: 2,
          preparationComplete: false,
          preparationMode: 'streaming',
        });
        observer.onProgress({
          currentAsset: mockAssets[0],
          bytesSent: 100,
          totalBytes: 0,
          acknowledgedMediaBytes: 100,
          plannedUploadMediaBytes: 1000,
          rateSampledAt: 1,
          status: 'waiting',
          preparationActivity: 'waiting',
          currentMediaMBps: 1,
          averageMediaMBps: 1,
          peakMediaMBps: 1,
          currentEncodedMBps: 1,
          preparedFiles: 1,
          readyFiles: 2,
          totalFiles: 2,
          preparationComplete: false,
          preparationMode: 'streaming',
          automaticallyStreamsLargeSelection: true,
        });
        observer.onProgress({
          currentAsset: mockAssets[0],
          bytesSent: 100,
          totalBytes: 0,
          acknowledgedMediaBytes: 100,
          plannedUploadMediaBytes: 1000,
          rateSampledAt: 1,
          status: 'checking',
          preparationActivity: 'checking',
          duplicateCheckStage: 'finding-matches',
          checkedFiles: 0,
          duplicateCandidates: 16,
          currentMediaMBps: 1,
          averageMediaMBps: 1,
          peakMediaMBps: 1,
          currentEncodedMBps: 1,
          preparedFiles: 1,
          readyFiles: 2,
          totalFiles: 2,
          preparationComplete: false,
          preparationMode: 'streaming',
          automaticallyStreamsLargeSelection: true,
        });
        return new Promise(() => {});
      },
    );

    const screen = render(
      <TransferProgressScreen
        assets={mockAssets}
        preparationMode="streaming"
        onCancel={jest.fn()}
        onComplete={jest.fn()}
      />,
    );

    expect(await screen.findByText('Transferring while preparing media')).toBeTruthy();
    expect(screen.queryByText('Waiting for upload capacity')).toBeNull();
    expect(await screen.findByTestId('concurrent-transfer-progress')).toBeTruthy();
    expect(screen.queryByTestId('transfer-progress-ring')).toBeNull();
    expect(screen.getByText('Preparing media')).toBeTruthy();
    expect(screen.getByText('Transferring files')).toBeTruthy();
    expect(await screen.findByText('1 of 2 media items analyzed')).toBeTruthy();
    expect(screen.getByText('Media left to analyze')).toBeTruthy();
    expect(screen.getByText('Transferred')).toBeTruthy();
    expect(screen.getByText('Speed')).toBeTruthy();
    expect(screen.getByText('0.0 MB')).toBeTruthy();
    expect(screen.queryByText(/0 of 16 checked/)).toBeNull();
    expect(screen.queryByText(/transferred ·/)).toBeNull();
    expect(screen.getByText('Elapsed')).toBeTruthy();
    expect(screen.queryByText('Time remaining')).toBeNull();

    fireEvent.press(screen.getByLabelText('Transferring while preparing media. Show details'));
    expect(screen.getByText(
      'To protect iPhone storage, this large selection automatically uses Transfer while preparing. Prepared files upload and release while later items are analyzed.',
    )).toBeTruthy();
    expect(screen.getByText(
      'Possible matches are checked before upload. Windows makes the final duplicate decision.',
    )).toBeTruthy();
  });

  it('shows truthful duplicate-check stages before upload without technical hash wording', async () => {
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(
      async (_assets, observer) => {
        observer.onProgress({
          currentAsset: mockAssets[0],
          bytesSent: 0,
          totalBytes: 0,
          acknowledgedMediaBytes: 0,
          plannedUploadMediaBytes: 0,
          rateSampledAt: 0,
          status: 'checking',
          preparationActivity: 'checking',
          duplicateCheckStage: 'verifying-windows',
          checkedFiles: 200,
          duplicateCandidates: 388,
          currentMediaMBps: 0,
          averageMediaMBps: 0,
          peakMediaMBps: 0,
          currentEncodedMBps: 0,
          preparedFiles: 1,
          readyFiles: 1,
          totalFiles: 2,
          preparationComplete: false,
          preparationMode: 'prepare-first',
        });
        return new Promise(() => {});
      },
    );

    const screen = render(
      <TransferProgressScreen assets={mockAssets} onCancel={jest.fn()} onComplete={jest.fn()} />,
    );

    expect(await screen.findByText('Checking for duplicates')).toBeTruthy();
    expect(screen.getByText('Verifying matches on Windows · 200 of 388 checked · 188 remaining')).toBeTruthy();
    expect(screen.queryByText(/SHA-256/)).toBeNull();
  });

  it('advances file progress for skips and never says thermal pressure paused the transfer', async () => {
    (uploadManager.uploadFilesConcurrent as jest.Mock).mockImplementation(
      async (_assets, observer) => {
        observer.onProgress({
          currentAsset: mockAssets[0],
          bytesSent: 0,
          totalBytes: 1000,
          acknowledgedMediaBytes: 0,
          plannedUploadMediaBytes: 1000,
          rateSampledAt: 0,
          status: 'uploading',
          currentMediaMBps: 0,
          averageMediaMBps: 0,
          peakMediaMBps: 0,
          currentEncodedMBps: 0,
          preparedFiles: 2,
          totalFiles: 2,
          preparationComplete: true,
        });
        observer.onFileStatusChange({
          assetId: '1',
          status: 'skipped',
          transferFilename: 'photo1.jpg',
        });
        observer.onThermalStateChange('critical');
        return new Promise(() => {});
      },
    );

    const screen = render(
      <TransferProgressScreen assets={mockAssets} onCancel={jest.fn()} onComplete={jest.fn()} />,
    );

    expect(await screen.findByText('50%')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('files')).toBeTruthy();
    expect(screen.queryByText('iPhone is warm')).toBeNull();
    expect(screen.queryByText(/reduced speed/i)).toBeNull();
    expect(screen.queryByText(/paused/i)).toBeNull();
  });
});
