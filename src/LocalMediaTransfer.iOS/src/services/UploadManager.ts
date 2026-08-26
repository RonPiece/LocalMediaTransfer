import * as FileSystem from 'expo-file-system/legacy';

import { api, ApiRequestError } from '@/api/ApiClient';
import { TransferHistoryFile } from '@/api/types';
import { MediaAsset } from './MediaScanner';
import { nativeCapabilities } from './NativeCapabilities';
import { TransferDiagnostics } from './diagnostics/DiagnosticStore';
import { BoundedAsyncQueue } from './upload/BoundedAsyncQueue';
import {
  OutgoingHashRegistry,
  runDuplicatePreflightWindow,
} from './upload/duplicatePreflight';
import {
  TransferFailure,
  transferErrorMessage,
  transferFailure,
} from './upload/errors';
import { prepareAssetWindow } from './upload/prepareAssets';
import { resolvePreparationPolicy } from './upload/preparationPolicy';
import { mediaComponentFailureMessage } from './upload/mediaVariants';
import { ThermalController } from './upload/ThermalController';
import { ThroughputTracker } from './upload/ThroughputTracker';
import { ClientMetricsReporter } from './upload/ClientMetricsReporter';
import { runTransferPipeline } from './upload/transferPipeline';
import {
  GlobalProgress,
  PreparationActivity,
  PreparedUploadFile,
  ThermalState,
  UploadOptions,
  UploadObserver,
  UploadSummary,
} from './upload/types';

export type { TransferProgress } from './upload/types';

const MAX_HISTORY_PROBLEM_DETAILS = 1_000;

export class UploadManager {
  private readonly CHUNK_SIZE = 4 * 1024 * 1024;
  private readonly CONCURRENCY = 2;
  private readonly MAX_CHUNK_RETRIES = 2;
  private readonly CHUNK_TIMEOUT_MS = 60_000;
  private isCancelled = false;
  private activeRequests = new Set<AbortController>();
  private isRunning = false;
  private activeQueue: BoundedAsyncQueue<PreparedUploadFile> | null = null;
  private thermalController: ThermalController | null = null;
  private activeSessionId: string | null = null;
  private activeSessionRef: string | null = null;

  public cancel(): void {
    this.isCancelled = true;
    const sessionId = this.activeSessionId;
    if (sessionId) {
      void api.cancelUploadSession(sessionId).catch(() => undefined);
    }
    for (const controller of this.activeRequests) controller.abort();
    this.activeRequests.clear();
    this.activeQueue?.close();
    this.thermalController?.cancel();
    if (this.activeSessionRef) {
      nativeCapabilities.cancel(this.activeSessionRef);
    }
  }

  private async uploadEncodedChunk(
    url: string,
    headers: Record<string, string>,
    bodyPayload: string,
    retries: number,
  ): Promise<string> {
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (this.isCancelled) throw new TransferFailure('upload', 'cancelled');
        this.activeRequests.add(controller);
        timeout = setTimeout(() => controller.abort(), this.CHUNK_TIMEOUT_MS);
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: bodyPayload,
          signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok) {
          if (response.status === 401) {
            api.notifyUnauthorized();
            throw new ApiRequestError(
              'Desktop server session changed. Scan the current QR code to reconnect.',
              401,
            );
          }
          if (response.status >= 500) throw new Error('Temporary desktop response failure');
          throw new TransferFailure('server', 'server-rejected');
        }
        return responseText;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) throw error;
        if (attempt >= retries || this.isCancelled || error instanceof TransferFailure) {
          if (controller.signal.aborted && !this.isCancelled) {
            throw new TransferFailure('network', 'request-timeout');
          }
          throw error;
        }
        attempt += 1;
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      } finally {
        if (timeout) clearTimeout(timeout);
        this.activeRequests.delete(controller);
      }
    }
  }

  public async uploadFilesConcurrent(
    assets: MediaAsset[],
    observer: UploadObserver,
    options: UploadOptions = {
      preparationMode: 'prepare-first',
      thermalPolicy: 'monitor-only',
      skipExactDuplicates: true,
      includeAdditionalMediaComponents: false,
    },
  ): Promise<void> {
    const {
      onProgress,
      onComplete,
      onError,
      onFileStatusChange,
      onThermalStateChange,
    } = observer;
    if (this.isRunning) {
      onError(new Error('A transfer is already running.'));
      return;
    }

    this.isRunning = true;
    this.isCancelled = false;
    this.activeRequests.clear();
    const sessionId = `ios-${Date.now()}`;
    this.activeSessionId = sessionId;
    const sessionRef = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.activeSessionRef = sessionRef;
    const preparationPolicy = resolvePreparationPolicy({
      requestedMode: options.preparationMode,
      nativeAvailable: nativeCapabilities.available,
    });
    const diagnostics = new TransferDiagnostics(
      sessionRef,
      assets.length,
      preparationPolicy.effectiveMode,
      preparationPolicy.requestedMode,
      undefined,
      options.includeAdditionalMediaComponents === true,
    );
    const metricsReporter = new ClientMetricsReporter(
      sessionId,
      (id, bytesPerSecond) => api.reportClientSpeed(id, bytesPerSecond),
    );
    const queue = new BoundedAsyncQueue<PreparedUploadFile>(preparationPolicy.queueCapacity);
    const thermal = new ThermalController(options.thermalPolicy ?? 'monitor-only');
    this.activeQueue = queue;
    this.thermalController = thermal;

    let thermalState: ThermalState = 'nominal';
    const updateThermalState = (state: ThermalState) => {
      thermalState = state;
      thermal.update(state);
      diagnostics.recordThermal(state);
      onThermalStateChange?.(state);
    };
    const thermalListener = nativeCapabilities.addThermalStateListener?.(updateThermalState) ?? {
      remove() {},
    };

    let preparedFiles = 0;
    let readyFiles = 0;
    let preparationComplete = false;
    let preparationActivity: PreparationActivity = 'preparing';
    let discoveredBytes = 0;
    let selectedMediaBytes = 0;
    let additionalComponentsBytes = 0;
    let selectedMediaFiles = 0;
    let additionalComponentsFiles = 0;
    let plannedUploadMediaBytes = 0;
    let diagnosticPlannedUploadBytes = 0;
    let acknowledgedMediaBytes = 0;
    let globalBytesSent = 0;
    let filesCompleted = 0;
    let uploadedFiles = 0;
    let skippedFiles = 0;
    let failedFiles = 0;
    let preparationFailedFiles = 0;
    let successfulUploadedBytes = 0;
    let skippedBytes = 0;
    let avoidedBytes = 0;
    let finalizationDuplicateBytes = 0;
    let nativeRetryCount = 0;
    let peakNativeResidentMemoryBytes = 0;
    let preparationDurationMs = 0;
    let filenameResolutionDurationMs = 0;
    let preflightDurationMs = 0;
    let filenameResolutionAppleCount = 0;
    let filenameResolutionFallbackCount = 0;
    let preflightFailureCount = 0;
    let preflightSkippedFiles = 0;
    let preflightSkippedBytes = 0;
    let serverSkippedFiles = 0;
    let serverSkippedBytes = 0;
    let nextUploadFileSequence = 0;
    let activeUploadWorkers = 0;
    let maxActiveUploadWorkers = 0;
    let uploadWorkersStarted = false;
    let allUploadWorkersIdleSince: number | null = null;
    let completedAllUploadWorkersIdleMs = 0;
    let fatalError: Error | null = null;
    const historyFiles: TransferHistoryFile[] = [];
    const recordHistoryProblem = (file: TransferHistoryFile) => {
      if (historyFiles.length < MAX_HISTORY_PROBLEM_DETAILS) {
        historyFiles.push(file);
      }
    };
    const outgoingHashes: OutgoingHashRegistry = new Map();
    const terminalItemIds = new Set<string>();
    const preparedOutcomeAssetIds = new Set<string>();
    const startTime = Date.now();
    const throughput = new ThroughputTracker(startTime);
    let currentMediaMBps = 0;
    let averageMediaMBps = 0;
    let peakMediaMBps = 0;
    let currentEncodedMBps = 0;
    let lastRateSampledAt = 0;

    const currentAllUploadWorkersIdleMs = (now = Date.now()) =>
      completedAllUploadWorkersIdleMs + (
        uploadWorkersStarted && activeUploadWorkers === 0 && allUploadWorkersIdleSince !== null
          ? Math.max(0, now - allUploadWorkersIdleSince)
          : 0
      );
    const markUploadWorkerBusy = () => {
      const now = Date.now();
      if (activeUploadWorkers === 0 && allUploadWorkersIdleSince !== null) {
        completedAllUploadWorkersIdleMs += Math.max(0, now - allUploadWorkersIdleSince);
        allUploadWorkersIdleSince = null;
      }
      activeUploadWorkers += 1;
      maxActiveUploadWorkers = Math.max(maxActiveUploadWorkers, activeUploadWorkers);
      diagnostics.recordUploadWorkerStarted(activeUploadWorkers);
    };
    const markUploadWorkerIdle = () => {
      activeUploadWorkers = Math.max(0, activeUploadWorkers - 1);
      if (uploadWorkersStarted && activeUploadWorkers === 0) {
        allUploadWorkersIdleSince = Date.now();
      }
    };

    const releasePreparedFile = async (uri: string) => {
      try {
        const release = await nativeCapabilities.releasePreparedFile(sessionRef, uri);
        if (release) diagnostics.recordTemporaryRelease(release);
      } catch {
        // Session teardown retries cleanup for app-owned temporary files and
        // forgets non-temporary registrations.
      }
    };

    const progressFor = (
      item: PreparedUploadFile,
      status: GlobalProgress['status'],
    ): GlobalProgress => ({
      bytesSent: globalBytesSent,
      totalBytes: preparationComplete ? plannedUploadMediaBytes : 0,
      acknowledgedMediaBytes,
      plannedUploadMediaBytes,
      rateSampledAt: lastRateSampledAt,
      currentMediaMBps,
      averageMediaMBps,
      peakMediaMBps,
      currentEncodedMBps,
      currentIndex: filesCompleted,
      currentAsset: item.asset.filename === item.transferFilename
        ? item.asset
        : { ...item.asset, filename: item.transferFilename },
      status,
      preparationActivity,
      preparedFiles,
      readyFiles,
      totalFiles: preparationComplete
        ? readyFiles + preparationFailedFiles
        : assets.length,
      preparationComplete,
      discoveredBytes,
      batchIndex: item.windowIndex + 1,
      totalBatches: Math.max(1, Math.ceil(assets.length / preparationPolicy.windowSize)),
      thermalState,
      thermalControl: thermal.controlMode,
      preparationMode: preparationPolicy.effectiveMode,
    });

    const diagnosticTransferValues = (reportedFailedFiles: number) => ({
      preparedAssets: preparedFiles,
      expandedFiles: readyFiles + preparationFailedFiles,
      uploadedFiles,
      skippedFiles,
      failedFiles: reportedFailedFiles,
      selectedMediaBytes,
      additionalComponentsBytes,
      selectedMediaFiles,
      additionalComponentsFiles,
      plannedUploadBytes: diagnosticPlannedUploadBytes,
      acknowledgedBytes: acknowledgedMediaBytes,
      skippedBytes,
      preflightSkippedFiles,
      preflightSkippedBytes,
      serverSkippedFiles,
      serverSkippedBytes,
      retryCount: nativeRetryCount,
      averageMediaMBps,
      peakMediaMBps,
      queueMaxDepth: queue.maxDepth,
      maxActiveUploadWorkers,
      filenameResolvedAppleFiles: filenameResolutionAppleCount,
      filenameFallbackFiles: filenameResolutionFallbackCount,
      peakNativeResidentMemoryBytes,
    });

    const markPreparationFailure = (
      asset: MediaAsset,
      itemId: string,
      fileRef: number,
      mediaRole: PreparedUploadFile['mediaRole'] | undefined,
      componentSemantics: PreparedUploadFile['componentSemantics'] | undefined,
      originalFilename: string | undefined,
      stage: 'rendition' | 'metadata' | 'filename',
      code: Parameters<typeof diagnostics.recordFailure>[0]['code'],
    ) => {
      if (terminalItemIds.has(itemId)) return;
      terminalItemIds.add(itemId);
      preparedOutcomeAssetIds.add(asset.id);
      filesCompleted += 1;
      failedFiles += 1;
      preparationFailedFiles += 1;
      recordHistoryProblem({
        id: itemId,
        name: originalFilename || asset.filename,
        size: 0,
        outcome: 'failed',
        error: code,
      });
      diagnostics.recordFailure({ fileRef, stage, code, retryCount: 0 });
      onFileStatusChange?.({
        assetId: asset.id,
        itemId,
        mediaRole,
        componentSemantics,
        fileRef,
        status: 'error',
        transferFilename: originalFilename || asset.filename,
        stage,
        errorCode: code,
        message: mediaComponentFailureMessage(
          mediaRole ?? 'unknown',
          componentSemantics ?? 'primary',
          transferErrorMessage(code),
        ),
      });
    };

    try {
      await nativeCapabilities.beginTransfer(sessionRef);
      updateThermalState(
        nativeCapabilities.getThermalState
          ? await nativeCapabilities.getThermalState()
          : 'nominal',
      );
      await diagnostics.start();
      if (!(await api.pingServer())) {
        throw new TransferFailure('network', 'unauthorized', true);
      }
      const duplicatePolicy = {
        shouldSkipDuplicates: options.skipExactDuplicates !== false,
      };

      await api.logClientEvent('INFO', 'transfer_started', 'iPhone transfer started', {
        sessionId,
        selectedFiles: assets.length,
        transport: nativeCapabilities.available ? 'native-raw' : 'expo-base64',
        preparationMode: preparationPolicy.effectiveMode,
        includeAdditionalMediaComponents:
          options.includeAdditionalMediaComponents === true,
      });

      const preparedWindows: {
        windowIndex: number;
        files: PreparedUploadFile[];
      }[] = [];
      const producer = async (enqueueImmediately: boolean): Promise<boolean> => {
        try {
          for (
            let startIndex = 0, windowIndex = 0;
            startIndex < assets.length;
            startIndex += preparationPolicy.windowSize, windowIndex += 1
          ) {
            if (this.isCancelled || !(await thermal.waitForPreparation())) {
              return false;
            }
            const windowAssets = assets.slice(startIndex, startIndex + preparationPolicy.windowSize);
            diagnostics.beginWindow(windowIndex, windowAssets.length);
            const window = await prepareAssetWindow({
              assets: windowAssets,
              sessionRef,
              startIndex,
              windowIndex,
              totalSelectedFiles: assets.length,
              alreadyPreparedFiles: preparedFiles,
              alreadyReadyFiles: readyFiles,
              alreadyDiscoveredBytes: discoveredBytes,
              includeAdditionalMediaComponents:
                options.includeAdditionalMediaComponents === true,
              isCancelled: () => this.isCancelled,
              onGlobalProgress: progress => {
                preparationActivity = 'preparing';
                const reportedPreparedFiles = Math.max(
                  preparedFiles,
                  progress.preparedFiles ?? preparedFiles,
                );
                onProgress({
                  ...progress,
                  bytesSent: globalBytesSent,
                  totalBytes: preparationComplete ? plannedUploadMediaBytes : 0,
                  acknowledgedMediaBytes,
                  plannedUploadMediaBytes,
                  rateSampledAt: lastRateSampledAt,
                  currentMediaMBps,
                  averageMediaMBps,
                  peakMediaMBps,
                  currentEncodedMBps,
                  preparedFiles: reportedPreparedFiles,
                  readyFiles,
                  thermalState,
                  thermalControl: thermal.controlMode,
                  preparationMode: preparationPolicy.effectiveMode,
                  preparationActivity,
                });
              },
            });
            if (!window) return false;

            preparedFiles += windowAssets.length;
            readyFiles += window.files.length;
            discoveredBytes += window.discoveredBytes;
            selectedMediaBytes += window.selectedMediaBytes;
            additionalComponentsBytes += window.additionalComponentsBytes;
            selectedMediaFiles += window.selectedMediaFiles;
            additionalComponentsFiles += window.additionalComponentsFiles;
            preparationDurationMs += window.preparationDurationMs;
            filenameResolutionDurationMs += window.filenameResolutionDurationMs;
            filenameResolutionAppleCount += window.filenameResolutionAppleCount;
            const windowFilenameFallbackCount = Math.max(
              0,
              window.files.length - window.filenameResolutionAppleCount,
            );
            filenameResolutionFallbackCount += windowFilenameFallbackCount;
            for (const file of window.files) {
              diagnostics.recordMaterialization(file);
            }
            for (const failure of window.failures) {
              markPreparationFailure(
                failure.asset,
                failure.itemId,
                failure.fileRef,
                failure.mediaRole,
                failure.componentSemantics,
                failure.originalFilename,
                failure.stage,
                failure.code,
              );
            }

            const preflightIdleBefore = currentAllUploadWorkersIdleMs();
            const preflightQueueDepthAtStart = queue.depth;
            const preflightActiveWorkersAtStart = activeUploadWorkers;
            preparationActivity = duplicatePolicy.shouldSkipDuplicates ? 'checking' : 'preparing';
            const firstPreparedFile = window.files[0];
            if (firstPreparedFile && duplicatePolicy.shouldSkipDuplicates) {
              onProgress(progressFor(firstPreparedFile, 'checking'));
            }
            const preflight = await runDuplicatePreflightWindow({
              sessionRef,
              fileInfos: window.files,
              shouldSkipDuplicates: duplicatePolicy.shouldSkipDuplicates,
              outgoingHashes,
              onCheckingProgress: duplicateProgress => {
                const current = window.files[Math.min(
                  duplicateProgress.completed,
                  Math.max(0, window.files.length - 1),
                )]
                  ?? window.files[0];
                if (!current) return;
                onProgress({
                  ...progressFor(current, 'checking'),
                  checkedFiles: duplicateProgress.completed,
                  duplicateCandidates: duplicateProgress.total,
                  duplicateCheckStage: duplicateProgress.stage,
                });
              },
            });
            preparationActivity = 'preparing';
            preflightDurationMs += preflight.preflightDurationMs;
            preflightFailureCount += preflight.failureCount;
            const preflightIdleAfter = currentAllUploadWorkersIdleMs();
            let windowPlannedUploadBytes = 0;
            let windowPreflightSkippedFiles = 0;
            let windowPreflightSkippedBytes = 0;
            for (const file of window.files) {
              preparedOutcomeAssetIds.add(file.asset.id);
              // Windows cancellation and startup cleanup identify partial iOS
              // uploads by the `ios-<timestamp>-` prefix. Keep the opaque
              // PhotoKit variant ID in preflight/history, but use a stable,
              // session-scoped numeric ID for the chunk protocol.
              file.computedHash = `${sessionId}-${++nextUploadFileSequence}`;
              file.preflightAction = preflight.preflightResults.get(file.variantId) ?? 'upload';
              file.duplicateMatchedFilename = preflight.matchedFilenames.get(file.variantId);
              file.duplicateSource = preflight.duplicateSources.get(file.variantId);
              file.preflightFailureCode = preflight.hashFailureCodes.get(file.variantId);
              if (file.preflightAction === 'skip') {
                windowPreflightSkippedFiles += 1;
                windowPreflightSkippedBytes += file.size;
                // Preflight is terminal for this component. Release its native
                // export before queue backpressure or unrelated uploads can
                // retain it; the worker's later release remains idempotent.
                await releasePreparedFile(file.nativeUri);
              } else if (file.preflightFailureCode) {
                await releasePreparedFile(file.nativeUri);
              } else if (!file.preflightFailureCode) {
                windowPlannedUploadBytes += file.size;
              }
            }
            plannedUploadMediaBytes += windowPlannedUploadBytes;
            diagnosticPlannedUploadBytes += windowPlannedUploadBytes;
            preflightSkippedFiles += windowPreflightSkippedFiles;
            preflightSkippedBytes += windowPreflightSkippedBytes;

            diagnostics.checkpointWindow({
              windowIndex,
              status: 'ready',
              selectedCount: windowAssets.length,
              preparedCount: window.files.length,
              failedCount: window.failures.length,
              discoveredBytes: window.discoveredBytes,
              selectedMediaBytes: window.selectedMediaBytes,
              additionalComponentsBytes: window.additionalComponentsBytes,
              selectedMediaFiles: window.selectedMediaFiles,
              additionalComponentsFiles: window.additionalComponentsFiles,
              plannedUploadBytes: windowPlannedUploadBytes,
              preflightSkippedFiles: windowPreflightSkippedFiles,
              preflightSkippedBytes: windowPreflightSkippedBytes,
              appleFilenameCount: window.filenameResolutionAppleCount,
              fallbackFilenameCount: windowFilenameFallbackCount,
              startedElapsedMs: 0,
              readyElapsedMs: diagnostics.elapsedMs(),
              preparationDurationMs: window.preparationDurationMs,
              filenameDurationMs: window.filenameResolutionDurationMs,
              preflightDurationMs: preflight.preflightDurationMs,
              uploadCapacityWaitDurationMs: 0,
              uploadCapacityWaitCount: 0,
              preflight: {
                ...preflight.metrics,
                allUploadWorkersIdleDuringPreflightMs:
                  preparationPolicy.effectiveMode === 'streaming'
                    ? Math.max(0, preflightIdleAfter - preflightIdleBefore)
                    : 0,
                queueDepthAtStart: preflightQueueDepthAtStart,
                queueDepthAtEnd: queue.depth,
                activeUploadWorkersAtStart: preflightActiveWorkersAtStart,
                activeUploadWorkersAtEnd: activeUploadWorkers,
              },
              uploadTiming: {
                measuredFiles: 0,
                fileReadDurationMs: 0,
                httpRequestDurationMs: 0,
                interChunkGapDurationMs: 0,
                serverWriteDurationMs: 0,
                serverFinalizeDurationMs: 0,
                maxServerFinalizeDurationMs: 0,
              },
            });

            if (enqueueImmediately) {
              for (const file of window.files) {
                if (this.isCancelled) break;
                let capacityWaitStartedAt: number | undefined;
                await queue.push(file, waiting => {
                  if (waiting) {
                    capacityWaitStartedAt = Date.now();
                    preparationActivity = 'waiting';
                    onProgress(progressFor(file, 'waiting'));
                    return;
                  }
                  if (capacityWaitStartedAt !== undefined) {
                    diagnostics.recordUploadCapacityWait(
                      windowIndex,
                      Date.now() - capacityWaitStartedAt,
                    );
                    capacityWaitStartedAt = undefined;
                  }
                  if (!preparationComplete && !this.isCancelled) {
                    preparationActivity = 'preparing';
                    onProgress(progressFor(file, 'preparing'));
                  }
                });
              }
              diagnostics.markWindowEnqueued(windowIndex, queue.maxDepth);
            } else {
              preparedWindows.push({ windowIndex, files: window.files });
            }
          }
          return preparedFiles === assets.length && !this.isCancelled;
        } catch (error) {
          fatalError = error instanceof ApiRequestError && error.status === 401
            ? error
            : error instanceof TransferFailure && error.fatal
              ? error
              : new TransferFailure('preflight', 'unexpected', true);
          this.cancel();
          return false;
        }
      };

      const finishPreparation = () => {
        if (preparationComplete) return;
        preparationComplete = true;
        preparationActivity = 'complete';
        diagnostics.markPreparationComplete(queue.maxDepth);
      };

      const enqueuePreparedWindows = async () => {
        try {
          for (const preparedWindow of preparedWindows) {
            const files = preparedWindow.files;
            preparedWindow.files = [];
            for (const file of files) {
              if (this.isCancelled) return;
              await queue.push(file);
            }
            diagnostics.markWindowEnqueued(preparedWindow.windowIndex, queue.maxDepth);
          }
          preparedWindows.length = 0;
        } finally {
          queue.close();
        }
      };

      const worker = async (workerIndex: number) => {
        while (!this.isCancelled) {
          const item = await queue.shift();
          if (!item) return;
          if (!(await thermal.waitForUpload(workerIndex))) return;
          const {
            asset,
            fileRef,
            nativeUri,
            size,
            computedHash,
            transferFilename,
          } = item;

          if (item.preflightAction === 'skip') {
            filesCompleted += 1;
            skippedFiles += 1;
            skippedBytes += size;
            avoidedBytes += size;
            terminalItemIds.add(item.variantId);
            recordHistoryProblem({
              id: item.variantId,
              name: transferFilename,
              savedName: item.duplicateMatchedFilename,
              matchedName: item.duplicateMatchedFilename,
              size,
              outcome: 'skipped',
              duplicateStage: item.duplicateSource === 'outgoing-selection'
                ? 'outgoing-selection'
                : 'preflight',
              avoidedBytes: size,
            });
            onFileStatusChange?.({
              assetId: asset.id,
              itemId: item.variantId,
              mediaRole: item.mediaRole,
              componentSemantics: item.componentSemantics,
              fileRef,
              status: 'skipped',
              transferFilename,
              savedFilename: item.duplicateMatchedFilename,
              message: item.duplicateMatchedFilename
                ? `${transferFilename} was not transferred because identical content already exists as ${item.duplicateMatchedFilename}.`
                : `${transferFilename} was not transferred because identical content already exists.`,
            });
            onProgress(progressFor(item, 'skipped'));
            await releasePreparedFile(nativeUri);
            continue;
          }

          if (item.preflightFailureCode) {
            filesCompleted += 1;
            failedFiles += 1;
            terminalItemIds.add(item.variantId);
            recordHistoryProblem({
              id: item.variantId,
              name: transferFilename,
              size,
              outcome: 'failed',
              error: item.preflightFailureCode,
            });
            diagnostics.recordFailure({
              fileRef,
              stage: 'preflight',
              code: item.preflightFailureCode,
              retryCount: item.preflightFailureCode === 'file-changed' ? 1 : 0,
            });
            onFileStatusChange?.({
              assetId: asset.id,
              itemId: item.variantId,
              mediaRole: item.mediaRole,
              componentSemantics: item.componentSemantics,
              fileRef,
              status: 'error',
              transferFilename,
              stage: 'preflight',
              errorCode: item.preflightFailureCode,
              message: mediaComponentFailureMessage(
                item.mediaRole,
                item.componentSemantics,
                transferErrorMessage(item.preflightFailureCode),
              ),
            });
            onProgress(progressFor(item, 'failed'));
            await releasePreparedFile(nativeUri);
            continue;
          }

          onFileStatusChange?.({
            assetId: asset.id,
            itemId: item.variantId,
            mediaRole: item.mediaRole,
            componentSemantics: item.componentSemantics,
            fileRef,
            status: 'uploading',
            transferFilename,
          });
          markUploadWorkerBusy();
          diagnostics.recordWindowUploadStarted(item.windowIndex);
          const totalChunks = Math.ceil(size / this.CHUNK_SIZE);
          let serverSkipped = false;
          let fileAcknowledgedBytes = 0;
          let sentFilename = transferFilename;
          let savedFilename: string | undefined;

          try {
            if (nativeCapabilities.available) {
              let acknowledged = 0;
              const recordNativeAcknowledgement = (reportedBytes: number) => {
                if (!Number.isFinite(reportedBytes)) return;
                const boundedBytes = Math.min(size, Math.max(acknowledged, reportedBytes));
                const delta = boundedBytes - acknowledged;
                if (delta <= 0) return;
                acknowledged = boundedBytes;
                fileAcknowledgedBytes += delta;
                globalBytesSent += delta;
                lastRateSampledAt = Date.now();
                diagnostics.recordFirstAcknowledgement();
                const rates = throughput.recordAcknowledgement(delta, delta, lastRateSampledAt);
                acknowledgedMediaBytes = rates.uploadedMediaBytes;
                currentMediaMBps = rates.currentMediaMBps;
                averageMediaMBps = rates.averageMediaMBps;
                peakMediaMBps = rates.peakMediaMBps;
                currentEncodedMBps = rates.currentEncodedMBps;
                metricsReporter.recordCurrentMediaRate(currentMediaMBps);
                onProgress(progressFor(item, 'uploading'));
              };
              const listener = nativeCapabilities.addProgressListener(event => {
                if (event.fileId !== computedHash) return;
                recordNativeAcknowledgement(event.bytesSent);
              });
              try {
                const result = await nativeCapabilities.uploadFile({
                  uri: nativeUri,
                  endpoint: `${api.url}/upload_chunk`,
                  token: api.uploadToken,
                  fileId: computedHash,
                  transferFilename,
                  chunkSize: 8 * 1024 * 1024,
                  skipDuplicates: duplicatePolicy.shouldSkipDuplicates,
                });
                // Native progress events are intentionally coalesced and can still be
                // queued when uploadFile resolves. Reconcile with the authoritative
                // return value before removing the listener so completed transfers do
                // not under-report their final acknowledged byte count.
                recordNativeAcknowledgement(result.bytesSent);
                if (result.status === 'failed') {
                  if (result.errorCode === 'unauthorized') {
                    api.notifyUnauthorized();
                    throw new ApiRequestError(
                      'Desktop server session changed. Scan the current QR code to reconnect.',
                      result.httpStatus,
                    );
                  }
                  throw new TransferFailure('server', 'server-rejected');
                }
                serverSkipped = result.skipped;
                sentFilename = result.transferFilename || transferFilename;
                savedFilename = result.savedFilename;
                nativeRetryCount += result.retryCount;
                peakNativeResidentMemoryBytes = Math.max(
                  peakNativeResidentMemoryBytes,
                  result.peakResidentMemoryBytes,
                );
                diagnostics.recordNativeUploadTiming(item.windowIndex, {
                  fileReadDurationMs: result.fileReadDurationMs,
                  httpRequestDurationMs: result.httpRequestDurationMs,
                  interChunkGapDurationMs: result.interChunkGapDurationMs,
                  serverWriteDurationMs: result.serverWriteDurationMs,
                  serverFinalizeDurationMs: result.serverFinalizeDurationMs,
                });
              } finally {
                listener.remove();
              }
            } else {
              const startChunkRead = (chunkIndex: number): Promise<string | undefined> => {
                const position = chunkIndex * this.CHUNK_SIZE;
                const length = Math.min(this.CHUNK_SIZE, size - position);
                return FileSystem.readAsStringAsync(nativeUri, {
                  encoding: FileSystem.EncodingType.Base64,
                  position,
                  length,
                }).catch(() => undefined);
              };
              let pendingRead = startChunkRead(0);
              for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
                if (!(await thermal.waitForUpload(workerIndex)) || this.isCancelled) {
                  throw new TransferFailure('upload', 'cancelled');
                }
                const position = chunkIndex * this.CHUNK_SIZE;
                const length = Math.min(this.CHUNK_SIZE, size - position);
                const base64Body = await pendingRead;
                if (!base64Body) throw new TransferFailure('upload', 'file-read-failed');
                if (chunkIndex + 1 < totalChunks) pendingRead = startChunkRead(chunkIndex + 1);
                const headers: Record<string, string> = {
                  'Content-Type': 'application/octet-stream',
                  'X-Content-Transfer-Encoding': 'base64',
                  'X-File-Id': computedHash,
                  'X-Filename': encodeURIComponent(transferFilename),
                  'X-Chunk-Index': chunkIndex.toString(),
                  'X-Total-Chunks': totalChunks.toString(),
                  'X-File-Size': size.toString(),
                  'X-Skip-Duplicates': duplicatePolicy.shouldSkipDuplicates
                    ? 'true'
                    : 'false',
                };
                if (api.uploadToken) headers['X-Upload-Token'] = api.uploadToken;
                const responseText = await this.uploadEncodedChunk(
                  `${api.url}/upload_chunk`,
                  headers,
                  base64Body,
                  this.MAX_CHUNK_RETRIES,
                );
                if (chunkIndex === totalChunks - 1) {
                  try {
                    const response = JSON.parse(responseText) as {
                      skipped?: boolean;
                      filename?: string;
                    };
                    serverSkipped = response.skipped === true;
                    savedFilename = typeof response.filename === 'string' && response.filename
                      ? response.filename
                      : undefined;
                  } catch {
                    serverSkipped = false;
                  }
                }
                globalBytesSent += length;
                fileAcknowledgedBytes += length;
                lastRateSampledAt = Date.now();
                if (length > 0) diagnostics.recordFirstAcknowledgement();
                const rates = throughput.recordAcknowledgement(
                  length,
                  base64Body.length,
                  lastRateSampledAt,
                );
                acknowledgedMediaBytes = rates.uploadedMediaBytes;
                currentMediaMBps = rates.currentMediaMBps;
                averageMediaMBps = rates.averageMediaMBps;
                peakMediaMBps = rates.peakMediaMBps;
                currentEncodedMBps = rates.currentEncodedMBps;
                metricsReporter.recordCurrentMediaRate(currentMediaMBps);
                onProgress(progressFor(item, 'uploading'));
              }
            }

            filesCompleted += 1;
            terminalItemIds.add(item.variantId);
            if (serverSkipped) {
              skippedFiles += 1;
              skippedBytes += size;
              finalizationDuplicateBytes += size;
              serverSkippedFiles += 1;
              serverSkippedBytes += size;
              recordHistoryProblem({
                id: item.variantId,
                name: sentFilename,
                savedName: savedFilename,
                matchedName: savedFilename,
                size,
                outcome: 'skipped',
                duplicateStage: 'finalization',
                avoidedBytes: 0,
              });
              onFileStatusChange?.({
                assetId: asset.id,
                itemId: item.variantId,
                mediaRole: item.mediaRole,
                componentSemantics: item.componentSemantics,
                fileRef,
                status: 'skipped',
                transferFilename: sentFilename,
                savedFilename,
                message: savedFilename
                  ? `${sentFilename} was not transferred because identical content already exists as ${savedFilename}.`
                  : `${sentFilename} was not transferred because identical content was verified by the desktop.`,
              });
            } else {
              uploadedFiles += 1;
              successfulUploadedBytes += size;
              onFileStatusChange?.({
                assetId: asset.id,
                itemId: item.variantId,
                mediaRole: item.mediaRole,
                componentSemantics: item.componentSemantics,
                fileRef,
                status: 'success',
                transferFilename: sentFilename,
                savedFilename,
                message: savedFilename && savedFilename !== sentFilename
                  ? `Saved as ${savedFilename}`
                  : undefined,
              });
            }
          } catch (error) {
            if (error instanceof ApiRequestError && error.status === 401) {
              fatalError = error;
              this.cancel();
              return;
            }
            if (this.isCancelled) return;
            const failure = transferFailure(error, 'upload', 'upload-failed');
            failedFiles += 1;
            filesCompleted += 1;
            terminalItemIds.add(item.variantId);
            recordHistoryProblem({
              id: item.variantId,
              name: transferFilename,
              size,
              outcome: 'failed',
              error: failure.code,
            });
            plannedUploadMediaBytes = Math.max(
              acknowledgedMediaBytes,
              plannedUploadMediaBytes - Math.max(0, size - fileAcknowledgedBytes),
            );
            diagnostics.recordFailure({
              fileRef,
              stage: failure.stage,
              code: failure.code,
              retryCount: 0,
            });
            onFileStatusChange?.({
              assetId: asset.id,
              itemId: item.variantId,
              mediaRole: item.mediaRole,
              componentSemantics: item.componentSemantics,
              fileRef,
              status: 'error',
              transferFilename,
              stage: failure.stage,
              errorCode: failure.code,
              message: mediaComponentFailureMessage(
                item.mediaRole,
                item.componentSemantics,
                failure.message,
              ),
            });
            onProgress(progressFor(item, 'failed'));
          } finally {
            await releasePreparedFile(nativeUri);
            markUploadWorkerIdle();
          }
        }
      };

      const workers = () => {
        if (!uploadWorkersStarted) {
          uploadWorkersStarted = true;
          allUploadWorkersIdleSince = Date.now();
        }
        return Array.from({ length: this.CONCURRENCY }, (_, index) => worker(index));
      };
      const preparedAll = await runTransferPipeline({
        preparationMode: preparationPolicy.effectiveMode,
        produce: producer,
        finishPreparation,
        closeReadyQueue: () => queue.close(),
        enqueuePreparedWindows,
        runWorkers: workers,
      });
      if (fatalError) throw fatalError;
      if (!preparedAll) {
        if (this.isCancelled) {
          throw new TransferFailure('upload', 'cancelled');
        }
        throw new TransferFailure('preflight', 'unexpected', true);
      }
      if (fatalError) throw fatalError;

      await api.logClientEvent(
        'INFO',
        'transfer_prepared',
        'iPhone transfer preparation completed',
        {
          sessionId,
          preparationDurationMs,
          preflightDurationMs,
          filenameResolutionDurationMs,
          filenameResolutionBatchCount: nativeCapabilities.available
            ? Math.ceil(assets.length / preparationPolicy.windowSize)
            : 0,
          filenameResolutionAppleCount,
          filenameResolutionFallbackCount: nativeCapabilities.available
            ? Math.max(0, preparedFiles - preparationFailedFiles - filenameResolutionAppleCount)
            : Math.max(0, preparedFiles - preparationFailedFiles),
          filenameResolutionMaxBatchSize: nativeCapabilities.available
            ? Math.min(preparationPolicy.windowSize, assets.length)
            : 0,
          queueMaxDepth: queue.maxDepth,
        },
      );

      if (!this.isCancelled) {
        for (let index = 0; index < assets.length; index += 1) {
          const asset = assets[index];
          if (!preparedOutcomeAssetIds.has(asset.id)) {
            markPreparationFailure(
              asset,
              `${asset.id}:missing`,
              index + 1,
              'unknown',
              'primary',
              asset.filename,
              'metadata',
              'unexpected',
            );
          }
        }
      }

      const reportedFailedFiles = failedFiles;
      const expandedFiles = readyFiles + preparationFailedFiles;
      const completionStatus = this.isCancelled
        ? 'cancelled'
        : reportedFailedFiles > 0
          ? 'mixed'
          : 'completed';
      const uploadDurationMs = Date.now() - startTime;

      diagnostics.updateTransfer(diagnosticTransferValues(reportedFailedFiles));
      await diagnostics.finish(completionStatus);

      const summary: UploadSummary = {
        sessionId,
        selectedAssets: assets.length,
        expandedFiles,
        selectedFiles: expandedFiles,
        uploadedFiles,
        skippedFiles,
        failedFiles: reportedFailedFiles,
        selectedBytes: discoveredBytes,
        selectedMediaBytes,
        additionalComponentsBytes,
        selectedMediaFiles,
        additionalComponentsFiles,
        byteTotalComplete: preparationFailedFiles === 0,
        uploadedBytes: successfulUploadedBytes,
        skippedBytes,
        avoidedBytes,
        finalizationDuplicateBytes,
        uploadDurationMs,
        averageMediaMBps,
        peakMediaMBps,
        completionStatus,
        diagnosticReportAvailable: diagnostics.reportAvailable,
      };

      const historyPayload = {
          sessionId,
          completedAt: Date.now(),
          selectedAssets: assets.length,
          expandedFiles,
          selectedFiles: expandedFiles,
          uploadedFiles,
          skippedFiles,
          failedFiles: reportedFailedFiles,
          selectedBytes: discoveredBytes,
          selectedMediaBytes,
          additionalComponentsBytes,
          selectedMediaFiles,
          additionalComponentsFiles,
          uploadedBytes: successfulUploadedBytes,
          skippedBytes,
          avoidedBytes,
          finalizationDuplicateBytes,
          checkDurationMs: preparationDurationMs + preflightDurationMs,
          uploadDurationMs: summary.uploadDurationMs,
          totalDurationMs: summary.uploadDurationMs,
          averageSpeedMBps: averageMediaMBps,
          peakSpeedMBps: peakMediaMBps,
          retries: nativeRetryCount,
          files: historyFiles,
        };
      try {
        await api.transferHistory(historyPayload);
      } catch {
        try {
          await api.transferHistory({ ...historyPayload, files: [] });
        } catch {
          // Transfer completion must not depend on optional history reporting.
        }
      }

      await api.logClientEvent(
        reportedFailedFiles > 0 ? 'ERROR' : 'INFO',
        reportedFailedFiles > 0 ? 'transfer_failed' : 'transfer_completed',
        reportedFailedFiles > 0
          ? 'iPhone transfer completed with failures'
          : 'iPhone transfer completed',
        {
          sessionId,
          uploadedFiles,
          skippedFiles,
          failedFiles: reportedFailedFiles,
          preparationDurationMs,
          preflightDurationMs,
          filenameResolutionDurationMs,
          filenameResolutionBatchCount: Math.ceil(assets.length / preparationPolicy.windowSize),
          filenameResolutionAppleCount,
          preflightFailureCount,
          queueMaxDepth: queue.maxDepth,
          nativeRetryCount,
          peakNativeResidentMemoryBytes,
        },
      );

      if (!this.isCancelled) onComplete(summary);
    } catch (error) {
      const failure = error instanceof ApiRequestError && error.status === 401
        ? new TransferFailure('network', 'unauthorized', true)
        : transferFailure(error, 'upload', 'unexpected');
      diagnostics.updateTransfer(diagnosticTransferValues(failedFiles));
      await diagnostics.finish(this.isCancelled && !failure.fatal ? 'cancelled' : 'fatal');
      await api.logClientEvent('ERROR', 'transfer_exception', 'iPhone transfer stopped unexpectedly', {
        sessionId,
        errorType: failure.code,
      });
      if (!this.isCancelled || failure.fatal) {
        const summary: UploadSummary = {
          sessionId,
          selectedAssets: assets.length,
          expandedFiles: readyFiles + preparationFailedFiles,
          selectedFiles: Math.max(assets.length, readyFiles + preparationFailedFiles),
          uploadedFiles,
          skippedFiles,
          failedFiles: Math.max(
            failedFiles,
            Math.max(assets.length, readyFiles + preparationFailedFiles) - uploadedFiles - skippedFiles,
          ),
          selectedBytes: discoveredBytes,
          selectedMediaBytes,
          additionalComponentsBytes,
          selectedMediaFiles,
          additionalComponentsFiles,
          byteTotalComplete: preparationFailedFiles === 0,
          uploadedBytes: successfulUploadedBytes,
          skippedBytes,
          avoidedBytes,
          finalizationDuplicateBytes,
          uploadDurationMs: Date.now() - startTime,
          averageMediaMBps,
          peakMediaMBps,
          completionStatus: 'fatal',
          diagnosticReportAvailable: diagnostics.reportAvailable,
        };
        onError(failure, summary);
      }
    } finally {
      if (this.isCancelled) {
        await api.cancelUploadSession(sessionId).catch(() => undefined);
      }
      try {
        thermalListener.remove();
      } catch {
        // Listener cleanup must not leave the manager in a permanently busy state.
      }
      thermal.cancel();
      queue.close();
      try {
        await nativeCapabilities.endTransfer(sessionRef);
      } catch {
        // Native teardown is retried by the preparation service on its next session.
      }
      try {
        await metricsReporter.finish();
      } catch {
        // Best-effort metrics must never hold the transfer lifecycle open.
      } finally {
        this.activeQueue = null;
        this.thermalController = null;
        this.activeSessionId = null;
        this.activeSessionRef = null;
        this.isRunning = false;
        this.activeRequests.clear();
      }
    }
  }
}

export const uploadManager = new UploadManager();
