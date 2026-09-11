import React from 'react';
import { GlobalProgress, UploadSummary } from '@/services/upload/types';
import { formatTransferEta, TransferEtaEstimator } from './TransferEtaEstimator';

/** Owns coalesced metrics and ETA; progress events never trigger a render directly. */
export function useTransferMetrics() {
  const [state, setState] = React.useState({ currentMediaMBps: 0, averageMediaMBps: 0,
    peakMediaMBps: 0, etaText: 'Calculating…', elapsedSeconds: 0 });
  const startedAt = React.useRef<number | null>(null);
  const latest = React.useRef<GlobalProgress | null>(null);
  const estimator = React.useRef(new TransferEtaEstimator());
  const preparationComplete = React.useRef(false);
  const uploadObserved = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMetrics = React.useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  React.useEffect(() => stopMetrics, [stopMetrics]);

  const beginMetrics = React.useCallback((isActive: () => boolean) => {
    stopMetrics();
    startedAt.current = Date.now();
    latest.current = null;
    estimator.current = new TransferEtaEstimator();
    preparationComplete.current = false;
    uploadObserved.current = false;
    timer.current = setInterval(() => {
      if (!isActive()) return;
      const progress = latest.current;
      setState(previous => ({
        currentMediaMBps: progress ? progress.currentMediaMBps || 0 : previous.currentMediaMBps,
        averageMediaMBps: progress ? progress.averageMediaMBps || 0 : previous.averageMediaMBps,
        peakMediaMBps: progress ? progress.peakMediaMBps || 0 : previous.peakMediaMBps,
        elapsedSeconds: Math.max(0, Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)),
        etaText: uploadObserved.current ? formatTransferEta({
          estimatedSeconds: estimator.current.estimateSeconds(Date.now()),
          hasRemainingBytes: estimator.current.hasRemainingBytes(), isFinished: false,
        }) : 'Calculating…',
      }));
    }, 1000);
  }, [stopMetrics]);

  const observeMetrics = React.useCallback((progress: GlobalProgress) => {
    latest.current = progress;
    if (progress.preparationComplete === true && !preparationComplete.current) {
      preparationComplete.current = true;
      estimator.current = new TransferEtaEstimator();
      uploadObserved.current = false;
    }
    if (progress.preparationComplete === true && progress.status !== 'preparing' && progress.status !== 'checking') {
      uploadObserved.current = true;
      estimator.current.observe({ acknowledgedMediaBytes: progress.acknowledgedMediaBytes,
        plannedUploadMediaBytes: progress.plannedUploadMediaBytes,
        currentMediaMBps: progress.currentMediaMBps, sampledAt: progress.rateSampledAt });
    }
  }, []);

  const finishMetrics = React.useCallback((summary?: UploadSummary) => {
    stopMetrics();
    setState(previous => ({ ...previous, etaText: 'Done',
      elapsedSeconds: Math.max(1, Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000)),
      averageMediaMBps: summary?.averageMediaMBps ?? previous.averageMediaMBps,
      peakMediaMBps: summary?.peakMediaMBps ?? previous.peakMediaMBps }));
  }, [stopMetrics]);
  const cancelMetrics = React.useCallback(() => {
    stopMetrics();
    setState(previous => ({ ...previous,
      elapsedSeconds: Math.max(1, Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000)) }));
  }, [stopMetrics]);
  return { state, beginMetrics, observeMetrics, finishMetrics, cancelMetrics, stopMetrics };
}
