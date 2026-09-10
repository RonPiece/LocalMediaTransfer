import { DuplicatePreflightMetrics, PreparationMode, ThermalState } from '../upload/types';
import { MediaMaterializationPath } from '../upload/mediaVariants';
import { TransferErrorCode, TransferStage } from '../upload/errors';

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

