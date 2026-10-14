import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import {
  exportAllDiagnosticReports,
  exportDiagnosticReport,
  exportLatestDiagnosticReport,
  DiagnosticPreflightSummary,
  DiagnosticUploadTiming,
  DiagnosticWindowPreflight,
  listDiagnosticReports,
  persistDiagnosticReport,
  TransferDiagnosticReport,
  TransferDiagnostics,
} from './DiagnosticStore';
import type { PreparedUploadFile } from '../upload/types';

jest.mock('../NativeCapabilities', () => ({
  nativeCapabilities: { available: false },
}));

jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, { contents: string; modificationTime: number }>();
  let clock = Date.now() / 1000;
  return {
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: jest.fn(),
    writeAsStringAsync: jest.fn(async (path: string, contents: string) => {
      files.set(path, { contents, modificationTime: clock++ });
    }),
    deleteAsync: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const value = files.get(from);
      if (!value) throw new Error('missing temporary report');
      files.delete(from);
      files.set(to, { contents: value.contents, modificationTime: clock++ });
    }),
    readDirectoryAsync: jest.fn(async () =>
      Array.from(files.keys())
        .filter(path => path.startsWith('file:///documents/lmt-diagnostics/'))
        .map(path => path.split('/').at(-1))),
    readAsStringAsync: jest.fn(async (path: string) => {
      const value = files.get(path);
      if (!value) throw new Error('missing diagnostic report');
      return value.contents;
    }),
    getInfoAsync: jest.fn(async (path: string) => {
      const value = files.get(path);
      return value
        ? {
            exists: true,
            isDirectory: false,
            size: value.contents.length,
            modificationTime: value.modificationTime,
          }
        : { exists: false, isDirectory: false };
    }),
    __files: files,
  };
});

function preflightWindow(
  values: Partial<DiagnosticWindowPreflight> = {},
): DiagnosticWindowPreflight {
  return {
    componentsConsidered: 0,
    bypassedFiles: 0,
    metadataUploadFiles: 0,
    metadataFallbackFiles: 0,
    receiverCandidateFiles: 0,
    localCandidateFiles: 0,
    hashCandidateFiles: 0,
    hashedFiles: 0,
    hashAttemptCount: 0,
    hashCacheHits: 0,
    hashFailureFiles: 0,
    hashedBytes: 0,
    hashedThenUploadedFiles: 0,
    hashedThenUploadedBytes: 0,
    receiverSkippedFiles: 0,
    receiverSkippedBytes: 0,
    outgoingSkippedFiles: 0,
    outgoingSkippedBytes: 0,
    metadataRequestCount: 0,
    metadataFailureCount: 0,
    verificationRequestCount: 0,
    verificationFailureCount: 0,
    verificationInconclusiveFiles: 0,
    metadataDurationMs: 0,
    hashingDurationMs: 0,
    verificationDurationMs: 0,
    candidateResolutionDurationMs: 0,
    totalHashWorkerDurationMs: 0,
    longestHashDurationMs: 0,
    largestHashedFileBytes: 0,
    nonCandidateFilesBlockedByHash: 0,
    nonCandidateBytesBlockedByHash: 0,
    preparedBytesHeldDuringPreflight: 0,
    temporaryBytesHeldDuringPreflight: 0,
    allUploadWorkersIdleDuringPreflightMs: 0,
    queueDepthAtStart: 0,
    queueDepthAtEnd: 0,
    activeUploadWorkersAtStart: 0,
    activeUploadWorkersAtEnd: 0,
    ...values,
  };
}

function preflightSummary(): DiagnosticPreflightSummary {
  return {
    ...preflightWindow(),
    windowCount: 0,
    totalWindowDurationMs: 0,
    maxWindowDurationMs: 0,
    windowsWithHashing: 0,
    windowsWithBlockedNonCandidates: 0,
    windowsWithAllUploadWorkersIdle: 0,
    maxPreparedBytesHeldDuringPreflight: 0,
    maxTemporaryBytesHeldDuringPreflight: 0,
  };
}

function uploadTiming(): DiagnosticUploadTiming {
  return {
    measuredFiles: 0,
    fileReadDurationMs: 0,
    httpRequestDurationMs: 0,
    interChunkGapDurationMs: 0,
    serverWriteDurationMs: 0,
    serverFinalizeDurationMs: 0,
    maxServerFinalizeDurationMs: 0,
  };
}

function report(sessionRef: string): TransferDiagnosticReport {
  return {
    schemaVersion: 6,
    sessionRef,
    appVersion: '1.0.2',
    environment: 'test',
    transport: 'expo-base64',
    includeAdditionalMediaComponents: false,
    startedAt: 1,
    updatedAt: 1,
    completionStatus: 'completed',
    selectedAssets: 1,
    preparedAssets: 1,
    expandedFiles: 1,
    selectedFiles: 1,
    preparedFiles: 1,
    uploadedFiles: 1,
    skippedFiles: 0,
    failedFiles: 0,
    discoveredBytes: 100,
    selectedMediaBytes: 100,
    additionalComponentsBytes: 0,
    selectedMediaFiles: 1,
    additionalComponentsFiles: 0,
    plannedUploadBytes: 100,
    acknowledgedBytes: 100,
    skippedBytes: 0,
    preflightSkippedFiles: 0,
    preflightSkippedBytes: 0,
    serverSkippedFiles: 0,
    serverSkippedBytes: 0,
    retryCount: 0,
    averageMediaMBps: 10,
    peakMediaMBps: 12,
    queueMaxDepth: 1,
    uploadCapacityWaitDurationMs: 0,
    uploadCapacityWaitCount: 0,
    maxUploadCapacityWaitDurationMs: 0,
    maxActiveUploadWorkers: 1,
    filenameResolvedAppleFiles: 0,
    filenameFallbackFiles: 1,
    peakNativeResidentMemoryBytes: 0,
    preflight: preflightSummary(),
    uploadTiming: uploadTiming(),
    materialization: [],
    windows: [],
    preflightWindowSamples: [],
    failures: [],
    failureCounts: [],
    omittedFailureDetails: 0,
    thermalTransitions: [],
  };
}

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectObjectKeys);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...collectObjectKeys(child),
  ]);
}

describe('DiagnosticStore', () => {
  beforeEach(() => {
    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string; modificationTime: number }>;
    }).__files;
    files.clear();
    jest.clearAllMocks();
    (FileSystem.writeAsStringAsync as jest.Mock).mockImplementation(
      async (path: string, contents: string) => {
        files.set(path, {
          contents,
          modificationTime: Date.now() / 1000,
        });
      },
    );
  });

  it('retains only the five newest allow-listed reports', async () => {
    const unsafeReport = report('six') as TransferDiagnosticReport & {
      filename: string;
      token: string;
    };
    unsafeReport.filename = 'IMG_3231.HEIC';
    unsafeReport.token = 'secret-token-marker';
    Object.assign(unsafeReport.preflight, { token: 'nested-secret-marker' });
    Object.assign(unsafeReport.uploadTiming, { url: 'https://nested-private-marker' });
    unsafeReport.windows = [Object.assign({
      windowIndex: 0,
      status: 'enqueued' as const,
      selectedCount: 1,
      preparedCount: 1,
      failedCount: 0,
      discoveredBytes: 100,
      selectedMediaBytes: 100,
      additionalComponentsBytes: 0,
      selectedMediaFiles: 1,
      additionalComponentsFiles: 0,
      plannedUploadBytes: 100,
      preflightSkippedFiles: 0,
      preflightSkippedBytes: 0,
      appleFilenameCount: 0,
      fallbackFilenameCount: 1,
      startedElapsedMs: 1,
      readyElapsedMs: 2,
      enqueueCompletedElapsedMs: 3,
      preparationDurationMs: 1,
      filenameDurationMs: 1,
      preflightDurationMs: 1,
      uploadCapacityWaitDurationMs: 0,
      uploadCapacityWaitCount: 0,
      preflight: Object.assign(preflightWindow(), {
        assetId: 'nested-photos-asset-marker',
      }),
      uploadTiming: uploadTiming(),
    }, {
      assetId: 'photos-asset-marker',
      url: 'https://private-server-marker',
    })];
    await persistDiagnosticReport(report('one'));
    await persistDiagnosticReport(report('two'));
    await persistDiagnosticReport(report('three'));
    await persistDiagnosticReport(report('four'));
    await persistDiagnosticReport(report('five'));
    await persistDiagnosticReport(unsafeReport);

    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string }>;
    }).__files;
    const reports = Array.from(files.entries()).filter(([path]) => path.endsWith('.json'));
    expect(reports).toHaveLength(5);
    expect(reports.some(([path]) => path.endsWith('transfer-one.json'))).toBe(false);
    const serialized = reports.map(([, value]) => value.contents).join('\n');
    const reportKeys = reports.flatMap(([, value]) =>
      collectObjectKeys(JSON.parse(value.contents) as unknown));
    for (const forbiddenKey of [
      'filename',
      'assetId',
      'token',
      'certificateFingerprint',
      'gps',
      'latitude',
      'longitude',
      'serverId',
      'url',
    ]) {
      expect(reportKeys.map(key => key.toLowerCase()))
        .not.toContain(forbiddenKey.toLowerCase());
    }
    for (const forbiddenValue of [
      'IMG_3231',
      'secret-token-marker',
      'nested-secret-marker',
      'photos-asset-marker',
      'nested-photos-asset-marker',
      'private-server-marker',
      'nested-private-marker',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbiddenValue.toLowerCase());
    }
  });

  it('removes reports older than seven days', async () => {
    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string; modificationTime: number }>;
    }).__files;
    files.set('file:///documents/lmt-diagnostics/transfer-expired.json', {
      contents: JSON.stringify(report('expired')),
      modificationTime: (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000,
    });

    await persistDiagnosticReport(report('current'));

    expect(files.has(
      'file:///documents/lmt-diagnostics/transfer-expired.json',
    )).toBe(false);
    expect(files.has(
      'file:///documents/lmt-diagnostics/transfer-current.json',
    )).toBe(true);
  });

  it('removes interrupted temporary checkpoints before listing reports', async () => {
    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string; modificationTime: number }>;
    }).__files;
    files.set(
      'file:///documents/lmt-diagnostics/transfer-interrupted.json.tmp',
      { contents: '{', modificationTime: 1 },
    );

    await expect(listDiagnosticReports()).resolves.toEqual([]);
    expect(files.has(
      'file:///documents/lmt-diagnostics/transfer-interrupted.json.tmp',
    )).toBe(false);
  });

  it('keeps total retained diagnostics at or below five MiB', async () => {
    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string; modificationTime: number }>;
    }).__files;
    files.set('file:///documents/lmt-diagnostics/transfer-older.json', {
      contents: 'a'.repeat(3 * 1024 * 1024),
      modificationTime: 1,
    });
    files.set('file:///documents/lmt-diagnostics/transfer-newer.json', {
      contents: 'b'.repeat(3 * 1024 * 1024),
      modificationTime: 2,
    });

    await persistDiagnosticReport(report('current'));

    const retainedBytes = Array.from(files.entries())
      .filter(([path]) => path.endsWith('.json'))
      .reduce((total, [, value]) => total + value.contents.length, 0);
    expect(retainedBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(files.has(
      'file:///documents/lmt-diagnostics/transfer-older.json',
    )).toBe(false);
  });

  it('keeps a 50,000-component streaming report below the retention budget', async () => {
    const large = report('large-preflight');
    large.selectedAssets = 50_000;
    large.selectedFiles = 50_000;
    large.windows = Array.from({ length: 3_125 }, (_, windowIndex) => ({
      windowIndex,
      status: 'enqueued' as const,
      selectedCount: 16,
      preparedCount: 16,
      failedCount: 0,
      discoveredBytes: 64_000_000,
      selectedMediaBytes: 48_000_000,
      additionalComponentsBytes: 16_000_000,
      selectedMediaFiles: 12,
      additionalComponentsFiles: 4,
      plannedUploadBytes: 60_000_000,
      preflightSkippedFiles: 1,
      preflightSkippedBytes: 4_000_000,
      appleFilenameCount: 16,
      fallbackFilenameCount: 0,
      startedElapsedMs: windowIndex * 100,
      readyElapsedMs: windowIndex * 100 + 80,
      enqueueCompletedElapsedMs: windowIndex * 100 + 90,
      firstUploadStartedElapsedMs: windowIndex * 100 + 91,
      preparationDurationMs: 50,
      filenameDurationMs: 2,
      preflightDurationMs: 28,
      uploadCapacityWaitDurationMs: 10,
      uploadCapacityWaitCount: 1,
      preflight: preflightWindow({
        componentsConsidered: 16,
        metadataUploadFiles: 14,
        receiverCandidateFiles: 2,
        hashCandidateFiles: 2,
        hashedFiles: 2,
        hashAttemptCount: 2,
        hashedBytes: 8_000_000,
        hashedThenUploadedFiles: 1,
        hashedThenUploadedBytes: 4_000_000,
        receiverSkippedFiles: 1,
        receiverSkippedBytes: 4_000_000,
        metadataRequestCount: 1,
        verificationRequestCount: 1,
        metadataDurationMs: 4,
        hashingDurationMs: 20,
        verificationDurationMs: 4,
        candidateResolutionDurationMs: 24,
        totalHashWorkerDurationMs: 38,
        longestHashDurationMs: 20,
        largestHashedFileBytes: 4_000_000,
        nonCandidateFilesBlockedByHash: 14,
        nonCandidateBytesBlockedByHash: 56_000_000,
        preparedBytesHeldDuringPreflight: 64_000_000,
        temporaryBytesHeldDuringPreflight: 64_000_000,
        allUploadWorkersIdleDuringPreflightMs: 10,
      }),
      uploadTiming: uploadTiming(),
    }));

    await persistDiagnosticReport(large);

    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string }>;
    }).__files;
    const stored = files.get(
      'file:///documents/lmt-diagnostics/transfer-large-preflight.json',
    );
    expect(stored).toBeDefined();
    expect(stored?.contents.length).toBeLessThan(5 * 1024 * 1024);
  });

  it('rejects unsafe session references before constructing a file path', async () => {
    await expect(persistDiagnosticReport(report('../outside')))
      .rejects.toThrow('Invalid diagnostic session reference');
  });

  it('keeps materialization diagnostics aggregate-only and bounded by broad path', async () => {
    const diagnostics = new TransferDiagnostics('materialization-safe', 50_000);
    const prepared = {
      materializationPath: 'current-video',
      materializationDurationMs: 12_500,
      temporaryBytesWritten: 2_000_000_000,
    } as unknown as PreparedUploadFile;
    for (let index = 0; index < 50_000; index += 1) {
      diagnostics.recordMaterialization(prepared);
    }
    diagnostics.recordTemporaryRelease({
      materializationPath: 'current-video',
      temporaryBytesWritten: 2_000_000_000,
      temporaryLifetimeMs: 45_000,
    });
    await diagnostics.finish('completed');

    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string }>;
    }).__files;
    const stored = files.get(
      'file:///documents/lmt-diagnostics/transfer-materialization-safe.json',
    );
    const serialized = JSON.parse(stored?.contents ?? '{}') as TransferDiagnosticReport;
    const video = serialized.materialization.find(item => item.path === 'current-video');
    expect(video).toEqual(expect.objectContaining({
      preparedFiles: 50_000,
      temporaryFiles: 50_000,
      temporaryBytesWritten: 100_000_000_000_000,
      maxMaterializationDurationMs: 12_500,
      maxTemporaryFileBytes: 2_000_000_000,
      releasedFiles: 1,
      maxTemporaryLifetimeMs: 45_000,
    }));
    expect(serialized.materialization).toHaveLength(7);
    expect(stored?.contents).not.toContain('IMG_9999.MOV');
    expect(stored?.contents).not.toContain('photos-library-identifier');
    expect(stored?.contents.length).toBeLessThan(50_000);
  });

  it('checkpoints typed failures and exports only after an explicit action', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({
      action: Share.sharedAction,
    });
    const diagnostics = new TransferDiagnostics('session-safe', 2);
    await diagnostics.start();
    diagnostics.recordFailure({
      fileRef: 2,
      stage: 'filename',
      code: 'resource-not-found',
      retryCount: 0,
    });
    diagnostics.recordThermal('serious');
    await diagnostics.finish('mixed');

    expect(share).not.toHaveBeenCalled();
    await expect(exportLatestDiagnosticReport()).resolves.toBe(true);
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Local Media Transfer diagnostics',
      url: expect.stringContaining('transfer-session-safe.json'),
    }));
    share.mockRestore();
  });

  it('keeps exact failure aggregates while bounding diagnostic detail rows', async () => {
    const diagnostics = new TransferDiagnostics('bounded-failures', 1_005);
    await diagnostics.start();
    for (let index = 0; index < 1_005; index += 1) {
      diagnostics.recordFailure({
        fileRef: index + 1,
        stage: 'metadata',
        code: 'file-missing',
        retryCount: 0,
      });
    }
    await diagnostics.finish('mixed');

    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string }>;
    }).__files;
    const stored = files.get(
      'file:///documents/lmt-diagnostics/transfer-bounded-failures.json',
    );
    const serialized = JSON.parse(stored?.contents ?? '{}') as TransferDiagnosticReport;
    expect(serialized.failedFiles).toBe(1_005);
    expect(serialized.failures).toHaveLength(1_000);
    expect(serialized.omittedFailureDetails).toBe(5);
    expect(serialized.failureCounts).toEqual([{
      stage: 'metadata',
      code: 'file-missing',
      count: 1_005,
    }]);
  });

  it('records requested and automatic effective preparation modes', async () => {
    const diagnostics = new TransferDiagnostics(
      'automatic-streaming',
      251,
      'streaming',
      'prepare-first',
      'large-native-selection',
    );
    await diagnostics.start();
    await diagnostics.finish('completed');

    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string }>;
    }).__files;
    const stored = files.get(
      'file:///documents/lmt-diagnostics/transfer-automatic-streaming.json',
    );
    expect(JSON.parse(stored?.contents ?? '{}')).toEqual(expect.objectContaining({
      requestedPreparationMode: 'prepare-first',
      preparationMode: 'streaming',
      automaticPreparationReason: 'large-native-selection',
    }));
  });

  it('reports diagnostics as unavailable when every checkpoint write fails', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValue(
      new Error('diagnostic storage unavailable'),
    );
    const diagnostics = new TransferDiagnostics('write-failure', 1);

    await diagnostics.start();
    await diagnostics.finish('fatal');

    expect(diagnostics.reportAvailable).toBe(false);
  });

  it('lists five recent reports and supports exporting one or all explicitly', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({
      action: Share.sharedAction,
    });
    for (let index = 1; index <= 5; index += 1) {
      const next = report(`history-${index}`);
      next.startedAt = index;
      await persistDiagnosticReport(next);
    }

    const reports = await listDiagnosticReports();
    expect(reports).toHaveLength(5);
    expect(reports.map(item => item.startedAt)).toEqual([5, 4, 3, 2, 1]);

    await expect(exportDiagnosticReport(reports[2].path)).resolves.toBe(true);
    expect(share).toHaveBeenLastCalledWith(expect.objectContaining({
      url: reports[2].path,
    }));

    await expect(exportAllDiagnosticReports()).resolves.toBe(true);
    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string }>;
    }).__files;
    expect(share).toHaveBeenLastCalledWith(expect.objectContaining({
      url: 'file:///cache/local-media-transfer-diagnostics.json',
    }));
    expect(files.has('file:///cache/local-media-transfer-diagnostics.json')).toBe(false);
    share.mockRestore();
  });

  it('records streaming overlap, bounded concurrency, and aggregate transfer metrics', async () => {
    let now = 1_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const diagnostics = new TransferDiagnostics('streaming-safe', 251);
    await diagnostics.start();

    now = 1_010;
    diagnostics.beginWindow(0, 250);
    now = 1_020;
    diagnostics.checkpointWindow({
      windowIndex: 0,
      status: 'ready',
      selectedCount: 250,
      preparedCount: 250,
      failedCount: 0,
      discoveredBytes: 2_500,
      selectedMediaBytes: 2_000,
      additionalComponentsBytes: 500,
      selectedMediaFiles: 200,
      additionalComponentsFiles: 50,
      plannedUploadBytes: 2_490,
      preflightSkippedFiles: 1,
      preflightSkippedBytes: 10,
      appleFilenameCount: 250,
      fallbackFilenameCount: 0,
      startedElapsedMs: 0,
      readyElapsedMs: diagnostics.elapsedMs(),
      preparationDurationMs: 9,
      filenameDurationMs: 2,
      preflightDurationMs: 1,
      uploadCapacityWaitDurationMs: 0,
      uploadCapacityWaitCount: 0,
      preflight: preflightWindow({
        componentsConsidered: 250,
        metadataUploadFiles: 249,
        receiverCandidateFiles: 1,
        hashCandidateFiles: 1,
        hashedFiles: 1,
        hashAttemptCount: 1,
        hashedBytes: 10,
        receiverSkippedFiles: 1,
        receiverSkippedBytes: 10,
        metadataRequestCount: 3,
        verificationRequestCount: 1,
        metadataDurationMs: 1,
        hashingDurationMs: 2,
        verificationDurationMs: 1,
        candidateResolutionDurationMs: 3,
        totalHashWorkerDurationMs: 2,
        longestHashDurationMs: 2,
        largestHashedFileBytes: 10,
        nonCandidateFilesBlockedByHash: 249,
        nonCandidateBytesBlockedByHash: 2_490,
        preparedBytesHeldDuringPreflight: 2_500,
        temporaryBytesHeldDuringPreflight: 2_500,
        allUploadWorkersIdleDuringPreflightMs: 1,
      }),
      uploadTiming: uploadTiming(),
    });
    now = 1_025;
    diagnostics.markWindowEnqueued(0, 248);
    diagnostics.recordUploadCapacityWait(0, 12);
    diagnostics.recordUploadWorkerStarted(1);
    diagnostics.recordUploadWorkerStarted(2);
    now = 1_026;
    diagnostics.recordWindowUploadStarted(0);
    diagnostics.recordNativeUploadTiming(0, {
      fileReadDurationMs: 3,
      httpRequestDurationMs: 4,
      interChunkGapDurationMs: 1,
      serverWriteDurationMs: 2,
      serverFinalizeDurationMs: 5,
    });
    now = 1_030;
    diagnostics.recordFirstAcknowledgement();
    now = 1_035;
    diagnostics.beginWindow(1, 1);
    now = 1_050;
    diagnostics.checkpointWindow({
      windowIndex: 1,
      status: 'ready',
      selectedCount: 1,
      preparedCount: 1,
      failedCount: 0,
      discoveredBytes: 20,
      selectedMediaBytes: 20,
      additionalComponentsBytes: 0,
      selectedMediaFiles: 1,
      additionalComponentsFiles: 0,
      plannedUploadBytes: 20,
      preflightSkippedFiles: 0,
      preflightSkippedBytes: 0,
      appleFilenameCount: 1,
      fallbackFilenameCount: 0,
      startedElapsedMs: 0,
      readyElapsedMs: diagnostics.elapsedMs(),
      preparationDurationMs: 14,
      filenameDurationMs: 1,
      preflightDurationMs: 1,
      uploadCapacityWaitDurationMs: 0,
      uploadCapacityWaitCount: 0,
      preflight: preflightWindow({
        componentsConsidered: 1,
        metadataUploadFiles: 1,
        metadataRequestCount: 1,
        metadataDurationMs: 1,
        preparedBytesHeldDuringPreflight: 20,
        temporaryBytesHeldDuringPreflight: 20,
      }),
      uploadTiming: uploadTiming(),
    });
    diagnostics.markWindowEnqueued(1, 248);
    diagnostics.markPreparationComplete(248);
    diagnostics.updateTransfer({
      preparedAssets: 251,
      expandedFiles: 251,
      uploadedFiles: 250,
      skippedFiles: 1,
      failedFiles: 0,
      selectedMediaBytes: 2_020,
      additionalComponentsBytes: 500,
      selectedMediaFiles: 201,
      additionalComponentsFiles: 50,
      plannedUploadBytes: 2_510,
      acknowledgedBytes: 2_510,
      skippedBytes: 10,
      preflightSkippedFiles: 1,
      preflightSkippedBytes: 10,
      serverSkippedFiles: 0,
      serverSkippedBytes: 0,
      retryCount: 1,
      averageMediaMBps: 42.5,
      peakMediaMBps: 61.25,
      queueMaxDepth: 248,
      maxActiveUploadWorkers: 2,
      filenameResolvedAppleFiles: 251,
      filenameFallbackFiles: 0,
      peakNativeResidentMemoryBytes: 12_345,
    });
    now = 1_100;
    await diagnostics.finish('completed');
    nowSpy.mockRestore();

    const files = (FileSystem as unknown as {
      __files: Map<string, { contents: string }>;
    }).__files;
    const stored = files.get(
      'file:///documents/lmt-diagnostics/transfer-streaming-safe.json',
    );
    const serialized = JSON.parse(stored?.contents ?? '{}') as TransferDiagnosticReport;
    expect(serialized).toEqual(expect.objectContaining({
      schemaVersion: 6,
      selectedAssets: 251,
      preparedAssets: 251,
      expandedFiles: 251,
      sessionDurationMs: 100,
      firstUploadStartedElapsedMs: 25,
      firstAcknowledgementElapsedMs: 30,
      preparationCompletedElapsedMs: 50,
      uploadPhaseDurationMs: 75,
      plannedUploadBytes: 2_510,
      acknowledgedBytes: 2_510,
      skippedBytes: 10,
      selectedMediaBytes: 2_020,
      additionalComponentsBytes: 500,
      selectedMediaFiles: 201,
      additionalComponentsFiles: 50,
      averageMediaMBps: 42.5,
      peakMediaMBps: 61.25,
      queueMaxDepth: 248,
      uploadCapacityWaitDurationMs: 12,
      uploadCapacityWaitCount: 1,
      maxUploadCapacityWaitDurationMs: 12,
      maxActiveUploadWorkers: 2,
      filenameResolvedAppleFiles: 251,
      filenameFallbackFiles: 0,
      peakNativeResidentMemoryBytes: 12_345,
    }));
    expect(serialized.preflight).toEqual(expect.objectContaining({
      windowCount: 2,
      componentsConsidered: 251,
      receiverCandidateFiles: 1,
      hashedFiles: 1,
      hashedBytes: 10,
      receiverSkippedFiles: 1,
      receiverSkippedBytes: 10,
      metadataRequestCount: 4,
      verificationRequestCount: 1,
      windowsWithHashing: 1,
      windowsWithBlockedNonCandidates: 1,
      windowsWithAllUploadWorkersIdle: 1,
      maxTemporaryBytesHeldDuringPreflight: 2_500,
    }));
    expect(serialized.uploadTiming).toEqual({
      measuredFiles: 1,
      fileReadDurationMs: 3,
      httpRequestDurationMs: 4,
      interChunkGapDurationMs: 1,
      serverWriteDurationMs: 2,
      serverFinalizeDurationMs: 5,
      maxServerFinalizeDurationMs: 5,
    });
    expect(serialized.windows).toEqual([
      expect.objectContaining({
        windowIndex: 0,
        status: 'enqueued',
        startedElapsedMs: 10,
        readyElapsedMs: 20,
        enqueueCompletedElapsedMs: 25,
        firstUploadStartedElapsedMs: 26,
      }),
      expect.objectContaining({
        windowIndex: 1,
        status: 'enqueued',
        startedElapsedMs: 35,
        readyElapsedMs: 50,
      }),
    ]);
    expect(serialized.firstUploadStartedElapsedMs)
      .toBeLessThan(serialized.windows[1].readyElapsedMs ?? 0);
    expect(serialized.preflightWindowSamples).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowIndex: 0,
        preflight: expect.objectContaining({ hashedFiles: 1 }),
        uploadTiming: expect.objectContaining({ measuredFiles: 1 }),
      }),
    ]));
  });
});
