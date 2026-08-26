import React from 'react';
import { Alert } from 'react-native';
import { MediaAsset } from '@/services/MediaScanner';
import { uploadManager, TransferProgress } from '@/services/UploadManager';
import {
  FileStatusUpdate,
  GlobalProgress,
  DuplicateCheckStage,
  PreparationMode,
  ThermalState,
  UploadSummary,
} from '@/services/upload/types';
import { transferText } from './content/transferText';
import { FileState, FileStatus } from './transferPresentation';
import { formatTransferEta, TransferEtaEstimator } from './TransferEtaEstimator';

const UI_UPDATE_INTERVAL_MS = 100;
const METRICS_UPDATE_INTERVAL_MS = 1000;
const QUEUE_NOTICE_DWELL_MS = 1000;
const QUEUE_NOTICE_CLEAR_HOLD_MS = 750;
type UploadProgress = GlobalProgress;

export function useTransferController({
  assets,
  onCancel,
  preparationMode = 'prepare-first',
  skipExactDuplicates = true,
  includeAdditionalMediaComponents = false,
}: {
  assets: MediaAsset[];
  onCancel: () => void;
  preparationMode?: PreparationMode;
  skipExactDuplicates?: boolean;
  includeAdditionalMediaComponents?: boolean;
}) {
  const [currentProgress, setCurrentProgress] = React.useState<TransferProgress | null>(null);
  const [currentMediaMBps, setCurrentMediaMBps] = React.useState(0);
  const [averageMediaMBps, setAverageMediaMBps] = React.useState(0);
  const [peakMediaMBps, setPeakMediaMBps] = React.useState(0);
  const [etaText, setEtaText] = React.useState('Calculating…');
  const [completionSummary, setCompletionSummary] = React.useState<UploadSummary | null>(null);
  const [isFinished, setIsFinished] = React.useState(false);
  const [phase, setPhase] = React.useState<
    'preparing' | 'checking' | 'waiting' | 'uploading'
  >('preparing');
  const [hasUploadStarted, setHasUploadStarted] = React.useState(false);
  const [queueCatchUpVisible, setQueueCatchUpVisible] = React.useState(false);
  const [preparedFiles, setPreparedFiles] = React.useState(0);
  const [readyFiles, setReadyFiles] = React.useState(0);
  const [preparationComplete, setPreparationComplete] = React.useState(false);
  const [activePreparationMode, setActivePreparationMode] = React.useState<PreparationMode>(preparationMode);
  const [totalTransferFiles, setTotalTransferFiles] = React.useState(assets.length);
  const [duplicateCheck, setDuplicateCheck] = React.useState<{
    stage: DuplicateCheckStage;
    checked: number;
    total: number;
  }>({ stage: 'finding-matches', checked: 0, total: 0 });
  const [summary, setSummary] = React.useState({ success: 0, skipped: 0, failed: 0 });
  const [recentFiles, setRecentFiles] = React.useState<FileState[]>([]);
  const [resultList, setResultList] = React.useState<FileState[]>([]);
  const [showAllResults, setShowAllResults] = React.useState(false);
  const [showOnlyErrors, setShowOnlyErrors] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [thermalState, setThermalState] = React.useState<ThermalState>('nominal');
  const statusById = React.useRef(new Map<string, FileStatus>());
  const resultById = React.useRef(new Map<string, FileState>());
  const recentFilesRef = React.useRef<FileState[]>([]);
  const summaryRef = React.useRef({ success: 0, skipped: 0, failed: 0 });
  const callbacksEnabledRef = React.useRef(true);
  const uiTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const metricsTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const queueNoticeShowTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueNoticeHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const filenameById = React.useMemo(
    () => new Map(assets.map(asset => [asset.id, asset.filename])),
    [assets],
  );
  const startedAt = React.useRef(Date.now());

  const markUnfinishedAsFailed = React.useCallback((message: string) => {
    let newlyFailed = 0;
    for (const asset of assets) {
      const previous = statusById.current.get(asset.id);
      if (previous === 'success' || previous === 'error' || previous === 'skipped') {
        continue;
      }
      statusById.current.set(asset.id, 'error');
      const next: FileState = { id: asset.id, filename: filenameById.get(asset.id) || asset.filename, status: 'error', msg: message };
      resultById.current.set(asset.id, next);
      recentFilesRef.current = [next, ...recentFilesRef.current.filter(item => item.id !== asset.id)].slice(0, 60);
      newlyFailed++;
    }
    if (newlyFailed > 0) {
      summaryRef.current.failed += newlyFailed;
    }
  }, [assets, filenameById]);

  React.useEffect(() => {
    let active = true;
    let finished = false;
    let pendingProgress: UploadProgress | null = null;
    let fileUiDirty = false;
    let uiTimer: ReturnType<typeof setTimeout> | null = null;
    let metricsTimer: ReturnType<typeof setInterval> | null = null;
    let latestMetrics: UploadProgress | null = null;
    let uploadObserved = false;
    let actualUploadObserved = false;
    let etaEstimator = new TransferEtaEstimator();
    let preparationWasComplete = false;
    let queueWaiting = false;
    let queueNoticeShown = false;
    let queueNoticeShowTimer: ReturnType<typeof setTimeout> | null = null;
    let queueNoticeHideTimer: ReturnType<typeof setTimeout> | null = null;
    let lastUiFlushAt = Date.now();
    const isActive = () => active && callbacksEnabledRef.current;

    callbacksEnabledRef.current = true;
    statusById.current.clear();
    resultById.current.clear();
    recentFilesRef.current = [];
    summaryRef.current = { success: 0, skipped: 0, failed: 0 };
    startedAt.current = Date.now();

    const clearQueueNoticeTimers = () => {
      if (queueNoticeShowTimer) clearTimeout(queueNoticeShowTimer);
      if (queueNoticeHideTimer) clearTimeout(queueNoticeHideTimer);
      queueNoticeShowTimer = null;
      queueNoticeHideTimer = null;
      queueNoticeShowTimerRef.current = null;
      queueNoticeHideTimerRef.current = null;
    };

    const updateQueueWaiting = (waiting: boolean) => {
      queueWaiting = waiting;
      if (waiting) {
        if (queueNoticeHideTimer) {
          clearTimeout(queueNoticeHideTimer);
          queueNoticeHideTimer = null;
          queueNoticeHideTimerRef.current = null;
        }
        if (!actualUploadObserved || queueNoticeShown || queueNoticeShowTimer) return;
        queueNoticeShowTimer = setTimeout(() => {
          queueNoticeShowTimer = null;
          queueNoticeShowTimerRef.current = null;
          if (!isActive() || finished || !queueWaiting || !actualUploadObserved) return;
          queueNoticeShown = true;
          setQueueCatchUpVisible(true);
        }, QUEUE_NOTICE_DWELL_MS);
        queueNoticeShowTimerRef.current = queueNoticeShowTimer;
        return;
      }

      if (queueNoticeShowTimer) {
        clearTimeout(queueNoticeShowTimer);
        queueNoticeShowTimer = null;
        queueNoticeShowTimerRef.current = null;
      }
      if (!queueNoticeShown || queueNoticeHideTimer) return;
      queueNoticeHideTimer = setTimeout(() => {
        queueNoticeHideTimer = null;
        queueNoticeHideTimerRef.current = null;
        if (!isActive() || finished || queueWaiting) return;
        queueNoticeShown = false;
        setQueueCatchUpVisible(false);
      }, QUEUE_NOTICE_CLEAR_HOLD_MS);
      queueNoticeHideTimerRef.current = queueNoticeHideTimer;
    };

    const applyProgress = (prog: UploadProgress) => {
      if (typeof prog.preparedFiles === 'number') {
        setPreparedFiles(previous => Math.max(previous, prog.preparedFiles ?? 0));
      }
      if (typeof prog.readyFiles === 'number') {
        setReadyFiles(previous => Math.max(previous, prog.readyFiles ?? 0));
      }
      if (typeof prog.totalFiles === 'number' && prog.totalFiles > 0) {
        setTotalTransferFiles(prog.totalFiles);
      }
      if (prog.preparationComplete === true) setPreparationComplete(true);
      if (prog.preparationMode) setActivePreparationMode(prog.preparationMode);
      if (prog.thermalState) setThermalState(prog.thermalState);
      const uploadStartedNow = prog.status === 'uploading' && (
        prog.acknowledgedMediaBytes > 0 || prog.currentMediaMBps > 0
      );
      if (uploadStartedNow && !actualUploadObserved) {
        actualUploadObserved = true;
        setHasUploadStarted(true);
        if (queueWaiting) updateQueueWaiting(true);
      }
      setCurrentProgress({
        assetId: prog.currentAsset.id,
        bytesSent: prog.bytesSent,
        totalBytes: prog.totalBytes,
        acknowledgedMediaBytes: prog.acknowledgedMediaBytes,
        plannedUploadMediaBytes: prog.plannedUploadMediaBytes,
        rateSampledAt: prog.rateSampledAt,
        status: prog.status === 'skipped' || prog.status === 'failed'
          ? prog.status
          : prog.status === 'uploading'
            ? 'uploading'
            : 'pending',
      });
      if (prog.preparationActivity === 'waiting' && prog.preparationComplete !== true) {
        updateQueueWaiting(true);
        setPhase('waiting');
        return;
      }
      updateQueueWaiting(false);
      if (
        (prog.preparationActivity === 'checking' || prog.status === 'checking') &&
        prog.preparationComplete !== true
      ) {
        setPhase('checking');
        setDuplicateCheck({
          stage: prog.duplicateCheckStage ?? 'finding-matches',
          checked: prog.checkedFiles || 0,
          total: prog.duplicateCandidates || 0,
        });
        return;
      }
      if (
        (prog.preparationActivity === 'preparing' || prog.status === 'preparing') &&
        prog.preparationComplete !== true
      ) {
        setPhase('preparing');
        setPreparedFiles(previous => Math.max(previous, prog.preparedFiles || 0));
        return;
      }
      setPhase('uploading');
    };

    const flushMetrics = () => {
      if (!isActive() || finished) return;
      if (latestMetrics) {
        setCurrentMediaMBps(latestMetrics.currentMediaMBps || 0);
        setAverageMediaMBps(latestMetrics.averageMediaMBps || 0);
        setPeakMediaMBps(latestMetrics.peakMediaMBps || 0);
      }
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)));
      const nextEtaText = uploadObserved
        ? formatTransferEta({
            estimatedSeconds: etaEstimator.estimateSeconds(Date.now()),
            hasRemainingBytes: etaEstimator.hasRemainingBytes(),
            isFinished: false,
          })
        : 'Calculating…';
      setEtaText(previous => previous === nextEtaText ? previous : nextEtaText);
    };

    const flushUi = () => {
      if (!isActive()) return;
      if (pendingProgress) {
        const latest = pendingProgress;
        pendingProgress = null;
        applyProgress(latest);
      }
      if (fileUiDirty) {
        fileUiDirty = false;
        setSummary({ ...summaryRef.current });
        setRecentFiles([...recentFilesRef.current]);
      }
    };

    const scheduleUiFlush = () => {
      if (!isActive() || finished || uiTimer) return;
      const delay = Math.max(0, UI_UPDATE_INTERVAL_MS - (Date.now() - lastUiFlushAt));
      uiTimer = setTimeout(() => {
        uiTimer = null;
        uiTimerRef.current = null;
        lastUiFlushAt = Date.now();
        flushUi();
        if (pendingProgress || fileUiDirty) scheduleUiFlush();
      }, delay);
      uiTimerRef.current = uiTimer;
    };

    const finish = (uploadSummary?: UploadSummary) => {
      if (!isActive() || finished) return false;
      finished = true;
      if (uiTimer) clearTimeout(uiTimer);
      uiTimerRef.current = null;
      if (metricsTimer) clearInterval(metricsTimer);
      metricsTimer = null;
      metricsTimerRef.current = null;
      clearQueueNoticeTimers();
      flushUi();
      setResultList(Array.from(resultById.current.values()));
      if (uploadSummary) {
        setCompletionSummary(uploadSummary);
        setAverageMediaMBps(uploadSummary.averageMediaMBps);
        setPeakMediaMBps(uploadSummary.peakMediaMBps);
      }
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
      setEtaText('Done');
      setIsFinished(true);
      return true;
    };

    const updateFileStatus = ({
      assetId,
      itemId,
      status,
      transferFilename,
      message,
      mediaRole,
      componentSemantics,
    }: FileStatusUpdate) => {
      if (!isActive() || finished) return;
      if (status === 'uploading' && !actualUploadObserved) {
        actualUploadObserved = true;
        setHasUploadStarted(true);
        if (queueWaiting) updateQueueWaiting(true);
      }
      const statusId = itemId || assetId;
      const previous = statusById.current.get(statusId);
      statusById.current.set(statusId, status);
      const isTerminal = status === 'success' || status === 'error' || status === 'skipped';
      const wasTerminal = previous === 'success' || previous === 'error' || previous === 'skipped';
      if (isTerminal && !wasTerminal) {
        summaryRef.current.success += status === 'success' ? 1 : 0;
        summaryRef.current.skipped += status === 'skipped' ? 1 : 0;
        summaryRef.current.failed += status === 'error' ? 1 : 0;
      }
      const next: FileState = {
        id: statusId,
        filename: transferFilename || filenameById.get(assetId) || assetId,
        status,
        msg: message,
        mediaRole,
        componentSemantics,
      };
      resultById.current.set(statusId, next);
      recentFilesRef.current = [next, ...recentFilesRef.current.filter(item => item.id !== statusId)].slice(0, 60);
      fileUiDirty = true;
      scheduleUiFlush();
    };

    const reportFatalError = (error: unknown, uploadSummary?: UploadSummary) => {
      if (!isActive() || finished) return;
      const message = error instanceof Error ? error.message : transferText.unknownError;
      markUnfinishedAsFailed(message || transferText.unfinishedFileError);
      fileUiDirty = true;
      if (finish(uploadSummary)) Alert.alert(transferText.fatalErrorTitle, message);
    };

    const startTransfer = async () => {
      await uploadManager.uploadFilesConcurrent(
        assets,
        {
          onProgress: (prog) => {
            if (isActive() && !finished) {
              latestMetrics = prog;
              if (
                !actualUploadObserved &&
                prog.status === 'uploading' &&
                (prog.acknowledgedMediaBytes > 0 || prog.currentMediaMBps > 0)
              ) {
                actualUploadObserved = true;
                setHasUploadStarted(true);
                if (queueWaiting) updateQueueWaiting(true);
              }
              const preparationJustCompleted =
                prog.preparationComplete === true && !preparationWasComplete;
              if (preparationJustCompleted) {
                preparationWasComplete = true;
                etaEstimator = new TransferEtaEstimator();
                uploadObserved = false;
              }
              if (
                prog.preparationComplete === true &&
                prog.status !== 'preparing' &&
                prog.status !== 'checking'
              ) {
                uploadObserved = true;
                etaEstimator.observe({
                  acknowledgedMediaBytes: prog.acknowledgedMediaBytes,
                  plannedUploadMediaBytes: prog.plannedUploadMediaBytes,
                  currentMediaMBps: prog.currentMediaMBps,
                  sampledAt: prog.rateSampledAt,
                });
              }
              pendingProgress = prog;
              scheduleUiFlush();
            }
          },
          onComplete: finish,
          onError: reportFatalError,
          onFileStatusChange: updateFileStatus,
          onThermalStateChange: state => {
            if (isActive() && !finished) setThermalState(state);
          },
        },
        {
          preparationMode,
          thermalPolicy: 'monitor-only',
          skipExactDuplicates,
          includeAdditionalMediaComponents,
        },
      );
    };

    metricsTimer = setInterval(flushMetrics, METRICS_UPDATE_INTERVAL_MS);
    metricsTimerRef.current = metricsTimer;
    void startTransfer().catch(reportFatalError);
    return () => {
      active = false;
      callbacksEnabledRef.current = false;
      pendingProgress = null;
      if (uiTimer) clearTimeout(uiTimer);
      uiTimerRef.current = null;
      if (metricsTimer) clearInterval(metricsTimer);
      metricsTimerRef.current = null;
      clearQueueNoticeTimers();
      uploadManager.cancel();
    };
  }, [
    assets,
    filenameById,
    markUnfinishedAsFailed,
    preparationMode,
    skipExactDuplicates,
    includeAdditionalMediaComponents,
  ]);

  const cancelTransfer = React.useCallback(() => {
    callbacksEnabledRef.current = false;
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    uiTimerRef.current = null;
    if (metricsTimerRef.current) clearInterval(metricsTimerRef.current);
    metricsTimerRef.current = null;
    if (queueNoticeShowTimerRef.current) clearTimeout(queueNoticeShowTimerRef.current);
    queueNoticeShowTimerRef.current = null;
    if (queueNoticeHideTimerRef.current) clearTimeout(queueNoticeHideTimerRef.current);
    queueNoticeHideTimerRef.current = null;
    setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
    setIsFinished(true);
    uploadManager.cancel();
    onCancel();
  }, [onCancel]);

  return {
    currentProgress,
    currentMediaMBps,
    averageMediaMBps,
    peakMediaMBps,
    etaText,
    completionSummary,
    isFinished,
    phase,
    hasUploadStarted,
    queueCatchUpVisible,
    preparedFiles,
    readyFiles,
    preparationComplete,
    activePreparationMode,
    totalTransferFiles,
    duplicateCheck,
    summary,
    recentFiles,
    showAllResults,
    setShowAllResults,
    showOnlyErrors,
    setShowOnlyErrors,
    elapsedSeconds,
    resultList,
    thermalState,
    cancelTransfer,
  };
}
