import { UploadManager } from './UploadManager';
import { MediaScanner } from './MediaScanner';
import { ThroughputTracker } from './upload/ThroughputTracker';
import { OutgoingHashRegistry, runDuplicatePreflightWindow } from './upload/duplicatePreflight';
import { NATIVE_FILENAME_BATCH_SIZE, prepareAssetsForUpload } from './upload/prepareAssets';
import { api } from '@/api/ApiClient';
import { nativeCapabilities } from './NativeCapabilities';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as http from 'http';

type UploadManagerHarness = {
  uploadEncodedChunk: jest.Mock;
};

type NativeCapabilitiesHarness = Omit<
  typeof nativeCapabilities,
  'available' | 'prepareAssetWindow'
> & {
  available: boolean;
  prepareAssetWindow?: jest.Mock;
};

type PersistedDiagnostic = {
  schemaVersion: number;
  firstUploadStartedElapsedMs?: number;
  firstAcknowledgementElapsedMs?: number;
  preparationCompletedElapsedMs?: number;
  plannedUploadBytes: number;
  acknowledgedBytes: number;
  skippedBytes: number;
  preflightSkippedFiles: number;
  preflightSkippedBytes: number;
  serverSkippedFiles: number;
  serverSkippedBytes: number;
  averageMediaMBps: number;
  peakMediaMBps: number;
  queueMaxDepth: number;
  maxActiveUploadWorkers: number;
  filenameResolvedAppleFiles: number;
  filenameFallbackFiles: number;
  peakNativeResidentMemoryBytes: number;
  preflight: {
    componentsConsidered: number;
    metadataUploadFiles: number;
    receiverCandidateFiles: number;
    hashedFiles: number;
    hashedBytes: number;
    hashedThenUploadedFiles: number;
    hashedThenUploadedBytes: number;
    receiverSkippedFiles: number;
    outgoingSkippedFiles: number;
    metadataRequestCount: number;
    verificationRequestCount: number;
    allUploadWorkersIdleDuringPreflightMs: number;
  };
  uploadTiming: {
    measuredFiles: number;
    fileReadDurationMs: number;
    httpRequestDurationMs: number;
    interChunkGapDurationMs: number;
    serverWriteDurationMs: number;
    serverFinalizeDurationMs: number;
    maxServerFinalizeDurationMs: number;
  };
  windows: {
    windowIndex: number;
    status: string;
    startedElapsedMs: number;
    readyElapsedMs?: number;
    enqueueCompletedElapsedMs?: number;
  }[];
};

function latestPersistedDiagnostic(): PersistedDiagnostic {
  const files = (FileSystem as unknown as {
    __diagnosticFiles: Map<string, { contents: string }>;
  }).__diagnosticFiles;
  const reports = Array.from(files.entries())
    .filter(([path]) => path.endsWith('.json'));
  expect(reports).not.toHaveLength(0);
  return JSON.parse(reports.at(-1)?.[1].contents ?? '{}') as PersistedDiagnostic;
}

jest.mock('@/api/ApiClient', () => ({
  ApiRequestError: class ApiRequestError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiRequestError';
      this.status = status;
    }
  },
  api: {
    preflightCheck: jest.fn().mockResolvedValue([]),
    preflightVerify: jest.fn().mockResolvedValue({ files: [] }),
    transferHistory: jest.fn(),
    logClientEvent: jest.fn().mockResolvedValue(undefined),
    pingServer: jest.fn().mockResolvedValue(true),
    reportClientSpeed: jest.fn().mockResolvedValue(undefined),
    cancelUploadSession: jest.fn().mockResolvedValue(undefined),
    notifyUnauthorized: jest.fn(),
    url: 'http://127.0.0.1:18081',
    uploadToken: 'test-token',
  }
}));

jest.mock('expo-media-library', () => ({
  getAssetInfoAsync: jest.fn().mockResolvedValue(null),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getAssetsAsync: jest.fn(),
  SortBy: { creationTime: 'creationTime' },
  MediaType: { photo: 'photo', video: 'video' },
}));

jest.mock('expo-file-system/legacy', () => {
  const diagnosticFiles = new Map<string, {
    contents: string;
    modificationTime: number;
  }>();
  let modificationTime = Date.now() / 1000;
  return {
    documentDirectory: 'file:///documents/',
    getInfoAsync: jest.fn(),
    readAsStringAsync: jest.fn().mockResolvedValue('bmF0aXZlLWNodW5r'),
    makeDirectoryAsync: jest.fn(),
    writeAsStringAsync: jest.fn(async (path: string, contents: string) => {
      diagnosticFiles.set(path, { contents, modificationTime: modificationTime++ });
    }),
    deleteAsync: jest.fn(async (path: string) => {
      diagnosticFiles.delete(path);
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const value = diagnosticFiles.get(from);
      if (!value) throw new Error('missing temporary diagnostic report');
      diagnosticFiles.delete(from);
      diagnosticFiles.set(to, { ...value, modificationTime: modificationTime++ });
    }),
    readDirectoryAsync: jest.fn(async () =>
      Array.from(diagnosticFiles.keys())
        .filter(path => path.endsWith('.json'))
        .map(path => path.split('/').at(-1))),
    EncodingType: { Base64: 'base64' },
    __diagnosticFiles: diagnosticFiles,
  };
});

jest.mock('./NativeCapabilities', () => ({
  nativeCapabilities: {
    available: false,
    resolveAssetFilenames: jest.fn(async (requests) => requests.map((request: {
      assetId: string;
      fallbackFilename: string;
    }) => ({
      assetId: request.assetId,
      filename: request.fallbackFilename,
      source: 'expo-fallback',
    }))),
    uploadFile: jest.fn(),
    beginTransfer: jest.fn(),
    releasePreparedFile: jest.fn(),
    endTransfer: jest.fn(),
    cancel: jest.fn(),
    getThermalState: jest.fn().mockResolvedValue('nominal'),
    addProgressListener: jest.fn(() => ({ remove: jest.fn() })),
    addThermalStateListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

describe('UploadManager Integration', () => {
  let manager: UploadManager;
  let server: http.Server;
  let receivedChunks = 0;
  let failedChunkResponses = 0;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/upload_chunk') {
        receivedChunks++;
        if (failedChunkResponses > 0) {
          failedChunkResponses--;
          res.writeHead(500);
          res.end('temporary failure');
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(18081, '127.0.0.1', done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    manager = new UploadManager();
    jest.clearAllMocks();
    (api.cancelUploadSession as jest.Mock).mockResolvedValue(undefined);
    (nativeCapabilities as NativeCapabilitiesHarness).available = false;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow = undefined;
    nativeCapabilities.hashPreparedFiles = jest.fn().mockResolvedValue([]);
    (nativeCapabilities.resolveAssetFilenames as jest.Mock).mockImplementation(async (requests) =>
      requests.map((request: { assetId: string; fallbackFilename: string }) => ({
        assetId: request.assetId,
        filename: request.fallbackFilename,
        source: 'expo-fallback',
      })));
    (FileSystem as unknown as {
      __diagnosticFiles: Map<string, {
        contents: string;
        modificationTime: number;
      }>;
    }).__diagnosticFiles.clear();
    const diagnosticFiles = (FileSystem as unknown as {
      __diagnosticFiles: Map<string, {
        contents: string;
        modificationTime: number;
      }>;
    }).__diagnosticFiles;
    (FileSystem.writeAsStringAsync as jest.Mock).mockImplementation(
      async (path: string, contents: string) => {
        diagnosticFiles.set(path, {
          contents,
          modificationTime: Date.now() / 1000,
        });
      },
    );
    receivedChunks = 0;
    failedChunkResponses = 0;
  });

  it('sends bounded encoded chunks to a live loopback server', async () => {
    const assets = [{
      id: 'integration_1', uri: 'file://real.mp4', type: 'video' as const, modificationTime: 0,
      width: 100, height: 100, filename: 'real.mp4'
    }];
    
    // 5 MiB is split into a 4 MiB chunk and a final 1 MiB chunk.
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async () => ({ exists: true, size: 5 * 1024 * 1024, isDirectory: false }));
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [{ id: 'integration_1', action: 'upload' }] });
    const onProgress = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    await manager.uploadFilesConcurrent(assets, { onProgress, onComplete, onError });

    expect(onComplete).toHaveBeenCalled();
    expect(receivedChunks).toBe(2);
    expect(FileSystem.readAsStringAsync).toHaveBeenNthCalledWith(1, 'file://real.mp4', expect.objectContaining({ position: 0, length: 4 * 1024 * 1024 }));
  });

  it('retries a temporary chunk failure without double-counting acknowledged media bytes', async () => {
    const asset = {
      id: 'retry-1', uri: 'file://retry.jpg', type: 'photo' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'retry.jpg',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1_000_000, isDirectory: false });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [{ id: asset.id, action: 'upload' }] });
    failedChunkResponses = 1;
    const onProgress = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress, onComplete: jest.fn(), onError: jest.fn(),
    });

    expect(receivedChunks).toBe(2);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      acknowledgedMediaBytes: 1_000_000,
      plannedUploadMediaBytes: 1_000_000,
    }));
  });

  it('processes 10,000 files with bounded metadata concurrency and no batch barriers', async () => {
    const assets = Array.from({ length: 10000 }, (_, index) => ({
      id: `stress-${index}`,
      uri: `file://stress-${index}.jpg`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `stress-${index}.jpg`,
    }));
    let activeLookups = 0;
    let peakLookups = 0;
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockImplementation(async () => {
      activeLookups++;
      peakLookups = Math.max(peakLookups, activeLookups);
      await Promise.resolve();
      activeLookups--;
      return null;
    });
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1, isDirectory: false });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [] });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue('{}');
    const onComplete = jest.fn();
    const onError = jest.fn();
    const onProgress = jest.fn();

    await manager.uploadFilesConcurrent(assets, { onProgress, onComplete, onError });

    expect(peakLookups).toBeLessThanOrEqual(8);
    expect(harness.uploadEncodedChunk).toHaveBeenCalledTimes(10000);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ batchIndex: 40, totalBatches: 40 }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  }, 60000);

  it('starts uploading the first 250-item window while the next window is still preparing', async () => {
    const assets = Array.from({ length: 251 }, (_, index) => ({
      id: `stream-${index}`,
      uri: `file://stream-${index}.jpg`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `stream-${index}.jpg`,
    }));
    let releaseSecondWindow!: () => void;
    const secondWindowBlocked = new Promise<void>(resolve => {
      releaseSecondWindow = resolve;
    });
    let secondWindowStarted = false;
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockImplementation(async (assetId: string) => {
      if (assetId === 'stream-250') {
        secondWindowStarted = true;
        await secondWindowBlocked;
      }
      return null;
    });
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1,
      isDirectory: false,
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [] });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue('{}');

    const transfer = manager.uploadFilesConcurrent(assets, {
      onProgress: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    }, {
      preparationMode: 'streaming',
      thermalPolicy: 'monitor-only',
    });
    for (let attempt = 0; attempt < 20 && harness.uploadEncodedChunk.mock.calls.length === 0; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(secondWindowStarted).toBe(true);
    expect(harness.uploadEncodedChunk).toHaveBeenCalled();
    releaseSecondWindow();
    await transfer;
    expect(harness.uploadEncodedChunk).toHaveBeenCalledTimes(251);
    const completionLog = (api.logClientEvent as jest.Mock).mock.calls.find(
      call => call[1] === 'transfer_completed',
    );
    expect(completionLog?.[3]).toEqual(expect.objectContaining({
      queueMaxDepth: expect.any(Number),
    }));
    expect((completionLog?.[3] as { queueMaxDepth: number }).queueMaxDepth)
      .toBeLessThanOrEqual(NATIVE_FILENAME_BATCH_SIZE);
    const diagnostic = latestPersistedDiagnostic();
    expect(diagnostic.schemaVersion).toBe(6);
    expect(diagnostic.windows).toHaveLength(2);
    expect(diagnostic.windows.map(window => window.status)).toEqual([
      'enqueued',
      'enqueued',
    ]);
    expect(diagnostic.windows.map(window => window.windowIndex)).toEqual([0, 1]);
    expect(diagnostic.firstUploadStartedElapsedMs).toEqual(expect.any(Number));
    expect(diagnostic.firstUploadStartedElapsedMs)
      .toBeLessThanOrEqual(diagnostic.windows[1].readyElapsedMs ?? -1);
    expect(diagnostic.preparationCompletedElapsedMs)
      .toBeGreaterThanOrEqual(diagnostic.windows[1].readyElapsedMs ?? 0);
    expect(diagnostic.queueMaxDepth).toBeLessThanOrEqual(NATIVE_FILENAME_BATCH_SIZE);
    expect(diagnostic.filenameResolvedAppleFiles).toBe(0);
    expect(diagnostic.filenameFallbackFiles).toBe(251);
  });

  it('honors prepare-first for a large native selection before starting upload workers', async () => {
    const assets = Array.from({ length: 251 }, (_, index) => ({
      id: `native-large-${index}`,
      uri: `ph://native-large-${index}`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `native-large-${index}.heic`,
    }));
    let releaseSecondWindow!: () => void;
    const secondWindowBlocked = new Promise<void>(resolve => {
      releaseSecondWindow = resolve;
    });
    let nativeWindowCalls = 0;
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow = jest.fn(
      async (_sessionRef: string, requests: { fileRef: number; assetId: string }[]) => {
        nativeWindowCalls += 1;
        if (nativeWindowCalls === 2) await secondWindowBlocked;
        return requests.map(request => ({
          assetId: request.assetId,
          fileRef: request.fileRef,
          variantId: `variant-${request.fileRef}`,
          mediaRole: 'original-photo',
          originalFilename: `${request.assetId}.heic`,
          status: 'ready',
          localUri: `file:///prepared/${request.fileRef}.heic`,
          sizeBytes: 1,
          transferFilename: `${request.assetId}.heic`,
          temporary: true,
        }));
      },
    );
    (api.preflightCheck as jest.Mock).mockImplementation(async (files) => ({
      files: files.map((file: { id: string }) => ({ id: file.id, action: 'upload' })),
    }));
    (nativeCapabilities.uploadFile as jest.Mock).mockResolvedValue({
      status: 'success',
      bytesSent: 1,
      skipped: false,
      chunkCount: 1,
      chunkSizeBytes: 1,
      fileReadDurationMs: 0,
      httpRequestDurationMs: 0,
      interChunkGapDurationMs: 0,
      retryCount: 0,
      peakResidentMemoryBytes: 1,
      serverWriteDurationMs: 0,
      serverFinalizeDurationMs: 0,
    });
    const onProgress = jest.fn();
    const transfer = manager.uploadFilesConcurrent(assets, {
      onProgress,
      onComplete: jest.fn(),
      onError: jest.fn(),
    });

    for (let attempt = 0; attempt < 40 && nativeWindowCalls < 2; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(nativeCapabilities.prepareAssetWindow).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ assetId: 'native-large-0' })]),
      { includeAdditionalMediaComponents: false },
      expect.any(Function),
    );
    expect((nativeCapabilities.prepareAssetWindow as jest.Mock).mock.calls[0][1]).toHaveLength(250);
    expect(nativeCapabilities.uploadFile).not.toHaveBeenCalled();

    releaseSecondWindow();
    await transfer;
    expect(nativeCapabilities.uploadFile).toHaveBeenCalledTimes(251);
    const diagnostic = latestPersistedDiagnostic() as PersistedDiagnostic & {
      requestedPreparationMode: string;
      preparationMode: string;
      automaticPreparationReason?: string;
    };
    expect(diagnostic).toEqual(expect.objectContaining({
      requestedPreparationMode: 'prepare-first',
      preparationMode: 'prepare-first',
    }));
    expect(diagnostic.automaticPreparationReason).toBeUndefined();
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      preparationMode: 'prepare-first',
      totalBatches: 2,
    }));
  });

  it('uses full upfront preparation by default before starting either upload worker', async () => {
    const assets = Array.from({ length: 251 }, (_, index) => ({
      id: `prepare-first-${index}`,
      uri: `file://prepare-first-${index}.jpg`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `prepare-first-${index}.jpg`,
    }));
    let releaseLastAsset!: () => void;
    const lastAssetBlocked = new Promise<void>(resolve => {
      releaseLastAsset = resolve;
    });
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockImplementation(
      async (assetId: string) => {
        if (assetId === 'prepare-first-250') await lastAssetBlocked;
        return null;
      },
    );
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1,
      isDirectory: false,
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [] });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue('{}');

    const transfer = manager.uploadFilesConcurrent(assets, {
      onProgress: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(harness.uploadEncodedChunk).not.toHaveBeenCalled();

    releaseLastAsset();
    await transfer;
    expect(harness.uploadEncodedChunk).toHaveBeenCalledTimes(251);
    const diagnostic = latestPersistedDiagnostic() as PersistedDiagnostic & {
      firstUploadStartedElapsedMs: number;
      preparationCompletedElapsedMs: number;
    };
    expect(diagnostic.firstUploadStartedElapsedMs)
      .toBeGreaterThanOrEqual(diagnostic.preparationCompletedElapsedMs);
  });

  it('never reports a decreasing prepared count across 250-item boundaries', async () => {
    const assets = Array.from({ length: 570 }, (_, index) => ({
      id: `monotonic-${index}`,
      uri: `file://monotonic-${index}.jpg`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `monotonic-${index}.jpg`,
    }));
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1,
      isDirectory: false,
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [] });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue('{}');
    const preparedCounts: number[] = [];

    await manager.uploadFilesConcurrent(assets, {
      onProgress: progress => {
        if (typeof progress.preparedFiles === 'number') {
          preparedCounts.push(progress.preparedFiles);
        }
      },
      onComplete: jest.fn(),
      onError: jest.fn(),
    });

    expect(preparedCounts.at(-1)).toBe(570);
    expect(preparedCounts.every(
      (value, index) => index === 0 || value >= preparedCounts[index - 1],
    )).toBe(true);
  });

  it('records the observed upload-worker concurrency and first acknowledgement', async () => {
    const assets = Array.from({ length: 2 }, (_, index) => ({
      id: `worker-${index}`,
      uri: `file://worker-${index}.jpg`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `worker-${index}.jpg`,
    }));
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1_000_000,
      isDirectory: false,
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: assets.map(asset => ({ id: asset.id, action: 'upload' })),
    });
    let releaseUploads!: () => void;
    const uploadsBlocked = new Promise<void>(resolve => {
      releaseUploads = resolve;
    });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn(async () => {
      await uploadsBlocked;
      return '{}';
    });

    const transfer = manager.uploadFilesConcurrent(assets, {
      onProgress: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    });
    for (
      let attempt = 0;
      attempt < 20 && harness.uploadEncodedChunk.mock.calls.length < 2;
      attempt += 1
    ) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(harness.uploadEncodedChunk).toHaveBeenCalledTimes(2);
    releaseUploads();
    await transfer;

    const diagnostic = latestPersistedDiagnostic();
    expect(diagnostic.maxActiveUploadWorkers).toBe(2);
    expect(diagnostic.firstUploadStartedElapsedMs).toEqual(expect.any(Number));
    expect(diagnostic.firstAcknowledgementElapsedMs).toEqual(expect.any(Number));
    expect(diagnostic.averageMediaMBps).toBeGreaterThan(0);
    expect(diagnostic.peakMediaMBps).toBeGreaterThan(0);
  });

  it('reads the next chunk while the current chunk is uploading', async () => {
    const assets = [{
      id: 'pipeline-1', uri: 'file://pipeline.mov', type: 'video' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'pipeline.mov',
    }];
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 9 * 1024 * 1024, isDirectory: false });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [{ id: 'pipeline-1', action: 'upload' }] });
    let releaseFirstUpload!: () => void;
    const firstUploadBlocked = new Promise<void>(resolve => { releaseFirstUpload = resolve; });
    let uploads = 0;
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockImplementation(async () => {
      uploads++;
      if (uploads === 1) await firstUploadBlocked;
      return '{}';
    });

    const transfer = manager.uploadFilesConcurrent(assets, {
      onProgress: jest.fn(), onComplete: jest.fn(), onError: jest.fn(),
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledTimes(2);
    releaseFirstUpload();
    await transfer;
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledTimes(3);
  });

  it('hashes a native candidate and skips it before upload', async () => {
    const asset = {
      id: 'duplicate-1', uri: 'file://duplicate.jpg', type: 'photo' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'duplicate.jpg',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow = jest.fn().mockResolvedValue([{
      assetId: asset.id,
      fileRef: 17,
      variantId: 'native-candidate',
      mediaRole: 'original-photo',
      originalFilename: asset.filename,
      status: 'ready',
      localUri: 'file:///prepared/duplicate.jpg',
      sizeBytes: 1024,
      transferFilename: asset.filename,
      temporary: true,
    }]);
    nativeCapabilities.hashPreparedFiles = jest.fn().mockResolvedValue([{
      variantId: 'native-candidate',
      status: 'success',
      sha256: 'a'.repeat(64),
    }]);
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: 'native-candidate', action: 'hash_required' }],
    });
    (api.preflightVerify as jest.Mock).mockResolvedValue({
      files: [{ id: 'native-candidate', action: 'skip', filename: 'already-here.jpg' }],
    });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue(JSON.stringify({ skipped: true, filename: asset.filename }));
    const onStatus = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(), onComplete: jest.fn(), onError: jest.fn(), onFileStatusChange: onStatus,
    });

    expect(nativeCapabilities.hashPreparedFiles).toHaveBeenCalledWith(
      expect.any(String),
      [expect.objectContaining({ variantId: 'native-candidate', expectedSizeBytes: 1024 })],
    );
    expect(api.preflightVerify).toHaveBeenCalledWith([expect.objectContaining({
      id: 'native-candidate',
      sha256: 'a'.repeat(64),
    })]);
    expect(harness.uploadEncodedChunk).not.toHaveBeenCalled();
    expect(nativeCapabilities.uploadFile).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      savedFilename: 'already-here.jpg',
      message: 'duplicate.jpg was not transferred because identical content already exists as already-here.jpg.',
    }));
  });

  it('sends an explicit keep-duplicates policy when duplicate skipping is off', async () => {
    const asset = {
      id: 'keep-duplicate',
      uri: 'file://keep-duplicate.jpg',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'keep-duplicate.jpg',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1024,
      isDirectory: false,
    });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue(JSON.stringify({
      skipped: false,
      filename: 'keep-duplicate (2).jpg',
    }));
    const onStatus = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
      onFileStatusChange: onStatus,
    }, {
      preparationMode: 'prepare-first',
      thermalPolicy: 'monitor-only',
      skipExactDuplicates: false,
    });

    expect(api.preflightCheck).not.toHaveBeenCalled();
    expect(harness.uploadEncodedChunk.mock.calls[0][1]).toEqual(expect.objectContaining({
      'X-Skip-Duplicates': 'false',
    }));
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      savedFilename: 'keep-duplicate (2).jpg',
    }));
  });

  it('uses the Apple resource filename for preflight, native upload, and saved-name status', async () => {
    const asset = {
      id: 'photos-id-3231', uri: 'ph://photos-id-3231', type: 'photo' as const,
      modificationTime: 0, width: 4032, height: 3024, filename: 'IMG_6475.HEIC',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        fileRef: 1,
        status: 'ready',
        localUri: 'file:///prepared/current.heic',
        sizeBytes: 2_400_000,
        transferFilename: 'IMG_3231.HEIC',
        contentType: 'public.heic',
        temporary: true,
      }]);
    (nativeCapabilities.uploadFile as jest.Mock).mockResolvedValue({
      status: 'success',
      bytesSent: 2_400_000,
      skipped: false,
      chunkCount: 1,
      chunkSizeBytes: 8 * 1024 * 1024,
      fileReadDurationMs: 1,
      httpRequestDurationMs: 2,
      interChunkGapDurationMs: 0,
      retryCount: 0,
      peakResidentMemoryBytes: 1,
      serverWriteDurationMs: 1,
      serverFinalizeDurationMs: 1,
      transferFilename: 'IMG_3231.HEIC',
      savedFilename: 'IMG_3231 (2).HEIC',
    });
    (api.preflightCheck as jest.Mock).mockImplementation(async (files) => ({
      files: files.map((file: { id: string }) => ({ id: file.id, action: 'upload' })),
    }));
    const onStatus = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
      onFileStatusChange: onStatus,
    });

    expect(api.preflightCheck).toHaveBeenCalledWith([expect.objectContaining({
      id: expect.any(String),
      name: 'IMG_3231.HEIC',
    })]);
    expect(nativeCapabilities.uploadFile).toHaveBeenCalledWith(expect.objectContaining({
      transferFilename: 'IMG_3231.HEIC',
      skipDuplicates: true,
    }));
    const transferStartedLog = (api.logClientEvent as jest.Mock).mock.calls.find(
      call => call[1] === 'transfer_started',
    );
    const uploadFileId = (nativeCapabilities.uploadFile as jest.Mock).mock.calls[0][0]
      .fileId as string;
    expect(uploadFileId).toBe(`${transferStartedLog?.[3].sessionId}-1`);
    expect(uploadFileId).toMatch(/^ios-[0-9]{10,20}-1$/);
    expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalledWith(
      'file:///prepared/current.heic',
    );
    expect(nativeCapabilities.resolveAssetFilenames).not.toHaveBeenCalled();
    const nativeUploadOptions = (nativeCapabilities.uploadFile as jest.Mock).mock.calls[0][0];
    expect(nativeUploadOptions).not.toHaveProperty('assetId');
    expect(nativeUploadOptions).not.toHaveProperty('filename');
    expect(api.logClientEvent).toHaveBeenCalledWith(
      'INFO',
      'transfer_prepared',
      'iPhone transfer preparation completed',
      expect.objectContaining({
        filenameResolutionBatchCount: 1,
        filenameResolutionAppleCount: 1,
        filenameResolutionFallbackCount: 0,
        filenameResolutionMaxBatchSize: 1,
        filenameResolutionDurationMs: expect.any(Number),
      }),
    );
    const nativeMetricsCall = (api.logClientEvent as jest.Mock).mock.calls.find(
      call => call[1] === 'native_upload_metrics',
    );
    expect(nativeMetricsCall).toBeUndefined();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      assetId: asset.id,
      fileRef: 1,
      status: 'success',
      transferFilename: 'IMG_3231.HEIC',
      savedFilename: 'IMG_3231 (2).HEIC',
      message: 'Saved as IMG_3231 (2).HEIC',
    }));
    const diagnostic = latestPersistedDiagnostic();
    expect(diagnostic.filenameResolvedAppleFiles).toBe(1);
    expect(diagnostic.filenameFallbackFiles).toBe(0);
    expect(diagnostic.maxActiveUploadWorkers).toBe(1);
    expect(diagnostic.peakNativeResidentMemoryBytes).toBe(1);
    expect(diagnostic.uploadTiming).toEqual({
      measuredFiles: 1,
      fileReadDurationMs: 1,
      httpRequestDurationMs: 2,
      interChunkGapDurationMs: 0,
      serverWriteDurationMs: 1,
      serverFinalizeDurationMs: 1,
      maxServerFinalizeDurationMs: 1,
    });
    const sessionRef = (nativeCapabilities.beginTransfer as jest.Mock).mock.calls[0][0];
    expect(nativeCapabilities.releasePreparedFile).toHaveBeenCalledWith(
      sessionRef,
      'file:///prepared/current.heic',
    );
    expect(nativeCapabilities.endTransfer).toHaveBeenCalledWith(sessionRef);
  });

  it('reconciles coalesced native progress with the final uploaded byte count', async () => {
    const size = 5_000_000;
    const progressBytes = 3_750_000;
    const asset = {
      id: 'native-final-bytes',
      uri: 'ph://native-final-bytes',
      type: 'video' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'IMG_9000.MOV',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        fileRef: 1,
        status: 'ready',
        localUri: 'file:///prepared/current.mov',
        sizeBytes: size,
        transferFilename: asset.filename,
        contentType: 'com.apple.quicktime-movie',
        temporary: true,
      }]);
    let progressListener: ((event: {
      fileId: string;
      bytesSent: number;
      totalBytes: number;
    }) => void) | undefined;
    (nativeCapabilities.addProgressListener as jest.Mock).mockImplementation(listener => {
      progressListener = listener;
      return { remove: jest.fn() };
    });
    (nativeCapabilities.uploadFile as jest.Mock).mockImplementation(async () => {
      progressListener?.({
        fileId: asset.id,
        bytesSent: progressBytes,
        totalBytes: size,
      });
      return {
        status: 'success',
        bytesSent: size,
        skipped: false,
        chunkCount: 1,
        chunkSizeBytes: 8 * 1024 * 1024,
        fileReadDurationMs: 1,
        httpRequestDurationMs: 2,
        interChunkGapDurationMs: 0,
        retryCount: 0,
        peakResidentMemoryBytes: 1,
        serverWriteDurationMs: 1,
        serverFinalizeDurationMs: 1,
        transferFilename: asset.filename,
        savedFilename: asset.filename,
      };
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: asset.id, action: 'upload' }],
    });
    const onProgress = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress,
      onComplete: jest.fn(),
      onError: jest.fn(),
    });

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      acknowledgedMediaBytes: size,
      plannedUploadMediaBytes: size,
      status: 'uploading',
    }));
    expect(latestPersistedDiagnostic()).toEqual(expect.objectContaining({
      plannedUploadBytes: size,
      acknowledgedBytes: size,
    }));
  });

  it('treats a native authentication rejection as a fatal session failure', async () => {
    const asset = {
      id: 'native-auth-loss',
      uri: 'ph://native-auth-loss',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'camera-file.heic',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        fileRef: 1,
        status: 'ready',
        localUri: 'file:///photos/camera-file.heic',
        sizeBytes: 100,
        transferFilename: asset.filename,
        temporary: false,
      }]);
    (nativeCapabilities.uploadFile as jest.Mock).mockResolvedValue({
      status: 'failed',
      errorCode: 'unauthorized',
      httpStatus: 401,
      bytesSent: 0,
      transferFilename: asset.filename,
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: asset.id, action: 'upload' }],
    });
    const onComplete = jest.fn();
    const onError = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete,
      onError,
    });

    expect(api.notifyUnauthorized).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'unauthorized', fatal: true }),
      expect.objectContaining({ completionStatus: 'fatal' }),
    );
    const sessionRef = (nativeCapabilities.beginTransfer as jest.Mock).mock.calls[0][0];
    expect(nativeCapabilities.cancel).toHaveBeenCalledWith(sessionRef);
  });

  it('releases a temporary native rendition after a non-fatal upload failure', async () => {
    const asset = {
      id: 'temporary-native-failure',
      uri: 'ph://temporary-native-failure',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'edited-image.jpg',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        fileRef: 1,
        status: 'ready',
        localUri: 'file:///prepared/failing-current.jpg',
        sizeBytes: 1000,
        transferFilename: 'edited-image.jpg',
        contentType: 'public.jpeg',
        temporary: true,
      }]);
    (nativeCapabilities.uploadFile as jest.Mock).mockRejectedValue(
      new Error('native upload failed'),
    );
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: asset.id, action: 'upload' }],
    });
    const onComplete = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete,
      onError: jest.fn(),
    });

    const sessionRef = (nativeCapabilities.beginTransfer as jest.Mock).mock.calls[0][0];
    expect(nativeCapabilities.releasePreparedFile).toHaveBeenCalledWith(
      sessionRef,
      'file:///prepared/failing-current.jpg',
    );
    expect(nativeCapabilities.endTransfer).toHaveBeenCalledWith(sessionRef);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      completionStatus: 'mixed',
      failedFiles: 1,
    }));
  });

  it('reports a numbered saved filename from the Expo Go compatibility uploader', async () => {
    const asset = {
      id: 'expo-3845', uri: 'file://IMG_3845.HEIC', type: 'photo' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'IMG_3845.HEIC',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true, size: 1024, isDirectory: false,
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: asset.id, action: 'upload' }],
    });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue(JSON.stringify({
      skipped: false,
      filename: 'IMG_3845 (2).HEIC',
    }));
    const onStatus = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(), onComplete: jest.fn(), onError: jest.fn(), onFileStatusChange: onStatus,
    });

    expect(nativeCapabilities.resolveAssetFilenames).not.toHaveBeenCalled();
    expect(api.logClientEvent).toHaveBeenCalledWith(
      'INFO',
      'transfer_prepared',
      'iPhone transfer preparation completed',
      expect.objectContaining({
        filenameResolutionBatchCount: 0,
        filenameResolutionAppleCount: 0,
        filenameResolutionFallbackCount: 1,
        filenameResolutionMaxBatchSize: 0,
      }),
    );
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      assetId: asset.id,
      fileRef: 1,
      status: 'success',
      transferFilename: 'IMG_3845.HEIC',
      savedFilename: 'IMG_3845 (2).HEIC',
      message: 'Saved as IMG_3845 (2).HEIC',
    }));
  });

  it('fails the current file cleanly when a fallback chunk read fails', async () => {
    const asset = {
      id: 'broken-read', uri: 'file://broken.mov', type: 'video' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'broken.mov',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1024, isDirectory: false });
    (FileSystem.readAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('read failed'));
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [{ id: asset.id, action: 'upload' }] });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue('{}');
    const onStatus = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();
    const onProgress = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress, onComplete, onError, onFileStatusChange: onStatus,
    });

    expect(harness.uploadEncodedChunk).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      assetId: asset.id,
      status: 'error',
      transferFilename: asset.filename,
      message: 'The selected item could not be read.',
    }));
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      failedFiles: 1,
      completionStatus: 'mixed',
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      acknowledgedMediaBytes: 0,
      plannedUploadMediaBytes: 0,
    }));
  });

  it('removes only the unacknowledged remainder after a partial upload failure', async () => {
    const size = 5 * 1024 * 1024;
    const firstChunk = 4 * 1024 * 1024;
    const asset = {
      id: 'partial-failure', uri: 'file://partial.mov', type: 'video' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'partial.mov',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size, isDirectory: false });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: [{ id: asset.id, action: 'upload' }] });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn()
      .mockResolvedValueOnce('{}')
      .mockRejectedValueOnce(new Error('connection lost'));
    const onProgress = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress, onComplete: jest.fn(), onError: jest.fn(),
    });

    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'failed',
      acknowledgedMediaBytes: firstChunk,
      plannedUploadMediaBytes: firstChunk,
    }));
    expect(latestPersistedDiagnostic()).toEqual(expect.objectContaining({
      plannedUploadBytes: size,
      acknowledgedBytes: firstChunk,
    }));
  });

  it('excludes definite preflight skips from planned network bytes', async () => {
    const assets = [
      { id: 'known-skip', uri: 'file://skip.jpg', type: 'photo' as const, modificationTime: 0, width: 1, height: 1, filename: 'skip.jpg' },
      { id: 'upload', uri: 'file://upload.jpg', type: 'photo' as const, modificationTime: 0, width: 1, height: 1, filename: 'upload.jpg' },
    ];
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1_000_000, isDirectory: false });
    (api.preflightCheck as jest.Mock).mockImplementation(async (files) => ({
      files: files.map((file: { id: string; name: string }) => ({
        id: file.id,
        action: file.name === 'skip.jpg' ? 'skip' : 'upload',
        ...(file.name === 'skip.jpg' ? { filename: 'existing-skip.jpg' } : {}),
      })),
    }));
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue(JSON.stringify({ skipped: false }));
    const onProgress = jest.fn();
    const onComplete = jest.fn();

    await manager.uploadFilesConcurrent(assets, {
      onProgress, onComplete, onError: jest.fn(),
    });

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      acknowledgedMediaBytes: 0,
      plannedUploadMediaBytes: 1_000_000,
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      status: 'uploading',
      acknowledgedMediaBytes: 1_000_000,
      plannedUploadMediaBytes: 1_000_000,
    }));
    expect(latestPersistedDiagnostic()).toEqual(expect.objectContaining({
      plannedUploadBytes: 1_000_000,
      acknowledgedBytes: 1_000_000,
      skippedBytes: 1_000_000,
      preflightSkippedFiles: 1,
      preflightSkippedBytes: 1_000_000,
      serverSkippedFiles: 0,
      serverSkippedBytes: 0,
      preflight: expect.objectContaining({
        componentsConsidered: 2,
        metadataUploadFiles: 1,
        receiverSkippedFiles: 1,
        receiverSkippedBytes: 1_000_000,
        metadataRequestCount: 1,
        hashedFiles: 0,
      }),
    }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      skippedBytes: 1_000_000,
      avoidedBytes: 1_000_000,
      finalizationDuplicateBytes: 0,
    }));
    expect(api.transferHistory).toHaveBeenCalledWith(expect.objectContaining({
      avoidedBytes: 1_000_000,
      finalizationDuplicateBytes: 0,
    }));
  });

  it('releases a native temporary file immediately after a preflight skip', async () => {
    const asset = {
      id: 'native-preflight-skip',
      uri: 'ph://native-preflight-skip',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'incoming.heic',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        assetId: asset.id,
        fileRef: 1,
        variantId: 'native-skip-variant',
        mediaRole: 'original-photo',
        originalFilename: 'incoming.heic',
        status: 'ready',
        localUri: 'file:///prepared/native-skip.heic',
        sizeBytes: 10,
        transferFilename: 'incoming.heic',
        temporary: true,
      }]);
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{
        id: 'native-skip-variant',
        action: 'skip',
        filename: 'existing.heic',
      }],
    });

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    });

    expect(nativeCapabilities.releasePreparedFile).toHaveBeenCalledWith(
      expect.any(String),
      'file:///prepared/native-skip.heic',
    );
    expect(nativeCapabilities.uploadFile).not.toHaveBeenCalled();
  });

  it('keeps a successful primary component distinct from an optional component failure', async () => {
    const asset = {
      id: 'live-photo-optional-failure',
      uri: 'ph://live-photo-optional-failure',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'visible.heic',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([
        {
          assetId: asset.id,
          fileRef: 17,
          variantId: 'visible-primary',
          mediaRole: 'live-photo-still',
          componentSemantics: 'primary',
          originalFilename: 'visible.heic',
          status: 'ready',
          localUri: 'file:///prepared/visible.heic',
          sizeBytes: 10,
          transferFilename: 'visible.heic',
          temporary: true,
          materializationPath: 'photo-resource',
          materializationDurationMs: 4,
          temporaryBytesWritten: 10,
        },
        {
          assetId: asset.id,
          fileRef: 18,
          variantId: 'motion-optional',
          mediaRole: 'live-photo-motion',
          componentSemantics: 'optional',
          originalFilename: 'visible.mov',
          status: 'failed',
          stage: 'rendition',
          errorCode: 'icloud-resource-unavailable',
        },
      ]);
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: 'visible-primary', action: 'upload' }],
    });
    nativeCapabilities.uploadFile = jest.fn().mockResolvedValue({
      status: 'success',
      bytesSent: 10,
      skipped: false,
      chunkCount: 1,
      chunkSizeBytes: 10,
      fileReadDurationMs: 1,
      httpRequestDurationMs: 1,
      interChunkGapDurationMs: 0,
      retryCount: 0,
      peakResidentMemoryBytes: 0,
      serverWriteDurationMs: 1,
      serverFinalizeDurationMs: 1,
      transferFilename: 'visible.heic',
    });
    const onStatus = jest.fn();
    const onComplete = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete,
      onError: jest.fn(),
      onFileStatusChange: onStatus,
    }, {
      preparationMode: 'prepare-first',
      includeAdditionalMediaComponents: true,
    });

    expect((nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow)
      .toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        { includeAdditionalMediaComponents: true },
        expect.any(Function),
      );
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'visible-primary',
      componentSemantics: 'primary',
      status: 'success',
    }));
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'motion-optional',
      mediaRole: 'live-photo-motion',
      componentSemantics: 'optional',
      status: 'error',
      message: expect.stringContaining(
        'Optional live photo motion failed. The main media can still transfer.',
      ),
    }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      selectedAssets: 1,
      expandedFiles: 2,
      selectedBytes: 10,
      selectedMediaBytes: 10,
      additionalComponentsBytes: 0,
      selectedMediaFiles: 1,
      additionalComponentsFiles: 1,
      uploadedFiles: 1,
      failedFiles: 1,
      completionStatus: 'mixed',
    }));
    expect(api.transferHistory).toHaveBeenCalledWith(expect.objectContaining({
      selectedBytes: 10,
      selectedMediaBytes: 10,
      additionalComponentsBytes: 0,
      selectedMediaFiles: 1,
      additionalComponentsFiles: 1,
    }));
  });

  it('excludes server-verified duplicates from successful uploaded bytes', async () => {
    const assets = [
      { id: 'saved', uri: 'file://saved.jpg', type: 'photo' as const, modificationTime: 0, width: 1, height: 1, filename: 'saved.jpg' },
      { id: 'duplicate', uri: 'file://duplicate.jpg', type: 'photo' as const, modificationTime: 0, width: 1, height: 1, filename: 'duplicate.jpg' },
    ];
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1_000_000, isDirectory: false });
    (api.preflightCheck as jest.Mock).mockResolvedValue({ files: assets.map(asset => ({ id: asset.id, action: 'upload' })) });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn()
      .mockResolvedValueOnce(JSON.stringify({ skipped: false }))
      .mockResolvedValueOnce(JSON.stringify({ skipped: true }));
    const onComplete = jest.fn();
    const onProgress = jest.fn();

    await manager.uploadFilesConcurrent(assets, {
      onProgress, onComplete, onError: jest.fn(),
    });

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      selectedBytes: 2_000_000,
      uploadedBytes: 1_000_000,
      skippedBytes: 1_000_000,
      avoidedBytes: 0,
      finalizationDuplicateBytes: 1_000_000,
    }));
    expect(api.transferHistory).toHaveBeenCalledWith(expect.objectContaining({
      uploadedBytes: 1_000_000,
      skippedBytes: 1_000_000,
      avoidedBytes: 0,
      finalizationDuplicateBytes: 1_000_000,
    }));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      acknowledgedMediaBytes: 2_000_000,
      plannedUploadMediaBytes: 2_000_000,
    }));
    expect(latestPersistedDiagnostic()).toEqual(expect.objectContaining({
      plannedUploadBytes: 2_000_000,
      acknowledgedBytes: 2_000_000,
      skippedBytes: 1_000_000,
      preflightSkippedFiles: 0,
      preflightSkippedBytes: 0,
      serverSkippedFiles: 1,
      serverSkippedBytes: 1_000_000,
      preflight: expect.objectContaining({
        componentsConsidered: 2,
        metadataUploadFiles: 2,
        hashedFiles: 0,
        metadataRequestCount: 1,
      }),
    }));
  });

  it('requests authenticated server cleanup when a transfer is cancelled', async () => {
    const asset = {
      id: 'cancel-cleanup',
      uri: 'file://cancel-cleanup.jpg',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'cancel-cleanup.jpg',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1024,
      isDirectory: false,
    });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockImplementation(async () => {
      manager.cancel();
      throw new Error('cancelled');
    });

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    });

    expect(api.cancelUploadSession).toHaveBeenCalledWith(
      expect.stringMatching(/^ios-\d+$/),
    );
    const sessionRef = (nativeCapabilities.beginTransfer as jest.Mock).mock.calls[0][0];
    expect(nativeCapabilities.endTransfer).toHaveBeenCalledWith(sessionRef);
  });

  it('recovers its lifecycle when native teardown fails', async () => {
    const asset = {
      id: 'cleanup-recovery',
      uri: 'file://cleanup-recovery.jpg',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'cleanup-recovery.jpg',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1024,
      isDirectory: false,
    });
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: asset.id, action: 'upload' }],
    });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue('{}');
    (nativeCapabilities.endTransfer as jest.Mock)
      .mockRejectedValueOnce(new Error('native teardown failed'));

    const firstComplete = jest.fn();
    await expect(manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete: firstComplete,
      onError: jest.fn(),
    })).resolves.toBeUndefined();

    const secondComplete = jest.fn();
    await expect(manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete: secondComplete,
      onError: jest.fn(),
    })).resolves.toBeUndefined();

    expect(firstComplete).toHaveBeenCalledTimes(1);
    expect(secondComplete).toHaveBeenCalledTimes(1);
  });

  it('does not claim a diagnostic report exists when persistence fails', async () => {
    const asset = {
      id: 'diagnostic-write-failure',
      uri: 'file://diagnostic-write-failure.jpg',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'diagnostic-write-failure.jpg',
    };
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 1024,
      isDirectory: false,
    });
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValue(
      new Error('diagnostic storage unavailable'),
    );
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: [{ id: asset.id, action: 'upload' }],
    });
    const harness = manager as unknown as UploadManagerHarness;
    harness.uploadEncodedChunk = jest.fn().mockResolvedValue('{}');
    const onComplete = jest.fn();

    await manager.uploadFilesConcurrent([asset], {
      onProgress: jest.fn(),
      onComplete,
      onError: jest.fn(),
    });

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      completionStatus: 'completed',
      diagnosticReportAvailable: false,
    }));
  });
});

describe('prepareAssetsForUpload filename resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow = jest.fn(
      async (_sessionRef: string, requests: {
        fileRef: number;
        assetId: string;
      }[]) => requests.map(request => ({
        fileRef: request.fileRef,
        status: 'ready',
        localUri: `file:///photos/${request.assetId}.HEIC`,
        sizeBytes: 123,
        transferFilename: `${request.assetId}.HEIC`,
        temporary: false,
      })),
    );
  });

  it('replaces Expo filename metadata with Apple original filenames', async () => {
    const asset = {
      id: 'photos-id-3231', uri: 'ph://photos-id-3231', type: 'photo' as const,
      modificationTime: 0, width: 4032, height: 3024, filename: 'IMG_6475.HEIC',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        fileRef: 1,
        status: 'ready',
        localUri: 'file:///photos/IMG_3231.HEIC',
        sizeBytes: 123,
        transferFilename: 'IMG_3231.HEIC',
        temporary: false,
      }]);

    const prepared = await prepareAssetsForUpload({
      assets: [asset],
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(prepared?.fileInfos[0]).toEqual(expect.objectContaining({
      transferFilename: 'IMG_3231.HEIC',
      filenameSource: 'apple-resource',
    }));
    expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
    expect(nativeCapabilities.resolveAssetFilenames).not.toHaveBeenCalled();
  });

  it('keeps consecutive Apple camera names paired with their asset IDs', async () => {
    const expectedNames = ['IMG_3845.HEIC', 'IMG_3846.HEIC', 'IMG_3847.HEIC'];
    const assets = expectedNames.map((_, index) => ({
      id: `photos-id-${index}`,
      uri: `ph://photos-id-${index}`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `IMG_${5035 + index}.HEIC`,
    }));
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue(
        assets.map((_, index) => ({
          fileRef: index + 1,
          status: 'ready',
          localUri: `file:///photos/${expectedNames[index]}`,
          sizeBytes: 123,
          transferFilename: expectedNames[index],
          temporary: false,
        })),
      );

    const prepared = await prepareAssetsForUpload({
      assets,
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(prepared?.fileInfos.map(file => [file.asset.id, file.transferFilename])).toEqual([
      ['photos-id-0', 'IMG_3845.HEIC'],
      ['photos-id-1', 'IMG_3846.HEIC'],
      ['photos-id-2', 'IMG_3847.HEIC'],
    ]);
  });

  it('associates multiple expanded variants without rescanning every native result', async () => {
    const assets = [{
      id: 'live-photo',
      uri: 'ph://live-photo',
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'IMG_1000.HEIC',
    }];
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([
        {
          assetId: 'live-photo', fileRef: 1, variantId: 'still',
          mediaRole: 'live-photo-still', originalFilename: 'IMG_1000.HEIC',
          status: 'ready', localUri: 'file:///prepared/IMG_1000.HEIC',
          sizeBytes: 10, transferFilename: 'IMG_1000.HEIC', temporary: true,
        },
        {
          assetId: 'live-photo', fileRef: 1, variantId: 'motion',
          mediaRole: 'live-photo-motion', originalFilename: 'IMG_1000.MOV',
          status: 'ready', localUri: 'file:///prepared/IMG_1000.MOV',
          sizeBytes: 20, transferFilename: 'IMG_1000.MOV', temporary: true,
        },
      ]);

    const prepared = await prepareAssetsForUpload({
      assets,
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(prepared?.fileInfos.map(file => [file.variantId, file.asset.id])).toEqual([
      ['still', 'live-photo'],
      ['motion', 'live-photo'],
    ]);
    expect(prepared?.totalBytesToUpload).toBe(30);
  });

  it('resolves 15,000 assets in 60 sequential batches no larger than 250', async () => {
    const assetCount = 15_000;
    const assets = Array.from({ length: assetCount }, (_, index) => ({
      id: `asset-${index}`,
      uri: `ph://asset-${index}`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `IMG_${index}.HEIC`,
    }));
    let activeBatches = 0;
    let peakBatches = 0;
    const nativePrepare = jest.fn(async (
      _sessionRef: string,
      requests: { fileRef: number; assetId: string }[],
    ) => {
      activeBatches++;
      peakBatches = Math.max(peakBatches, activeBatches);
      await Promise.resolve();
      activeBatches--;
      return requests.map((request: { fileRef: number; assetId: string }) => ({
        fileRef: request.fileRef,
        status: 'ready',
        localUri: `file:///photos/${request.assetId}.HEIC`,
        sizeBytes: 123,
        transferFilename: `IMG_${request.fileRef - 1}.HEIC`,
        temporary: false,
      }));
    });
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow = nativePrepare;

    const prepared = await prepareAssetsForUpload({
      assets,
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(prepared?.fileInfos).toHaveLength(assetCount);
    expect(nativePrepare).toHaveBeenCalledTimes(60);
    expect(nativePrepare.mock.calls.map(call => call[1].length))
      .toEqual(Array.from({ length: 60 }, () => NATIVE_FILENAME_BATCH_SIZE));
    expect(peakBatches).toBe(1);
    expect(prepared).toEqual(expect.objectContaining({
      filenameResolutionBatchCount: 60,
      filenameResolutionAppleCount: assetCount,
      filenameResolutionFallbackCount: 0,
      filenameResolutionMaxBatchSize: NATIVE_FILENAME_BATCH_SIZE,
      filenameResolutionDurationMs: expect.any(Number),
    }));
  });

  it('uses one native operation for current rendition metadata and authoritative naming', async () => {
    const asset = {
      id: 'photos-id-3231',
      uri: 'ph://photos-id-3231',
      type: 'photo' as const,
      modificationTime: 0,
      width: 4032,
      height: 3024,
      filename: 'IMG_6475.HEIC',
    };
    const nativePrepare = jest.fn().mockResolvedValue([{
      fileRef: 1,
      status: 'ready',
      localUri: 'file:///tmp/current/edited.jpg',
      sizeBytes: 456,
      transferFilename: 'IMG_3231.JPG',
      contentType: 'public.jpeg',
      temporary: true,
    }]);
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow = nativePrepare;

    const prepared = await prepareAssetsForUpload({
      assets: [asset],
      sessionRef: 'native-preparation-test',
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(nativePrepare).toHaveBeenCalledWith('native-preparation-test', [{
      fileRef: 1,
      assetId: 'photos-id-3231',
    }], { includeAdditionalMediaComponents: false }, expect.any(Function));
    expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
    expect(nativeCapabilities.resolveAssetFilenames).not.toHaveBeenCalled();
    expect(prepared?.fileInfos[0]).toEqual(expect.objectContaining({
      nativeUri: 'file:///tmp/current/edited.jpg',
      size: 456,
      transferFilename: 'IMG_3231.JPG',
      filenameSource: 'apple-resource',
      temporary: true,
    }));
  });

  it('splits a 251-item selection into deterministic 250-and-1 batches', async () => {
    const assets = Array.from({ length: 251 }, (_, index) => ({
      id: `boundary-${index}`,
      uri: `ph://boundary-${index}`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `IMG_${index}.HEIC`,
    }));
    const activeCounts: number[] = [];
    let active = 0;
    const nativePrepare = jest.fn(async (
      _sessionRef: string,
      requests: { fileRef: number; assetId: string }[],
    ) => {
      active++;
      activeCounts.push(active);
      await Promise.resolve();
      active--;
      return requests.map((request: { fileRef: number; assetId: string }) => ({
        fileRef: request.fileRef,
        status: 'ready',
        localUri: `file:///photos/${request.assetId}.HEIC`,
        sizeBytes: 123,
        transferFilename: `${request.assetId}.HEIC`,
        temporary: false,
      }));
    });
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow = nativePrepare;

    const prepared = await prepareAssetsForUpload({
      assets,
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(nativePrepare.mock.calls.map(call => call[1].length))
      .toEqual([NATIVE_FILENAME_BATCH_SIZE, 1]);
    expect(activeCounts).toEqual([1, 1]);
    expect(prepared?.fileInfos.map(file => file.asset.id)).toEqual(assets.map(asset => asset.id));
    expect(prepared).toEqual(expect.objectContaining({
      filenameResolutionBatchCount: 2,
      filenameResolutionMaxBatchSize: NATIVE_FILENAME_BATCH_SIZE,
    }));
  });

  it('fails closed when installed PhotoKit metadata cannot be resolved', async () => {
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        fileRef: 1,
        status: 'failed',
        stage: 'filename',
        errorCode: 'resource-not-found',
      }]);
    const asset = {
      id: 'missing-resource', uri: 'ph://missing-resource', type: 'photo' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'IMG_6475.HEIC',
    };

    const prepared = await prepareAssetsForUpload({
      assets: [asset],
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(prepared?.fileInfos).toEqual([]);
    expect(prepared).toEqual(expect.objectContaining({
      filenameResolutionAppleCount: 0,
      filenameResolutionFallbackCount: 0,
    }));
  });

  it('treats an unexpected native window rejection as a preparation failure', async () => {
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockRejectedValue(
      new Error('PhotoKit lookup failed'),
    );
    const asset = {
      id: 'failed-resource', uri: 'ph://failed-resource', type: 'photo' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'IMG_6475.HEIC',
    };

    await expect(prepareAssetsForUpload({
      assets: [asset],
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    })).rejects.toThrow('PhotoKit lookup failed');
    expect(nativeCapabilities.resolveAssetFilenames).not.toHaveBeenCalled();
  });

  it('keeps the Apple stem with the current rendition extension returned by Swift', async () => {
    const asset = {
      id: 'edited-photo', uri: 'ph://edited-photo', type: 'photo' as const,
      modificationTime: 0, width: 1, height: 1, filename: 'IMG_6475.HEIC',
    };
    (nativeCapabilities as NativeCapabilitiesHarness).prepareAssetWindow =
      jest.fn().mockResolvedValue([{
        fileRef: 1,
        status: 'ready',
        localUri: 'file:///tmp/current/edited.jpg',
        sizeBytes: 123,
        transferFilename: 'IMG_3231.JPG',
        contentType: 'public.jpeg',
        temporary: true,
      }]);

    const prepared = await prepareAssetsForUpload({
      assets: [asset],
      isCancelled: () => false,
      onGlobalProgress: jest.fn(),
    });

    expect(prepared?.fileInfos[0]).toEqual(expect.objectContaining({
      transferFilename: 'IMG_3231.JPG',
      filenameSource: 'apple-resource',
    }));
  });
});

describe('runDuplicatePreflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makePreparedFile = (index: number) => ({
    asset: {
      id: `asset-${index}`,
      uri: `file://asset-${index}.jpg`,
      type: 'photo' as const,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `asset-${index}.jpg`,
    },
    fileRef: index + 1,
    variantId: `asset-${index}`,
    mediaRole: 'expo-fallback' as const,
    componentSemantics: 'primary' as const,
    originalFilename: `asset-${index}.jpg`,
    windowIndex: 0,
    nativeUri: `file://asset-${index}.jpg`,
    size: 123,
    computedHash: '',
    transferFilename: `asset-${index}.jpg`,
    filenameSource: 'expo-fallback' as const,
  });

  it('continues later batches and uploads the failed batch by default', async () => {
    const fileInfos = Array.from({ length: 205 }, (_, index) => makePreparedFile(index));
    (api.preflightCheck as jest.Mock)
      .mockResolvedValueOnce({ files: [{ id: 'asset-0', action: 'skip' }] })
      .mockRejectedValueOnce(new Error('batch timeout'))
      .mockResolvedValueOnce({ files: [{ id: 'asset-200', action: 'skip' }] });

    const { preflightResults } = await runDuplicatePreflightWindow({
      fileInfos,
      shouldSkipDuplicates: true,
    });

    expect(api.preflightCheck).toHaveBeenCalledTimes(3);
    expect(preflightResults.get('asset-0')).toBe('skip');
    expect(preflightResults.get('asset-1')).toBe('upload');
    expect(preflightResults.get('asset-100')).toBe('upload');
    expect(preflightResults.get('asset-199')).toBe('upload');
    expect(preflightResults.get('asset-200')).toBe('skip');
    expect(preflightResults.get('asset-204')).toBe('upload');
  });

  it('bypasses duplicate preflight when the sender keeps exact duplicates', async () => {
    const fileInfos = [makePreparedFile(1)];

    const { preflightResults } = await runDuplicatePreflightWindow({
      fileInfos,
      shouldSkipDuplicates: false,
    });

    expect(api.preflightCheck).not.toHaveBeenCalled();
    expect(preflightResults.get('asset-1')).toBe('upload');
  });

  it('skips later outgoing files with identical hashes even when names differ', async () => {
    const fileInfos = [makePreparedFile(1), makePreparedFile(2)];
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: fileInfos.map(file => ({ id: file.variantId, action: 'upload' })),
    });
    nativeCapabilities.hashPreparedFiles = jest.fn().mockResolvedValue(
      fileInfos.map(file => ({
        variantId: file.variantId,
        status: 'success',
        sha256: 'a'.repeat(64),
        bytesRead: file.size,
        durationMs: 7,
        cacheHit: false,
      })),
    );

    const result = await runDuplicatePreflightWindow({
      sessionRef: 'selection-dedup-session',
      fileInfos,
      shouldSkipDuplicates: true,
    });

    expect(result.preflightResults.get('asset-1')).toBe('upload');
    expect(result.preflightResults.get('asset-2')).toBe('skip');
    expect(result.matchedFilenames.get('asset-2')).toBe('asset-1.jpg');
    expect(result.duplicateSources.get('asset-2')).toBe('outgoing-selection');
    expect(api.preflightVerify).not.toHaveBeenCalled();
    expect(result.metrics).toEqual(expect.objectContaining({
      componentsConsidered: 2,
      metadataUploadFiles: 2,
      receiverCandidateFiles: 0,
      localCandidateFiles: 2,
      hashCandidateFiles: 2,
      hashedFiles: 2,
      hashAttemptCount: 2,
      hashedBytes: 246,
      hashedThenUploadedFiles: 1,
      hashedThenUploadedBytes: 123,
      outgoingSkippedFiles: 1,
      outgoingSkippedBytes: 123,
      metadataRequestCount: 1,
      verificationRequestCount: 0,
      totalHashWorkerDurationMs: 14,
      longestHashDurationMs: 7,
      largestHashedFileBytes: 123,
    }));
  });

  it('does not silently downgrade an installed app when native hashing fails', async () => {
    const fileInfos = [makePreparedFile(1), makePreparedFile(2)];
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: fileInfos.map(file => ({ id: file.variantId, action: 'hash_required' })),
    });
    nativeCapabilities.hashPreparedFiles = jest.fn().mockRejectedValue(
      new Error('native contract unavailable'),
    );

    const result = await runDuplicatePreflightWindow({
      sessionRef: 'native-contract-session',
      fileInfos,
      shouldSkipDuplicates: true,
    });

    expect(result.hashFailureCodes.get('asset-1')).toBe('native-hashing-unavailable');
    expect(result.hashFailureCodes.get('asset-2')).toBe('native-hashing-unavailable');
    expect(api.preflightVerify).not.toHaveBeenCalled();
  });

  it('deduplicates identical files across bounded preparation windows', async () => {
    const outgoingHashes: OutgoingHashRegistry = new Map();
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (api.preflightCheck as jest.Mock).mockImplementation(async files => ({
      files: files.map((file: { id: string }) => ({ id: file.id, action: 'hash_required' })),
    }));
    (api.preflightVerify as jest.Mock).mockImplementation(async files => ({
      files: files.map((file: { id: string }) => ({ id: file.id, action: 'upload' })),
    }));
    nativeCapabilities.hashPreparedFiles = jest.fn().mockImplementation(
      async (_sessionRef, requests) => requests.map((request: { variantId: string }) => ({
        variantId: request.variantId,
        status: 'success',
        sha256: 'b'.repeat(64),
      })),
    );

    const first = [makePreparedFile(1)];
    await runDuplicatePreflightWindow({
      sessionRef: 'first-window',
      fileInfos: first,
      shouldSkipDuplicates: true,
      outgoingHashes,
    });
    const second = [makePreparedFile(2)];
    const result = await runDuplicatePreflightWindow({
      sessionRef: 'second-window',
      fileInfos: second,
      shouldSkipDuplicates: true,
      outgoingHashes,
    });

    expect(result.preflightResults.get('asset-2')).toBe('skip');
    expect(result.matchedFilenames.get('asset-2')).toBe('asset-1.jpg');
    expect(result.duplicateSources.get('asset-2')).toBe('outgoing-selection');
  });

  it('reports duplicate stages and does not complete Windows verification before its response', async () => {
    const fileInfos = [makePreparedFile(1), makePreparedFile(2)];
    const progress: { stage: string; completed: number; total: number }[] = [];
    let resolveVerification: ((value: { files: { id: string; action: 'upload' }[] }) => void) | undefined;
    (nativeCapabilities as NativeCapabilitiesHarness).available = true;
    (api.preflightCheck as jest.Mock).mockResolvedValue({
      files: fileInfos.map(file => ({ id: file.variantId, action: 'hash_required' })),
    });
    nativeCapabilities.hashPreparedFiles = jest.fn().mockResolvedValue(
      fileInfos.map(file => ({
        variantId: file.variantId,
        status: 'success',
        sha256: `${file.variantId.length}`.repeat(64).slice(0, 64),
      })),
    );
    (api.preflightVerify as jest.Mock).mockImplementation(() => new Promise(resolve => {
      resolveVerification = resolve;
    }));

    const pending = runDuplicatePreflightWindow({
      sessionRef: 'progress-session',
      fileInfos,
      shouldSkipDuplicates: true,
      onCheckingProgress: next => progress.push(next),
    });
    for (let index = 0; index < 10 && !resolveVerification; index += 1) {
      await Promise.resolve();
    }

    expect(progress).toContainEqual({ stage: 'finding-matches', completed: 0, total: 2 });
    expect(progress).toContainEqual({ stage: 'finding-matches', completed: 2, total: 2 });
    expect(progress).toContainEqual({ stage: 'checking-contents', completed: 2, total: 2 });
    expect(progress.at(-1)).toEqual({ stage: 'verifying-windows', completed: 0, total: 2 });

    resolveVerification?.({
      files: fileInfos.map(file => ({ id: file.variantId, action: 'upload' as const })),
    });
    await pending;
    expect(progress.at(-1)).toEqual({ stage: 'verifying-windows', completed: 2, total: 2 });
  });
});

describe('MediaScanner', () => {
  it('loads paged media without spreading page arrays into push arguments', async () => {
    const firstPage = Array.from({ length: 3 }, (_, index) => ({
      id: `asset-${index}`,
      uri: `file://asset-${index}.jpg`,
      mediaType: 'photo',
      duration: 0,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: `asset-${index}.jpg`,
    }));
    const secondPage = [{
      id: 'asset-3',
      uri: 'file://asset-3.jpg',
      mediaType: 'photo',
      duration: 0,
      modificationTime: 0,
      width: 1,
      height: 1,
      filename: 'asset-3.jpg',
    }];
    (MediaLibrary.getAssetsAsync as jest.Mock)
      .mockResolvedValueOnce({ assets: firstPage, hasNextPage: true, endCursor: 'cursor-1' })
      .mockResolvedValueOnce({ assets: secondPage, hasNextPage: false, endCursor: undefined });

    const scanner = new MediaScanner();
    const allMedia = await scanner.getAllMedia();

    expect(allMedia.map(asset => asset.id)).toEqual(['asset-0', 'asset-1', 'asset-2', 'asset-3']);
  });
});

describe('ThroughputTracker', () => {
  it('separates current media, average media, and encoded-body throughput', () => {
    const mb = 1_000_000;
    const tracker = new ThroughputTracker(1000, 5000);

    tracker.recordAcknowledgement(4 * mb, 16 * mb / 3, 3000);
    const rates = tracker.recordAcknowledgement(4 * mb, 16 * mb / 3, 7000);

    expect(rates.currentMediaMBps).toBeCloseTo(1.6, 5);
    expect(rates.averageMediaMBps).toBeCloseTo(8 / 6, 5);
    expect(rates.peakMediaMBps).toBeCloseTo(2, 5);
    expect(rates.currentEncodedMBps).toBeCloseTo((32 / 3) / 5, 5);
    expect(rates.uploadedMediaBytes).toBe(8 * mb);
  });
});
