import { iosClientEnvironment } from '@/config/runtimeEnvironment';
import { IOS_APP_VERSION } from '@/version';
import { nativeCapabilities, NativeReleaseMetrics } from '../NativeCapabilities';
import { PreparationMode, PreparedUploadFile, ThermalState } from '../upload/types';
import {
  DiagnosticFailure,
  DiagnosticWindow,
  DiagnosticUploadTiming,
  TransferDiagnosticReport,
} from './DiagnosticTypes';
import {
  MATERIALIZATION_PATHS,
  emptyMaterializationSummary,
  emptyPreflightMetrics,
  emptyPreflightSummary,
  emptyUploadTiming,
  accumulatePreflightSummary,
  addUploadTiming,
} from './DiagnosticAggregation';
import { persistDiagnosticReport, filesystemAvailable } from './DiagnosticStorage';

const MAX_FAILURE_DETAILS = 1_000;
const WINDOW_PERSIST_INTERVAL = 8;

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
