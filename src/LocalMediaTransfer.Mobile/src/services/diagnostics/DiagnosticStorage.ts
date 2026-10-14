import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { TransferDiagnosticReport, DiagnosticReportSummary } from './DiagnosticTypes';
import { copyPreflightMetrics, copyUploadTiming, selectPreflightWindowSamples } from './DiagnosticAggregation';

const REPORT_DIRECTORY = `${FileSystem.documentDirectory ?? ''}lmt-diagnostics`;
const MAX_REPORTS = 5;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export function filesystemAvailable(): boolean {
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

