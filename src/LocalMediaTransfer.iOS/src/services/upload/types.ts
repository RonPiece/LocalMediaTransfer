import { PreflightAction } from '@/api/types';
import { MediaAsset } from '../MediaScanner';
import type {
  MediaComponentSemantics,
  MediaMaterializationPath,
  MediaVariantRole,
} from './mediaVariants';
import { TransferErrorCode, TransferStage } from './errors';

export type FileStatus = 'pending' | 'uploading' | 'success' | 'error' | 'skipped';
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';
export type ThermalPolicy = 'monitor-only' | 'adaptive';
export type PreparationMode = 'prepare-first' | 'streaming';
export type TransferCompletionStatus = 'completed' | 'mixed' | 'cancelled' | 'fatal';
export type PreparationActivity = 'preparing' | 'checking' | 'waiting' | 'complete';
export type DuplicateCheckStage = 'finding-matches' | 'checking-contents' | 'verifying-windows';

export type PreparedUploadFile = {
  asset: MediaAsset;
  variantId: string;
  mediaRole: MediaVariantRole;
  componentSemantics: MediaComponentSemantics;
  originalFilename: string;
  fileRef: number;
  windowIndex: number;
  nativeUri: string;
  size: number;
  computedHash: string;
  transferFilename: string;
  filenameSource: 'apple-resource' | 'expo-fallback';
  temporary?: boolean;
  contentType?: string;
  materializationPath?: MediaMaterializationPath;
  materializationDurationMs?: number;
  temporaryBytesWritten?: number;
  preflightAction?: PreflightAction;
  duplicateMatchedFilename?: string;
  duplicateSource?: 'receiver-preflight' | 'outgoing-selection';
  preflightFailureCode?: TransferErrorCode;
};

export type PreparationFailure = {
  asset: MediaAsset;
  itemId: string;
  mediaRole?: MediaVariantRole;
  componentSemantics?: MediaComponentSemantics;
  originalFilename?: string;
  fileRef: number;
  windowIndex: number;
  stage: Extract<TransferStage, 'rendition' | 'metadata' | 'filename'>;
  code: TransferErrorCode;
};

export type PreparedWindow = {
  windowIndex: number;
  files: PreparedUploadFile[];
  failures: PreparationFailure[];
  preparationDurationMs: number;
  filenameResolutionDurationMs: number;
  filenameResolutionAppleCount: number;
  discoveredBytes: number;
  selectedMediaBytes: number;
  additionalComponentsBytes: number;
  selectedMediaFiles: number;
  additionalComponentsFiles: number;
};

export type PreparationResult = {
  fileInfos: PreparedUploadFile[];
  preparationDurationMs: number;
  filenameResolutionDurationMs: number;
  filenameResolutionBatchCount: number;
  filenameResolutionAppleCount: number;
  filenameResolutionFallbackCount: number;
  filenameResolutionMaxBatchSize: number;
  totalBytesToUpload: number;
  selectedMediaBytes: number;
  additionalComponentsBytes: number;
  selectedMediaFiles: number;
  additionalComponentsFiles: number;
};

export type DuplicatePreflightMetrics = {
  componentsConsidered: number;
  bypassedFiles: number;
  metadataUploadFiles: number;
  metadataFallbackFiles: number;
  receiverCandidateFiles: number;
  localCandidateFiles: number;
  hashCandidateFiles: number;
  hashedFiles: number;
  hashAttemptCount: number;
  hashCacheHits: number;
  hashFailureFiles: number;
  hashedBytes: number;
  hashedThenUploadedFiles: number;
  hashedThenUploadedBytes: number;
  receiverSkippedFiles: number;
  receiverSkippedBytes: number;
  outgoingSkippedFiles: number;
  outgoingSkippedBytes: number;
  metadataRequestCount: number;
  metadataFailureCount: number;
  verificationRequestCount: number;
  verificationFailureCount: number;
  verificationInconclusiveFiles: number;
  metadataDurationMs: number;
  hashingDurationMs: number;
  verificationDurationMs: number;
  candidateResolutionDurationMs: number;
  totalHashWorkerDurationMs: number;
  longestHashDurationMs: number;
  largestHashedFileBytes: number;
  nonCandidateFilesBlockedByHash: number;
  nonCandidateBytesBlockedByHash: number;
  preparedBytesHeldDuringPreflight: number;
  temporaryBytesHeldDuringPreflight: number;
};

export type PreflightResult = {
  preflightResults: Map<string, PreflightAction>;
  matchedFilenames: Map<string, string>;
  duplicateSources: Map<string, 'receiver-preflight' | 'outgoing-selection'>;
  computedHashes: Map<string, string>;
  hashFailureCodes: Map<string, TransferErrorCode>;
  preflightDurationMs: number;
  failureCount: number;
  candidateCount: number;
  checkedCount: number;
  metrics: DuplicatePreflightMetrics;
};

export interface TransferProgress {
  assetId: string;
  bytesSent: number;
  totalBytes: number;
  acknowledgedMediaBytes: number;
  plannedUploadMediaBytes: number;
  rateSampledAt: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'skipped';
}

export interface GlobalProgress {
  bytesSent: number;
  totalBytes: number;
  acknowledgedMediaBytes: number;
  plannedUploadMediaBytes: number;
  rateSampledAt: number;
  currentMediaMBps: number;
  averageMediaMBps: number;
  peakMediaMBps: number;
  currentEncodedMBps: number;
  currentIndex: number;
  currentAsset: MediaAsset;
  status?: 'preparing' | 'checking' | 'waiting' | 'uploading' | 'skipped' | 'failed';
  preparationActivity?: PreparationActivity;
  preparedFiles?: number;
  readyFiles?: number;
  preparationComplete?: boolean;
  discoveredBytes?: number;
  totalFiles?: number;
  checkedFiles?: number;
  duplicateCandidates?: number;
  duplicateCheckStage?: DuplicateCheckStage;
  batchIndex?: number;
  totalBatches?: number;
  thermalState?: ThermalState;
  thermalControl?: 'normal' | 'reduced' | 'paused';
  preparationMode?: PreparationMode;
}

export type UploadSummary = {
  sessionId: string;
  selectedAssets?: number;
  expandedFiles?: number;
  selectedFiles: number;
  uploadedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  selectedBytes: number;
  /** Prepared primary/current content corresponding to selected Photos assets. */
  selectedMediaBytes: number;
  /** Prepared optional PhotoKit resources enabled by the user. */
  additionalComponentsBytes: number;
  selectedMediaFiles: number;
  additionalComponentsFiles: number;
  byteTotalComplete?: boolean;
  uploadedBytes: number;
  skippedBytes: number;
  avoidedBytes: number;
  finalizationDuplicateBytes: number;
  uploadDurationMs: number;
  averageMediaMBps: number;
  peakMediaMBps: number;
  completionStatus: TransferCompletionStatus;
  diagnosticReportAvailable: boolean;
};

export type FileStatusUpdate = {
  assetId: string;
  itemId?: string;
  mediaRole?: MediaVariantRole;
  componentSemantics?: MediaComponentSemantics;
  fileRef?: number;
  status: FileStatus;
  transferFilename: string;
  savedFilename?: string;
  message?: string;
  stage?: TransferStage;
  errorCode?: TransferErrorCode;
};

export type UploadObserver = {
  onProgress: (progress: GlobalProgress) => void;
  onComplete: (summary: UploadSummary) => void;
  onError: (error: unknown, summary?: UploadSummary) => void;
  onFileStatusChange?: (update: FileStatusUpdate) => void;
  onThermalStateChange?: (state: ThermalState) => void;
};

export type UploadOptions = {
  preparationMode: PreparationMode;
  thermalPolicy?: ThermalPolicy;
  skipExactDuplicates?: boolean;
  includeAdditionalMediaComponents?: boolean;
};
