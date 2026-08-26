import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { iosClientEnvironment } from '@/config/runtimeEnvironment';
import { IOS_APP_VERSION } from '@/version';
import { nativeCapabilities, NativeReleaseMetrics } from '../NativeCapabilities';
import {
  DuplicatePreflightMetrics,
  PreparationMode,
  PreparedUploadFile,
  ThermalState,
} from '../upload/types';
import { MediaMaterializationPath } from '../upload/mediaVariants';
import { TransferErrorCode, TransferStage } from '../upload/errors';

const REPORT_DIRECTORY = `${FileSystem.documentDirectory ?? ''}lmt-diagnostics`;
const MAX_REPORTS = 5;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILURE_DETAILS = 1_000;
const WINDOW_PERSIST_INTERVAL = 8;
const MAX_PREFLIGHT_WINDOW_SAMPLES = 64;

export type DiagnosticFailure = {
  fileRef: number;
  stage: TransferStage;
  code: TransferErrorCode;
  retryCount: number;
};

export type DiagnosticFailureCount = {
  stage: TransferStage;
  code: TransferErrorCode;
  count: number;
};

export type DiagnosticWindow = {
  windowIndex: number;
  status: 'preparing' | 'ready' | 'enqueued';
  selectedCount: number;
  preparedCount: number;
  failedCount: number;
  discoveredBytes: number;
  selectedMediaBytes: number;
  additionalComponentsBytes: number;
  selectedMediaFiles: number;
  additionalComponentsFiles: number;
  plannedUploadBytes: number;
  preflightSkippedFiles: number;
  preflightSkippedBytes: number;
  appleFilenameCount: number;
  fallbackFilenameCount: number;
  startedElapsedMs: number;
  readyElapsedMs?: number;
  enqueueCompletedElapsedMs?: number;
  uploadCapacityWaitDurationMs: number;
  uploadCapacityWaitCount: number;
  preparationDurationMs: number;
  filenameDurationMs: number;
  preflightDurationMs: number;
  preflight?: DiagnosticWindowPreflight;
  firstUploadStartedElapsedMs?: number;
  uploadTiming?: DiagnosticUploadTiming;
};

export type DiagnosticWindowPreflight = DuplicatePreflightMetrics & {
  allUploadWorkersIdleDuringPreflightMs: number;
  queueDepthAtStart: number;
  queueDepthAtEnd: number;
  activeUploadWorkersAtStart: number;
  activeUploadWorkersAtEnd: number;
};

export type DiagnosticPreflightSummary = DuplicatePreflightMetrics & {
  windowCount: number;
  totalWindowDurationMs: number;
  maxWindowDurationMs: number;
  windowsWithHashing: number;
  windowsWithBlockedNonCandidates: number;
  windowsWithAllUploadWorkersIdle: number;
  allUploadWorkersIdleDuringPreflightMs: number;
  maxPreparedBytesHeldDuringPreflight: number;
  maxTemporaryBytesHeldDuringPreflight: number;
};

export type DiagnosticUploadTiming = {
  measuredFiles: number;
  fileReadDurationMs: number;
  httpRequestDurationMs: number;
  interChunkGapDurationMs: number;
  serverWriteDurationMs: number;
  serverFinalizeDurationMs: number;
  maxServerFinalizeDurationMs: number;
};

export type DiagnosticPreflightWindowSample = {
  windowIndex: number;
  preparationDurationMs: number;
  preflightDurationMs: number;
  plannedUploadBytes: number;
  startedElapsedMs: number;
  readyElapsedMs?: number;
  enqueueCompletedElapsedMs?: number;
  uploadCapacityWaitDurationMs: number;
  uploadCapacityWaitCount: number;
  firstUploadStartedElapsedMs?: number;
  preflight: DiagnosticWindowPreflight;
  uploadTiming: DiagnosticUploadTiming;
};

export type DiagnosticThermalTransition = {
  state: ThermalState;
  elapsedMs: number;
};

export type DiagnosticMaterializationSummary = {
  path: MediaMaterializationPath;
  preparedFiles: number;
  temporaryFiles: number;
  temporaryBytesWritten: number;
  totalMaterializationDurationMs: number;
  maxMaterializationDurationMs: number;
  maxTemporaryFileBytes: number;
  releasedFiles: number;
  totalTemporaryLifetimeMs: number;
  maxTemporaryLifetimeMs: number;
};

export type TransferDiagnosticReport = {
  schemaVersion: 6;
  sessionRef: string;
  appVersion: string;
  environment: 'production' | 'test';
  transport: 'native-raw' | 'expo-base64';
  requestedPreparationMode?: PreparationMode;
  preparationMode?: PreparationMode;
  automaticPreparationReason?: 'large-native-selection';
  includeAdditionalMediaComponents: boolean;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  sessionDurationMs?: number;
  firstUploadStartedElapsedMs?: number;
  firstAcknowledgementElapsedMs?: number;
  preparationCompletedElapsedMs?: number;
  uploadPhaseDurationMs?: number;
  completionStatus: 'running' | 'completed' | 'mixed' | 'cancelled' | 'fatal';
  selectedAssets: number;
  preparedAssets: number;
  expandedFiles: number;
  /** Retained for diagnostic-schema compatibility; equals selectedAssets. */
  selectedFiles: number;
  /** Prepared media components, not selected Photos assets. */
  preparedFiles: number;
  uploadedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  discoveredBytes: number;
  selectedMediaBytes: number;
  additionalComponentsBytes: number;
  selectedMediaFiles: number;
  additionalComponentsFiles: number;
  plannedUploadBytes: number;
  acknowledgedBytes: number;
  skippedBytes: number;
  preflightSkippedFiles: number;
  preflightSkippedBytes: number;
  serverSkippedFiles: number;
  serverSkippedBytes: number;
  retryCount: number;
  averageMediaMBps: number;
  peakMediaMBps: number;
  queueMaxDepth: number;
  uploadCapacityWaitDurationMs: number;
  uploadCapacityWaitCount: number;
  maxUploadCapacityWaitDurationMs: number;
  maxActiveUploadWorkers: number;
  filenameResolvedAppleFiles: number;
  filenameFallbackFiles: number;
  peakNativeResidentMemoryBytes: number;
  preflight: DiagnosticPreflightSummary;
  uploadTiming: DiagnosticUploadTiming;
  materialization: DiagnosticMaterializationSummary[];
  windows: DiagnosticWindow[];
  preflightWindowSamples: DiagnosticPreflightWindowSample[];
  failures: DiagnosticFailure[];
  failureCounts: DiagnosticFailureCount[];
  omittedFailureDetails: number;
  thermalTransitions: DiagnosticThermalTransition[];
};

const MATERIALIZATION_PATHS: MediaMaterializationPath[] = [
  'photo-resource',
  'video-resource',
  'raw-resource',
  'live-photo-motion',
  'current-image',
  'current-video',
  'expo-direct',
];

function emptyMaterializationSummary(
  path: MediaMaterializationPath,
): DiagnosticMaterializationSummary {
  return {
    path,
    preparedFiles: 0,
    temporaryFiles: 0,
    temporaryBytesWritten: 0,
    totalMaterializationDurationMs: 0,
    maxMaterializationDurationMs: 0,
    maxTemporaryFileBytes: 0,
    releasedFiles: 0,
    totalTemporaryLifetimeMs: 0,
    maxTemporaryLifetimeMs: 0,
  };
}

export type DiagnosticReportSummary = {
  path: string;
  schemaVersion: number;
  startedAt: number;
  completedAt?: number;
  completionStatus: TransferDiagnosticReport['completionStatus'];
  selectedAssets: number;
  selectedFiles: number;
  environment: TransferDiagnosticReport['environment'];
};

function emptyPreflightMetrics(): DuplicatePreflightMetrics {
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
  };
}

function emptyPreflightSummary(): DiagnosticPreflightSummary {
  return {
    ...emptyPreflightMetrics(),
    windowCount: 0,
    totalWindowDurationMs: 0,
    maxWindowDurationMs: 0,
    windowsWithHashing: 0,
    windowsWithBlockedNonCandidates: 0,
    windowsWithAllUploadWorkersIdle: 0,
    allUploadWorkersIdleDuringPreflightMs: 0,
    maxPreparedBytesHeldDuringPreflight: 0,
    maxTemporaryBytesHeldDuringPreflight: 0,
  };
}

function emptyUploadTiming(): DiagnosticUploadTiming {
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

function copyPreflightMetrics(
  metrics: DuplicatePreflightMetrics,
): DuplicatePreflightMetrics {
  return {
    componentsConsidered: metrics.componentsConsidered,
    bypassedFiles: metrics.bypassedFiles,
    metadataUploadFiles: metrics.metadataUploadFiles,
    metadataFallbackFiles: metrics.metadataFallbackFiles,
    receiverCandidateFiles: metrics.receiverCandidateFiles,
    localCandidateFiles: metrics.localCandidateFiles,
    hashCandidateFiles: metrics.hashCandidateFiles,
    hashedFiles: metrics.hashedFiles,
    hashAttemptCount: metrics.hashAttemptCount,
    hashCacheHits: metrics.hashCacheHits,
    hashFailureFiles: metrics.hashFailureFiles,
    hashedBytes: metrics.hashedBytes,
    hashedThenUploadedFiles: metrics.hashedThenUploadedFiles,
    hashedThenUploadedBytes: metrics.hashedThenUploadedBytes,
    receiverSkippedFiles: metrics.receiverSkippedFiles,
    receiverSkippedBytes: metrics.receiverSkippedBytes,
    outgoingSkippedFiles: metrics.outgoingSkippedFiles,
    outgoingSkippedBytes: metrics.outgoingSkippedBytes,
    metadataRequestCount: metrics.metadataRequestCount,
    metadataFailureCount: metrics.metadataFailureCount,
    verificationRequestCount: metrics.verificationRequestCount,
    verificationFailureCount: metrics.verificationFailureCount,
    verificationInconclusiveFiles: metrics.verificationInconclusiveFiles,
    metadataDurationMs: metrics.metadataDurationMs,
    hashingDurationMs: metrics.hashingDurationMs,
    verificationDurationMs: metrics.verificationDurationMs,
    candidateResolutionDurationMs: metrics.candidateResolutionDurationMs,
    totalHashWorkerDurationMs: metrics.totalHashWorkerDurationMs,
    longestHashDurationMs: metrics.longestHashDurationMs,
    largestHashedFileBytes: metrics.largestHashedFileBytes,
    nonCandidateFilesBlockedByHash: metrics.nonCandidateFilesBlockedByHash,
    nonCandidateBytesBlockedByHash: metrics.nonCandidateBytesBlockedByHash,
    preparedBytesHeldDuringPreflight: metrics.preparedBytesHeldDuringPreflight,
    temporaryBytesHeldDuringPreflight: metrics.temporaryBytesHeldDuringPreflight,
  };
}

function copyUploadTiming(timing: DiagnosticUploadTiming): DiagnosticUploadTiming {
  return {
    measuredFiles: timing.measuredFiles,
    fileReadDurationMs: timing.fileReadDurationMs,
    httpRequestDurationMs: timing.httpRequestDurationMs,
    interChunkGapDurationMs: timing.interChunkGapDurationMs,
    serverWriteDurationMs: timing.serverWriteDurationMs,
    serverFinalizeDurationMs: timing.serverFinalizeDurationMs,
    maxServerFinalizeDurationMs: timing.maxServerFinalizeDurationMs,
  };
}

function copyWindowPreflight(
  preflight: DiagnosticWindowPreflight,
): DiagnosticWindowPreflight {
  return { ...copyPreflightMetrics(preflight),
    allUploadWorkersIdleDuringPreflightMs:
      preflight.allUploadWorkersIdleDuringPreflightMs,
    queueDepthAtStart: preflight.queueDepthAtStart,
    queueDepthAtEnd: preflight.queueDepthAtEnd,
    activeUploadWorkersAtStart: preflight.activeUploadWorkersAtStart,
    activeUploadWorkersAtEnd: preflight.activeUploadWorkersAtEnd,
  };
}

function selectPreflightWindowSamples(
  windows: DiagnosticWindow[],
): DiagnosticPreflightWindowSample[] {
  const eligible = windows.filter(
    (window): window is DiagnosticWindow & {
      preflight: DiagnosticWindowPreflight;
      uploadTiming: DiagnosticUploadTiming;
    } => window.preflight !== undefined && window.uploadTiming !== undefined,
  );
  const selected = new Map<number, typeof eligible[number]>();
  const take = (
    count: number,
    score: (window: typeof eligible[number]) => number,
  ) => {
    for (const window of [...eligible]
      .sort((left, right) => score(right) - score(left) || left.windowIndex - right.windowIndex)
      .slice(0, count)) {
      if (selected.size >= MAX_PREFLIGHT_WINDOW_SAMPLES) break;
      selected.set(window.windowIndex, window);
    }
  };
  take(24, window => window.preflightDurationMs);
  take(16, window => window.preflight.allUploadWorkersIdleDuringPreflightMs);
  take(16, window => window.preflight.temporaryBytesHeldDuringPreflight);
  take(8, window => window.uploadTiming.maxServerFinalizeDurationMs);
  return [...selected.values()]
    .sort((left, right) => left.windowIndex - right.windowIndex)
    .map(window => ({
      windowIndex: window.windowIndex,
      preparationDurationMs: window.preparationDurationMs,
      preflightDurationMs: window.preflightDurationMs,
      plannedUploadBytes: window.plannedUploadBytes,
      uploadCapacityWaitDurationMs: window.uploadCapacityWaitDurationMs,
      uploadCapacityWaitCount: window.uploadCapacityWaitCount,
      startedElapsedMs: window.startedElapsedMs,
      ...(window.readyElapsedMs === undefined ? {} : { readyElapsedMs: window.readyElapsedMs }),
      ...(window.enqueueCompletedElapsedMs === undefined
        ? {}
        : { enqueueCompletedElapsedMs: window.enqueueCompletedElapsedMs }),
      ...(window.firstUploadStartedElapsedMs === undefined
        ? {}
        : { firstUploadStartedElapsedMs: window.firstUploadStartedElapsedMs }),
      preflight: copyWindowPreflight(window.preflight),
      uploadTiming: copyUploadTiming(window.uploadTiming),
    }));
}

function accumulatePreflightSummary(
  summary: DiagnosticPreflightSummary,
  current: DiagnosticWindowPreflight,
  durationMs: number,
  previous?: DiagnosticWindowPreflight,
  previousDurationMs = 0,
): void {
  const before = previous ?? {
    ...emptyPreflightMetrics(),
    allUploadWorkersIdleDuringPreflightMs: 0,
    queueDepthAtStart: 0,
    queueDepthAtEnd: 0,
    activeUploadWorkersAtStart: 0,
    activeUploadWorkersAtEnd: 0,
  };
  const add = <K extends keyof DuplicatePreflightMetrics>(key: K) => {
    summary[key] += current[key] - before[key];
  };
  for (const key of [
    'componentsConsidered',
    'bypassedFiles',
    'metadataUploadFiles',
    'metadataFallbackFiles',
    'receiverCandidateFiles',
    'localCandidateFiles',
    'hashCandidateFiles',
    'hashedFiles',
    'hashAttemptCount',
    'hashCacheHits',
    'hashFailureFiles',
    'hashedBytes',
    'hashedThenUploadedFiles',
    'hashedThenUploadedBytes',
    'receiverSkippedFiles',
    'receiverSkippedBytes',
    'outgoingSkippedFiles',
    'outgoingSkippedBytes',
    'metadataRequestCount',
    'metadataFailureCount',
    'verificationRequestCount',
    'verificationFailureCount',
    'verificationInconclusiveFiles',
    'metadataDurationMs',
    'hashingDurationMs',
    'verificationDurationMs',
    'candidateResolutionDurationMs',
    'totalHashWorkerDurationMs',
    'nonCandidateFilesBlockedByHash',
    'nonCandidateBytesBlockedByHash',
    'preparedBytesHeldDuringPreflight',
    'temporaryBytesHeldDuringPreflight',
  ] as const) {
    add(key);
  }
  summary.longestHashDurationMs = Math.max(
    summary.longestHashDurationMs,
    current.longestHashDurationMs,
  );
  summary.largestHashedFileBytes = Math.max(
    summary.largestHashedFileBytes,
    current.largestHashedFileBytes,
  );
  if (!previous) summary.windowCount += 1;
  summary.totalWindowDurationMs += durationMs - previousDurationMs;
  summary.maxWindowDurationMs = Math.max(summary.maxWindowDurationMs, durationMs);
  summary.windowsWithHashing += Number(current.hashedFiles > 0) - Number(before.hashedFiles > 0);
  summary.windowsWithBlockedNonCandidates +=
    Number(current.nonCandidateFilesBlockedByHash > 0) -
    Number(before.nonCandidateFilesBlockedByHash > 0);
  summary.windowsWithAllUploadWorkersIdle +=
    Number(
      current.nonCandidateFilesBlockedByHash > 0 &&
      current.allUploadWorkersIdleDuringPreflightMs > 0,
    ) -
    Number(
      before.nonCandidateFilesBlockedByHash > 0 &&
      before.allUploadWorkersIdleDuringPreflightMs > 0,
    );
  summary.allUploadWorkersIdleDuringPreflightMs +=
    current.allUploadWorkersIdleDuringPreflightMs -
    before.allUploadWorkersIdleDuringPreflightMs;
  summary.maxPreparedBytesHeldDuringPreflight = Math.max(
    summary.maxPreparedBytesHeldDuringPreflight,
    current.preparedBytesHeldDuringPreflight,
  );
  summary.maxTemporaryBytesHeldDuringPreflight = Math.max(
    summary.maxTemporaryBytesHeldDuringPreflight,
    current.temporaryBytesHeldDuringPreflight,
  );
}

function addUploadTiming(
  target: DiagnosticUploadTiming,
  timing: Omit<DiagnosticUploadTiming, 'measuredFiles' | 'maxServerFinalizeDurationMs'>,
): void {
  target.measuredFiles += 1;
  target.fileReadDurationMs += timing.fileReadDurationMs;
  target.httpRequestDurationMs += timing.httpRequestDurationMs;
  target.interChunkGapDurationMs += timing.interChunkGapDurationMs;
  target.serverWriteDurationMs += timing.serverWriteDurationMs;
  target.serverFinalizeDurationMs += timing.serverFinalizeDurationMs;
  target.maxServerFinalizeDurationMs = Math.max(
    target.maxServerFinalizeDurationMs,
    timing.serverFinalizeDurationMs,
  );
}

function filesystemAvailable(): boolean {
  return Boolean(
    FileSystem.documentDirectory &&
    typeof FileSystem.makeDirectoryAsync === 'function' &&
    typeof FileSystem.writeAsStringAsync === 'function',
  );
}

async function ensureDirectory(): Promise<void> {
  if (!filesystemAvailable()) return;
  await FileSystem.makeDirectoryAsync(REPORT_DIRECTORY, { intermediates: true });
}

function reportPath(sessionRef: string): string {
  if (!/^[a-z0-9-]{1,64}$/i.test(sessionRef)) {
    throw new Error('Invalid diagnostic session reference');
  }
  return `${REPORT_DIRECTORY}/transfer-${sessionRef}.json`;
}

function allowListedReport(
  report: TransferDiagnosticReport,
): TransferDiagnosticReport {
  return {
    schemaVersion: 6,
    sessionRef: report.sessionRef,
    appVersion: report.appVersion,
    environment: report.environment,
    transport: report.transport,
    requestedPreparationMode: report.requestedPreparationMode ?? report.preparationMode ?? 'prepare-first',
    preparationMode: report.preparationMode ?? 'prepare-first',
    ...(report.automaticPreparationReason === undefined
      ? {}
      : { automaticPreparationReason: report.automaticPreparationReason }),
    includeAdditionalMediaComponents: report.includeAdditionalMediaComponents,
    startedAt: report.startedAt,
    updatedAt: report.updatedAt,
    ...(report.completedAt === undefined ? {} : { completedAt: report.completedAt }),
    ...(report.sessionDurationMs === undefined
      ? {}
      : { sessionDurationMs: report.sessionDurationMs }),
    ...(report.firstUploadStartedElapsedMs === undefined
      ? {}
      : { firstUploadStartedElapsedMs: report.firstUploadStartedElapsedMs }),
    ...(report.firstAcknowledgementElapsedMs === undefined
      ? {}
      : { firstAcknowledgementElapsedMs: report.firstAcknowledgementElapsedMs }),
    ...(report.preparationCompletedElapsedMs === undefined
      ? {}
      : { preparationCompletedElapsedMs: report.preparationCompletedElapsedMs }),
    ...(report.uploadPhaseDurationMs === undefined
      ? {}
      : { uploadPhaseDurationMs: report.uploadPhaseDurationMs }),
    completionStatus: report.completionStatus,
    selectedAssets: report.selectedAssets,
    preparedAssets: report.preparedAssets,
    expandedFiles: report.expandedFiles,
    selectedFiles: report.selectedFiles,
    preparedFiles: report.preparedFiles,
    uploadedFiles: report.uploadedFiles,
    skippedFiles: report.skippedFiles,
    failedFiles: report.failedFiles,
    discoveredBytes: report.discoveredBytes,
    selectedMediaBytes: report.selectedMediaBytes,
    additionalComponentsBytes: report.additionalComponentsBytes,
    selectedMediaFiles: report.selectedMediaFiles,
    additionalComponentsFiles: report.additionalComponentsFiles,
    plannedUploadBytes: report.plannedUploadBytes,
    acknowledgedBytes: report.acknowledgedBytes,
    skippedBytes: report.skippedBytes,
    preflightSkippedFiles: report.preflightSkippedFiles,
    preflightSkippedBytes: report.preflightSkippedBytes,
    serverSkippedFiles: report.serverSkippedFiles,
    serverSkippedBytes: report.serverSkippedBytes,
    retryCount: report.retryCount,
    averageMediaMBps: report.averageMediaMBps,
    peakMediaMBps: report.peakMediaMBps,
    queueMaxDepth: report.queueMaxDepth,
    uploadCapacityWaitDurationMs: report.uploadCapacityWaitDurationMs,
    uploadCapacityWaitCount: report.uploadCapacityWaitCount,
    maxUploadCapacityWaitDurationMs: report.maxUploadCapacityWaitDurationMs,
    maxActiveUploadWorkers: report.maxActiveUploadWorkers,
    filenameResolvedAppleFiles: report.filenameResolvedAppleFiles,
    filenameFallbackFiles: report.filenameFallbackFiles,
    peakNativeResidentMemoryBytes: report.peakNativeResidentMemoryBytes,
    preflight: {
      ...copyPreflightMetrics(report.preflight),
      windowCount: report.preflight.windowCount,
      totalWindowDurationMs: report.preflight.totalWindowDurationMs,
      maxWindowDurationMs: report.preflight.maxWindowDurationMs,
      windowsWithHashing: report.preflight.windowsWithHashing,
      windowsWithBlockedNonCandidates: report.preflight.windowsWithBlockedNonCandidates,
      windowsWithAllUploadWorkersIdle: report.preflight.windowsWithAllUploadWorkersIdle,
      allUploadWorkersIdleDuringPreflightMs:
        report.preflight.allUploadWorkersIdleDuringPreflightMs,
      maxPreparedBytesHeldDuringPreflight:
        report.preflight.maxPreparedBytesHeldDuringPreflight,
      maxTemporaryBytesHeldDuringPreflight:
        report.preflight.maxTemporaryBytesHeldDuringPreflight,
    },
    uploadTiming: copyUploadTiming(report.uploadTiming),
    materialization: report.materialization.map(summary => ({ ...summary })),
    windows: report.windows.map(window => ({
      windowIndex: window.windowIndex,
      status: window.status,
      selectedCount: window.selectedCount,
      preparedCount: window.preparedCount,
      failedCount: window.failedCount,
      discoveredBytes: window.discoveredBytes,
      selectedMediaBytes: window.selectedMediaBytes,
      additionalComponentsBytes: window.additionalComponentsBytes,
      selectedMediaFiles: window.selectedMediaFiles,
      additionalComponentsFiles: window.additionalComponentsFiles,
      plannedUploadBytes: window.plannedUploadBytes,
      preflightSkippedFiles: window.preflightSkippedFiles,
      preflightSkippedBytes: window.preflightSkippedBytes,
      appleFilenameCount: window.appleFilenameCount,
      fallbackFilenameCount: window.fallbackFilenameCount,
      startedElapsedMs: window.startedElapsedMs,
      ...(window.readyElapsedMs === undefined
        ? {}
        : { readyElapsedMs: window.readyElapsedMs }),
      ...(window.enqueueCompletedElapsedMs === undefined
        ? {}
        : { enqueueCompletedElapsedMs: window.enqueueCompletedElapsedMs }),
      uploadCapacityWaitDurationMs: window.uploadCapacityWaitDurationMs,
      uploadCapacityWaitCount: window.uploadCapacityWaitCount,
      preparationDurationMs: window.preparationDurationMs,
      filenameDurationMs: window.filenameDurationMs,
      preflightDurationMs: window.preflightDurationMs,
      ...(window.firstUploadStartedElapsedMs === undefined
        ? {}
        : { firstUploadStartedElapsedMs: window.firstUploadStartedElapsedMs }),
    })),
    preflightWindowSamples: selectPreflightWindowSamples(report.windows),
    failures: report.failures.map(failure => ({
      fileRef: failure.fileRef,
      stage: failure.stage,
      code: failure.code,
      retryCount: failure.retryCount,
    })),
    failureCounts: report.failureCounts.map(failure => ({
      stage: failure.stage,
      code: failure.code,
      count: failure.count,
    })),
    omittedFailureDetails: report.omittedFailureDetails,
    thermalTransitions: report.thermalTransitions.map(transition => ({
      state: transition.state,
      elapsedMs: transition.elapsedMs,
    })),
  };
}

async function pruneReports(): Promise<void> {
  if (!filesystemAvailable() || typeof FileSystem.readDirectoryAsync !== 'function') return;
  const now = Date.now();
  const directoryNames = await FileSystem.readDirectoryAsync(REPORT_DIRECTORY);
  const temporaryNames = directoryNames
    .filter(name => /^transfer-[a-z0-9-]+\.json\.tmp$/i.test(name));
  await Promise.all(temporaryNames.map(name =>
    FileSystem.deleteAsync(`${REPORT_DIRECTORY}/${name}`, { idempotent: true })));
  const names = directoryNames
    .filter(name => /^transfer-[a-z0-9-]+\.json$/i.test(name));
  const reports = await Promise.all(names.map(async name => {
    const path = `${REPORT_DIRECTORY}/${name}`;
    const info = await FileSystem.getInfoAsync(path);
    return {
      path,
      size: info.exists && !info.isDirectory ? info.size : 0,
      modifiedAt: info.exists && 'modificationTime' in info && typeof info.modificationTime === 'number'
        ? info.modificationTime * 1000
        : 0,
    };
  }));
  reports.sort((left, right) => right.modifiedAt - left.modifiedAt);
  let retainedBytes = 0;
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    const expired = report.modifiedAt > 0 && now - report.modifiedAt > MAX_AGE_MS;
    const overCount = index >= MAX_REPORTS;
    const overBytes = retainedBytes + report.size > MAX_TOTAL_BYTES;
    if (expired || overCount || overBytes) {
      await FileSystem.deleteAsync(report.path, { idempotent: true });
    } else {
      retainedBytes += report.size;
    }
  }
}

export async function persistDiagnosticReport(
  report: TransferDiagnosticReport,
): Promise<void> {
  if (!filesystemAvailable()) return;
  await ensureDirectory();
  const sanitizedReport = allowListedReport(report);
  const destination = reportPath(sanitizedReport.sessionRef);
  const temporary = `${destination}.tmp`;
  await FileSystem.deleteAsync(temporary, { idempotent: true });
  await FileSystem.writeAsStringAsync(temporary, JSON.stringify(sanitizedReport));
  await FileSystem.deleteAsync(destination, { idempotent: true });
  await FileSystem.moveAsync({ from: temporary, to: destination });
  await pruneReports();
}

export async function listDiagnosticReports(): Promise<DiagnosticReportSummary[]> {
  if (!filesystemAvailable() || typeof FileSystem.readDirectoryAsync !== 'function') return [];
  await ensureDirectory();
  await pruneReports();
  const names = (await FileSystem.readDirectoryAsync(REPORT_DIRECTORY))
    .filter(name => /^transfer-[a-z0-9-]+\.json$/i.test(name));
  const reports: (DiagnosticReportSummary & { modifiedAt: number })[] = [];
  for (const name of names) {
    const path = `${REPORT_DIRECTORY}/${name}`;
    const info = await FileSystem.getInfoAsync(path);
    const modifiedAt = info.exists && 'modificationTime' in info && typeof info.modificationTime === 'number'
      ? info.modificationTime
      : 0;
    try {
      const parsed = JSON.parse(
        await FileSystem.readAsStringAsync(path),
      ) as Partial<TransferDiagnosticReport>;
      if (
        typeof parsed.startedAt !== 'number' ||
        typeof parsed.selectedFiles !== 'number' ||
        (parsed.environment !== 'production' && parsed.environment !== 'test') ||
        (parsed.completionStatus !== 'running' &&
          parsed.completionStatus !== 'completed' &&
          parsed.completionStatus !== 'mixed' &&
          parsed.completionStatus !== 'cancelled' &&
          parsed.completionStatus !== 'fatal')
      ) {
        continue;
      }
      reports.push({
        path,
        schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0,
        startedAt: parsed.startedAt,
        ...(typeof parsed.completedAt === 'number'
          ? { completedAt: parsed.completedAt }
          : {}),
        completionStatus: parsed.completionStatus,
        selectedAssets: typeof parsed.selectedAssets === 'number'
          ? parsed.selectedAssets
          : parsed.selectedFiles,
        selectedFiles: parsed.selectedFiles,
        environment: parsed.environment,
        modifiedAt,
      });
    } catch {
      // A partial/corrupt report is not offered for export.
    }
  }
  reports.sort((left, right) =>
    right.startedAt - left.startedAt || right.modifiedAt - left.modifiedAt);
  return reports.slice(0, MAX_REPORTS).map(({ modifiedAt: _modifiedAt, ...report }) => report);
}

export async function latestDiagnosticReportPath(): Promise<string | null> {
  const reports = await listDiagnosticReports();
  return reports[0]?.path ?? null;
}

export async function exportDiagnosticReport(path: string): Promise<boolean> {
  const reports = await listDiagnosticReports();
  if (!reports.some(report => report.path === path)) return false;
  await Share.share({
    title: 'Local Media Transfer diagnostics',
    url: path,
  });
  return true;
}

export async function exportLatestDiagnosticReport(): Promise<boolean> {
  const path = await latestDiagnosticReportPath();
  if (!path) return false;
  return exportDiagnosticReport(path);
}

export async function exportAllDiagnosticReports(): Promise<boolean> {
  const reports = await listDiagnosticReports();
  if (reports.length === 0 || !filesystemAvailable()) return false;
  const reportBodies = await Promise.all(reports.map(async report =>
    JSON.parse(await FileSystem.readAsStringAsync(report.path)) as TransferDiagnosticReport));
  const exportRoot = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!exportRoot) return false;
  const exportPath = `${exportRoot}local-media-transfer-diagnostics.json`;
  await FileSystem.writeAsStringAsync(exportPath, JSON.stringify({
    schemaVersion: 1,
    exportedAt: Date.now(),
    reports: reportBodies,
  }));
  try {
    await Share.share({
      title: 'Local Media Transfer diagnostics',
      url: exportPath,
    });
  } finally {
    await FileSystem.deleteAsync(exportPath, { idempotent: true });
  }
  return true;
}

export class TransferDiagnostics {
  private report: TransferDiagnosticReport;
  private readonly windowIndexById = new Map<number, number>();
  private writeChain = Promise.resolve();
  private revision = 0;
  private persistedRevision = 0;
  private writeScheduled = false;
  private hasPersistedReport = false;

  constructor(
    sessionRef: string,
    selectedAssets: number,
    preparationMode: PreparationMode = 'prepare-first',
    requestedPreparationMode: PreparationMode = preparationMode,
    automaticPreparationReason?: 'large-native-selection',
    includeAdditionalMediaComponents = false,
  ) {
    const now = Date.now();
    this.report = {
      schemaVersion: 6,
      sessionRef,
      appVersion: IOS_APP_VERSION,
      environment: iosClientEnvironment(nativeCapabilities.available),
      transport: nativeCapabilities.available ? 'native-raw' : 'expo-base64',
      requestedPreparationMode,
      preparationMode,
      ...(automaticPreparationReason === undefined
        ? {}
        : { automaticPreparationReason }),
      includeAdditionalMediaComponents,
      startedAt: now,
      updatedAt: now,
      completionStatus: 'running',
      selectedAssets,
      preparedAssets: 0,
      expandedFiles: 0,
      selectedFiles: selectedAssets,
      preparedFiles: 0,
      uploadedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      discoveredBytes: 0,
      selectedMediaBytes: 0,
      additionalComponentsBytes: 0,
      selectedMediaFiles: 0,
      additionalComponentsFiles: 0,
      plannedUploadBytes: 0,
      acknowledgedBytes: 0,
      skippedBytes: 0,
      preflightSkippedFiles: 0,
      preflightSkippedBytes: 0,
      serverSkippedFiles: 0,
      serverSkippedBytes: 0,
      retryCount: 0,
      averageMediaMBps: 0,
      peakMediaMBps: 0,
      queueMaxDepth: 0,
      uploadCapacityWaitDurationMs: 0,
      uploadCapacityWaitCount: 0,
      maxUploadCapacityWaitDurationMs: 0,
      maxActiveUploadWorkers: 0,
      filenameResolvedAppleFiles: 0,
      filenameFallbackFiles: 0,
      peakNativeResidentMemoryBytes: 0,
      preflight: emptyPreflightSummary(),
      uploadTiming: emptyUploadTiming(),
      materialization: MATERIALIZATION_PATHS.map(emptyMaterializationSummary),
      windows: [],
      preflightWindowSamples: [],
      failures: [],
      failureCounts: [],
      omittedFailureDetails: 0,
      thermalTransitions: [],
    };
  }

  start(): Promise<void> {
    this.queueWrite();
    return this.writeChain;
  }

  get reportAvailable(): boolean {
    return this.hasPersistedReport;
  }

  elapsedMs(now = Date.now()): number {
    return Math.max(0, now - this.report.startedAt);
  }

  beginWindow(windowIndex: number, selectedCount: number): void {
    if (this.windowIndexById.has(windowIndex)) return;
    this.report.windows.push({
      windowIndex,
      status: 'preparing',
      selectedCount,
      preparedCount: 0,
      failedCount: 0,
      discoveredBytes: 0,
      selectedMediaBytes: 0,
      additionalComponentsBytes: 0,
      selectedMediaFiles: 0,
      additionalComponentsFiles: 0,
      plannedUploadBytes: 0,
      preflightSkippedFiles: 0,
      preflightSkippedBytes: 0,
      appleFilenameCount: 0,
      fallbackFilenameCount: 0,
      startedElapsedMs: this.elapsedMs(),
      preparationDurationMs: 0,
      filenameDurationMs: 0,
      preflightDurationMs: 0,
      uploadCapacityWaitDurationMs: 0,
      uploadCapacityWaitCount: 0,
      preflight: {
        ...emptyPreflightMetrics(),
        allUploadWorkersIdleDuringPreflightMs: 0,
        queueDepthAtStart: 0,
        queueDepthAtEnd: 0,
        activeUploadWorkersAtStart: 0,
        activeUploadWorkersAtEnd: 0,
      },
      uploadTiming: emptyUploadTiming(),
    });
    this.windowIndexById.set(windowIndex, this.report.windows.length - 1);
  }

  checkpointWindow(window: DiagnosticWindow): void {
    const existingIndex = this.windowIndexById.get(window.windowIndex);
    const existing = existingIndex === undefined
      ? undefined
      : this.report.windows[existingIndex];
    const completedPreflight = window.preflight ?? {
      ...emptyPreflightMetrics(),
      allUploadWorkersIdleDuringPreflightMs: 0,
      queueDepthAtStart: 0,
      queueDepthAtEnd: 0,
      activeUploadWorkersAtStart: 0,
      activeUploadWorkersAtEnd: 0,
    };
    const completedWindow: DiagnosticWindow = {
      ...window,
      status: 'ready',
      startedElapsedMs: existing?.startedElapsedMs ?? window.startedElapsedMs,
      readyElapsedMs: window.readyElapsedMs ?? this.elapsedMs(),
      preflight: completedPreflight,
      uploadTiming: window.uploadTiming ?? emptyUploadTiming(),
    };
    if (existingIndex !== undefined) {
      this.report.windows[existingIndex] = completedWindow;
    } else {
      this.report.windows.push(completedWindow);
      this.windowIndexById.set(window.windowIndex, this.report.windows.length - 1);
    }
    this.report.preparedFiles += completedWindow.preparedCount - (existing?.preparedCount ?? 0);
    this.report.preparedAssets += completedWindow.selectedCount - (existing?.selectedCount ?? 0);
    this.report.expandedFiles +=
      completedWindow.preparedCount + completedWindow.failedCount -
      ((existing?.preparedCount ?? 0) + (existing?.failedCount ?? 0));
    this.report.discoveredBytes += completedWindow.discoveredBytes - (existing?.discoveredBytes ?? 0);
    this.report.selectedMediaBytes +=
      completedWindow.selectedMediaBytes - (existing?.selectedMediaBytes ?? 0);
    this.report.additionalComponentsBytes +=
      completedWindow.additionalComponentsBytes - (existing?.additionalComponentsBytes ?? 0);
    this.report.selectedMediaFiles +=
      completedWindow.selectedMediaFiles - (existing?.selectedMediaFiles ?? 0);
    this.report.additionalComponentsFiles +=
      completedWindow.additionalComponentsFiles - (existing?.additionalComponentsFiles ?? 0);
    this.report.plannedUploadBytes +=
      completedWindow.plannedUploadBytes - (existing?.plannedUploadBytes ?? 0);
    this.report.preflightSkippedFiles +=
      completedWindow.preflightSkippedFiles - (existing?.preflightSkippedFiles ?? 0);
    this.report.preflightSkippedBytes +=
      completedWindow.preflightSkippedBytes - (existing?.preflightSkippedBytes ?? 0);
    this.report.filenameResolvedAppleFiles +=
      completedWindow.appleFilenameCount - (existing?.appleFilenameCount ?? 0);
    this.report.filenameFallbackFiles +=
      completedWindow.fallbackFilenameCount - (existing?.fallbackFilenameCount ?? 0);
    accumulatePreflightSummary(
      this.report.preflight,
      completedPreflight,
      completedWindow.preflightDurationMs,
      existing?.status === 'preparing' ? undefined : existing?.preflight,
      existing?.status === 'preparing' ? 0 : existing?.preflightDurationMs ?? 0,
    );
    // Persist exact in-memory counters in small checkpoints instead of writing
    // an ever-growing JSON report for every state change. A crash can omit at
    // most the current eight-window checkpoint; normal completion flushes all.
    if ((window.windowIndex + 1) % WINDOW_PERSIST_INTERVAL === 0) {
      this.queueWrite();
    }
  }

  markWindowEnqueued(windowIndex: number, queueMaxDepth: number): void {
    const index = this.windowIndexById.get(windowIndex);
    const window = index === undefined ? undefined : this.report.windows[index];
    if (window) {
      window.status = 'enqueued';
      window.enqueueCompletedElapsedMs = this.elapsedMs();
    }
    this.report.queueMaxDepth = Math.max(this.report.queueMaxDepth, queueMaxDepth);
  }

  recordUploadCapacityWait(windowIndex: number, durationMs: number): void {
    const boundedDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    if (boundedDuration <= 0) return;
    const index = this.windowIndexById.get(windowIndex);
    const window = index === undefined ? undefined : this.report.windows[index];
    if (window) {
      window.uploadCapacityWaitDurationMs += boundedDuration;
      window.uploadCapacityWaitCount += 1;
    }
    this.report.uploadCapacityWaitDurationMs += boundedDuration;
    this.report.uploadCapacityWaitCount += 1;
    this.report.maxUploadCapacityWaitDurationMs = Math.max(
      this.report.maxUploadCapacityWaitDurationMs,
      boundedDuration,
    );
  }

  recordWindowUploadStarted(windowIndex: number): void {
    const index = this.windowIndexById.get(windowIndex);
    const window = index === undefined ? undefined : this.report.windows[index];
    if (!window || window.firstUploadStartedElapsedMs !== undefined) return;
    window.firstUploadStartedElapsedMs = this.elapsedMs();
  }

  recordNativeUploadTiming(
    windowIndex: number,
    timing: Omit<DiagnosticUploadTiming, 'measuredFiles' | 'maxServerFinalizeDurationMs'>,
  ): void {
    addUploadTiming(this.report.uploadTiming, timing);
    const index = this.windowIndexById.get(windowIndex);
    const window = index === undefined ? undefined : this.report.windows[index];
    if (window) {
      window.uploadTiming ??= emptyUploadTiming();
      addUploadTiming(window.uploadTiming, timing);
    }
  }

  recordMaterialization(file: PreparedUploadFile): void {
    const path = file.materializationPath ?? 'expo-direct';
    const summary = this.report.materialization.find(item => item.path === path);
    if (!summary) return;
    const durationMs = Number.isFinite(file.materializationDurationMs)
      ? Math.max(0, file.materializationDurationMs ?? 0)
      : 0;
    const temporaryBytes = Number.isFinite(file.temporaryBytesWritten)
      ? Math.max(0, file.temporaryBytesWritten ?? 0)
      : 0;
    summary.preparedFiles += 1;
    summary.totalMaterializationDurationMs += durationMs;
    summary.maxMaterializationDurationMs = Math.max(
      summary.maxMaterializationDurationMs,
      durationMs,
    );
    if (temporaryBytes > 0) {
      summary.temporaryFiles += 1;
      summary.temporaryBytesWritten += temporaryBytes;
      summary.maxTemporaryFileBytes = Math.max(
        summary.maxTemporaryFileBytes,
        temporaryBytes,
      );
    }
  }

  recordTemporaryRelease(release: NativeReleaseMetrics): void {
    if (release.temporaryBytesWritten <= 0) return;
    const summary = this.report.materialization.find(
      item => item.path === release.materializationPath,
    );
    if (!summary) return;
    const lifetimeMs = Number.isFinite(release.temporaryLifetimeMs)
      ? Math.max(0, release.temporaryLifetimeMs)
      : 0;
    summary.releasedFiles += 1;
    summary.totalTemporaryLifetimeMs += lifetimeMs;
    summary.maxTemporaryLifetimeMs = Math.max(
      summary.maxTemporaryLifetimeMs,
      lifetimeMs,
    );
  }

  markPreparationComplete(queueMaxDepth: number): void {
    this.report.preparationCompletedElapsedMs = this.elapsedMs();
    this.report.queueMaxDepth = Math.max(this.report.queueMaxDepth, queueMaxDepth);
    this.queueWrite();
  }

  recordUploadWorkerStarted(activeWorkers: number): void {
    let changed = false;
    if (this.report.firstUploadStartedElapsedMs === undefined) {
      this.report.firstUploadStartedElapsedMs = this.elapsedMs();
      changed = true;
    }
    if (activeWorkers > this.report.maxActiveUploadWorkers) {
      this.report.maxActiveUploadWorkers = activeWorkers;
      changed = true;
    }
    if (changed) this.queueWrite();
  }

  recordFirstAcknowledgement(): void {
    if (this.report.firstAcknowledgementElapsedMs !== undefined) return;
    this.report.firstAcknowledgementElapsedMs = this.elapsedMs();
    this.queueWrite();
  }

  recordFailure(failure: DiagnosticFailure): void {
    const count = this.report.failureCounts.find(
      item => item.stage === failure.stage && item.code === failure.code,
    );
    if (count) {
      count.count += 1;
    } else {
      this.report.failureCounts.push({ stage: failure.stage, code: failure.code, count: 1 });
    }
    if (this.report.failures.length < MAX_FAILURE_DETAILS) {
      this.report.failures.push(failure);
    } else {
      this.report.omittedFailureDetails += 1;
    }
    this.report.failedFiles += 1;
  }

  recordThermal(state: ThermalState): void {
    const elapsedMs = Date.now() - this.report.startedAt;
    const last = this.report.thermalTransitions.at(-1);
    if (last?.state === state) return;
    this.report.thermalTransitions.push({ state, elapsedMs });
    this.queueWrite();
  }

  updateTransfer(values: {
    preparedAssets: number;
    expandedFiles: number;
    uploadedFiles: number;
    skippedFiles: number;
    failedFiles: number;
    selectedMediaBytes: number;
    additionalComponentsBytes: number;
    selectedMediaFiles: number;
    additionalComponentsFiles: number;
    plannedUploadBytes: number;
    acknowledgedBytes: number;
    skippedBytes: number;
    preflightSkippedFiles: number;
    preflightSkippedBytes: number;
    serverSkippedFiles: number;
    serverSkippedBytes: number;
    retryCount: number;
    averageMediaMBps: number;
    peakMediaMBps: number;
    queueMaxDepth: number;
    maxActiveUploadWorkers: number;
    filenameResolvedAppleFiles: number;
    filenameFallbackFiles: number;
    peakNativeResidentMemoryBytes: number;
  }): void {
    Object.assign(this.report, values);
    this.queueWrite();
  }

  finish(status: TransferDiagnosticReport['completionStatus']): Promise<void> {
    const elapsedMs = this.elapsedMs();
    this.report.completionStatus = status;
    this.report.completedAt = Date.now();
    this.report.sessionDurationMs = elapsedMs;
    if (this.report.firstUploadStartedElapsedMs !== undefined) {
      this.report.uploadPhaseDurationMs = Math.max(
        0,
        elapsedMs - this.report.firstUploadStartedElapsedMs,
      );
    }
    this.queueWrite();
    return this.writeChain;
  }

  private queueWrite(): void {
    this.report.updatedAt = Date.now();
    this.revision += 1;
    if (this.writeScheduled) return;
    this.writeScheduled = true;
    this.writeChain = this.writeChain
      .then(async () => {
        try {
          while (this.persistedRevision < this.revision) {
            const targetRevision = this.revision;
            const snapshot = JSON.parse(JSON.stringify(this.report)) as TransferDiagnosticReport;
            if (filesystemAvailable()) {
              await persistDiagnosticReport(snapshot);
              this.hasPersistedReport = true;
            }
            this.persistedRevision = targetRevision;
          }
        } finally {
          this.writeScheduled = false;
        }
      })
      .catch(() => {
        this.writeScheduled = false;
      });
  }
}
