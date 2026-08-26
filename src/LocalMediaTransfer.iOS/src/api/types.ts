export type PairingStatus = 'approved' | 'pending' | 'denied';

export type HealthResponse = {
  version?: string;
  environment?: 'production' | 'test' | 'benchmark';
};

export type PreflightFile = {
  id: string;
  name: string;
  size: number;
};

export type PreflightVerifyFile = PreflightFile & {
  sha256: string;
};

export type PreflightAction = 'upload' | 'skip' | 'hash_required';

export type PreflightFileResult = {
  id: string;
  action: PreflightAction;
  filename?: string;
  verification?: 'inconclusive';
};

export type PreflightResponse = {
  files: PreflightFileResult[];
};

export type TransferHistoryFile = {
  id: string;
  name: string;
  savedName?: string;
  size: number;
  outcome: 'uploaded' | 'skipped' | 'failed';
  matchedName?: string;
  duplicateStage?: 'preflight' | 'finalization' | 'outgoing-selection';
  avoidedBytes?: number;
  error?: string;
};

export type TransferHistoryPayload = {
  sessionId: string;
  completedAt: number;
  selectedAssets?: number;
  expandedFiles?: number;
  selectedFiles: number;
  uploadedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  selectedBytes: number;
  selectedMediaBytes: number;
  additionalComponentsBytes: number;
  selectedMediaFiles: number;
  additionalComponentsFiles: number;
  uploadedBytes: number;
  skippedBytes: number;
  avoidedBytes: number;
  finalizationDuplicateBytes: number;
  checkDurationMs: number;
  uploadDurationMs: number;
  totalDurationMs: number;
  averageSpeedMBps: number;
  peakSpeedMBps: number;
  retries: number;
  files: TransferHistoryFile[];
};

export type TransferHistoryItem = {
  sessionId?: string;
  completedAt?: number | string;
  uploadedFiles?: number;
  skippedFiles?: number;
  failedFiles?: number;
  averageSpeedMBps?: number;
  peakSpeedMBps?: number;
  selectedAssets?: number;
  expandedFiles?: number;
  selectedBytes?: number;
  selectedMediaBytes?: number;
  additionalComponentsBytes?: number;
  selectedMediaFiles?: number;
  additionalComponentsFiles?: number;
  uploadedBytes?: number;
  skippedBytes?: number;
  avoidedBytes?: number;
  finalizationDuplicateBytes?: number;
  files?: TransferHistoryFile[];
};

export type ClientLogLevel = 'INFO' | 'WARN' | 'ERROR';
