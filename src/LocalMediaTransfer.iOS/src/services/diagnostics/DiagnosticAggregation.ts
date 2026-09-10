import { DuplicatePreflightMetrics } from '../upload/types';
import { MediaMaterializationPath } from '../upload/mediaVariants';
import {
  DiagnosticWindow,
  DiagnosticWindowPreflight,
  DiagnosticPreflightSummary,
  DiagnosticUploadTiming,
  DiagnosticPreflightWindowSample,
  DiagnosticMaterializationSummary,
} from './DiagnosticTypes';

const MAX_PREFLIGHT_WINDOW_SAMPLES = 64;

export const MATERIALIZATION_PATHS: MediaMaterializationPath[] = [
  'photo-resource',
  'video-resource',
  'raw-resource',
  'live-photo-motion',
  'current-image',
  'current-video',
  'expo-direct',
];

export function emptyMaterializationSummary(
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

export function emptyPreflightMetrics(): DuplicatePreflightMetrics {
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

export function emptyPreflightSummary(): DiagnosticPreflightSummary {
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

export function emptyUploadTiming(): DiagnosticUploadTiming {
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

export function copyPreflightMetrics(
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

export function copyUploadTiming(timing: DiagnosticUploadTiming): DiagnosticUploadTiming {
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

export function copyWindowPreflight(
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

export function selectPreflightWindowSamples(
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

export function accumulatePreflightSummary(
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

export function addUploadTiming(
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

