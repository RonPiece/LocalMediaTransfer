import type { TransferHistoryItem } from '@/api/types';
import type { SelectedMedia } from '@/services/media/SelectedMedia';
import type { TransferPresentation } from '@/features/transfer/TransferProgressScreen';
import type { FileState } from '@/features/transfer/transferPresentation';
import type { UploadSummary } from '@/services/upload/types';
import { clampProgress } from './scenarios';
import thumbnails from './thumbnails.json';
import type { ActiveConnection } from '@/features/connection/connectionPresentation';
import type { SavedConnection } from '@/app/types';
import type { DiscoveredServer } from '@/services/NativeCapabilities';

export const sampleActiveConnection: ActiveConnection = {
  address: 'https://sample-receiver.invalid:18443', name: 'Studio Desktop',
  security: { mode: 'https', certificateVerified: true, tlsVersion: 'TLS 1.3' },
  healthStatus: 'connected', trusted: true,
};
export const sampleSavedReceiver: SavedConnection = { version: 3, environment: 'test',
  serverId: 'sample-receiver', httpsUrl: sampleActiveConnection.address, certificateFingerprint: '', name: sampleActiveConnection.name };
export const sampleDiscoveredServers: DiscoveredServer[] = [
  { name: sampleActiveConnection.name, serverId: 'sample-receiver', environment: 'test', certificateFingerprint: '',
    address: 'sample-receiver.invalid', httpsPort: 18443, approvalRequired: true },
  { name: 'Editing Laptop', serverId: 'sample-other', environment: 'test', certificateFingerprint: '',
    address: 'other-receiver.invalid', httpsPort: 18443, approvalRequired: true },
];

// Generated, embedded illustrations: no Photos identifiers, disk files, or network requests.
export function sampleThumbnail(index: number): string {
  return thumbnails[index % thumbnails.length];
}

export const sampleMedia: SelectedMedia[] = Array.from({ length: 320 }, (_, index) => ({
  id: `preview-item-${index + 1}`, uri: sampleThumbnail(index),
  type: index % 7 === 0 ? 'video' : 'photo',
  filename: `Sample_${String(index + 1).padStart(3, '0')}.${index % 7 === 0 ? 'MOV' : 'HEIC'}`,
  modificationTime: 1_791_000_000_000, duration: index % 7 === 0 ? 83 + index : undefined,
  width: 240, height: 240,
}));

const MB = 1_000_000;
export const sampleProblemThumbnails = new Map(sampleMedia.map(asset => [asset.id, { uri: asset.uri, mediaType: asset.type }]));
const FILE_BYTES = 4 * MB;
const TOTAL = 320;

export function transferFixture(id: string, progress: number): Pick<TransferPresentation,
  'currentProgress' | 'currentMediaMBps' | 'averageMediaMBps' | 'peakMediaMBps' | 'etaText' |
  'elapsedSeconds' | 'completionSummary' | 'isFinished' | 'phase' | 'hasUploadStarted' |
  'queueCatchUpVisible' | 'preparedFiles' | 'readyFiles' | 'preparationComplete' |
  'activePreparationMode' | 'automaticallyStreamsLargeSelection' | 'totalTransferFiles' |
  'duplicateCheck' | 'summary' | 'recentFiles' | 'resultList' | 'thermalState'> {
  const p = clampProgress(progress) / 100;
  const terminal = ['completed', 'mixed', 'duplicates', 'fatal', 'cancelled', 'results', 'errors'].some(suffix => id === `transfer-${suffix}`);
  const mixed = ['transfer-mixed', 'transfer-results', 'transfer-errors'].includes(id);
  const failed = id === 'transfer-fatal';
  const cancelled = id === 'transfer-cancelled';
  const allDuplicates = id === 'transfer-duplicates';
  const preparing = id === 'transfer-preparing';
  const checking = id === 'transfer-checking';
  const streaming = id === 'transfer-streaming' || id === 'transfer-catching-up';
  const started = !preparing && !checking;
  const finishedCount = terminal ? (cancelled ? 128 : TOTAL) : started ? Math.floor(TOTAL * p * (streaming ? 0.65 : 1)) : 0;
  const skipped = allDuplicates ? TOTAL : failed ? 0 : Math.floor(finishedCount * 0.15);
  const errors = failed ? TOTAL : mixed ? 12 : 0;
  const success = finishedCount - skipped - errors;
  const uploadedBytes = success * FILE_BYTES;
  const results: FileState[] = sampleMedia.slice(0, finishedCount).map((asset, index) => ({
    id: asset.id, filename: asset.filename, mediaType: asset.type, thumbnailUri: asset.uri, sizeBytes: FILE_BYTES,
    status: index < errors ? 'error' : index < errors + skipped ? 'skipped' : 'success',
    msg: index < errors ? 'The receiver connection was interrupted.' : index < errors + skipped ? 'Exact duplicate verified by Windows.' : undefined,
  }));
  const completionSummary: UploadSummary | null = terminal ? {
    sessionId: 'preview-session', selectedAssets: TOTAL, expandedFiles: TOTAL, selectedFiles: TOTAL,
    uploadedFiles: success, skippedFiles: skipped, failedFiles: errors,
    selectedBytes: TOTAL * FILE_BYTES, selectedMediaBytes: TOTAL * FILE_BYTES,
    additionalComponentsBytes: 0, selectedMediaFiles: TOTAL, additionalComponentsFiles: 0,
    uploadedBytes, skippedBytes: skipped * FILE_BYTES, avoidedBytes: skipped * FILE_BYTES,
    finalizationDuplicateBytes: 0, preparationDurationMs: 12_000, uploadDurationMs: 48_000,
    averageMediaMBps: uploadedBytes / 48 / MB, peakMediaMBps: success > 0 ? 32.8 : 0,
    completionStatus: failed ? 'fatal' : cancelled ? 'cancelled' : mixed ? 'mixed' : 'completed',
    byteTotalComplete: !failed && !cancelled, diagnosticReportAvailable: false,
  } : null;
  return {
    currentProgress: { assetId: sampleMedia[0].id, bytesSent: uploadedBytes, totalBytes: TOTAL * FILE_BYTES,
      acknowledgedMediaBytes: uploadedBytes, plannedUploadMediaBytes: (TOTAL - skipped) * FILE_BYTES,
      rateSampledAt: 0, status: terminal ? 'completed' : started ? 'uploading' : 'pending' },
    currentMediaMBps: started && !terminal && !allDuplicates ? 24.6 : 0,
    averageMediaMBps: completionSummary?.averageMediaMBps ?? (started ? 22.1 : 0),
    peakMediaMBps: completionSummary?.peakMediaMBps ?? (started ? 32.8 : 0),
    etaText: `${Math.max(1, Math.round((1 - p) * 48))}s`, elapsedSeconds: terminal ? 60 : Math.round(60 * p),
    completionSummary, isFinished: terminal,
    phase: preparing ? 'preparing' : checking ? 'checking' : id === 'transfer-catching-up' ? 'waiting' : 'uploading',
    hasUploadStarted: started && !allDuplicates && !failed,
    queueCatchUpVisible: id === 'transfer-catching-up',
    preparedFiles: terminal || id === 'transfer-uploading' ? TOTAL : Math.floor(TOTAL * p),
    readyFiles: terminal ? TOTAL : Math.floor(TOTAL * p), preparationComplete: terminal || id === 'transfer-uploading',
    activePreparationMode: streaming ? 'streaming' : 'prepare-first', automaticallyStreamsLargeSelection: streaming,
    totalTransferFiles: TOTAL, duplicateCheck: { stage: 'checking-contents', checked: Math.round(120 * p), total: 120 },
    summary: { success, skipped, failed: errors }, recentFiles: results.slice(-12).reverse(), resultList: results,
    thermalState: 'nominal',
  };
}

export const sampleHistory: TransferHistoryItem[] = ['completed', 'mixed', 'duplicates', 'cancelled'].map((state, index) => {
  const fixture = transferFixture(`transfer-${state}`, 100);
  const summary = fixture.completionSummary!;
  return {
    // Deliberately omit sessionId: these sample rows must never load persisted file previews.
    completedAt: 1_791_000_000_000 - index * 3_600_000,
    ...summary, sessionId: undefined,
    checkDurationMs: 12_000, totalDurationMs: 60_000, averageSpeedMBps: summary.averageMediaMBps,
    peakSpeedMBps: summary.peakMediaMBps, files: fixture.resultList.map(file => ({
      id: file.id, name: file.filename, size: file.sizeBytes ?? 0,
      outcome: file.status === 'error' ? 'failed' : file.status === 'skipped' ? 'skipped' : 'uploaded',
      avoidedBytes: file.status === 'skipped' ? FILE_BYTES : 0, error: file.msg,
    })),
  };
});
