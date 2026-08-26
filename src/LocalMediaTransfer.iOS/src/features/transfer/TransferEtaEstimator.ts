const BYTES_PER_MB = 1_000_000;
const ETA_HALF_LIFE_MS = 5000;
const ETA_WARMUP_MS = 1500;
const MAX_NATIVE_PROGRESS_BYTES = 8 * 1024 * 1024;
const MIN_STALE_MS = 5000;
const MAX_STALE_MS = 30000;

export type EtaObservation = {
  acknowledgedMediaBytes: number;
  plannedUploadMediaBytes: number;
  currentMediaMBps: number;
  sampledAt: number;
};

export class TransferEtaEstimator {
  private firstSampleAt: number | null = null;
  private lastSampleAt: number | null = null;
  private smoothedSeconds: number | null = null;
  private staleAfterMs = MIN_STALE_MS;
  private remainingBytes = 0;

  observe({
    acknowledgedMediaBytes,
    plannedUploadMediaBytes,
    currentMediaMBps,
    sampledAt,
  }: EtaObservation): void {
    this.remainingBytes = Math.max(0, plannedUploadMediaBytes - acknowledgedMediaBytes);
    if (currentMediaMBps <= 0 || sampledAt <= 0) return;
    if (this.lastSampleAt !== null && sampledAt <= this.lastSampleAt) return;

    const rawSeconds = this.remainingBytes / BYTES_PER_MB / currentMediaMBps;
    const currentBytesPerSecond = currentMediaMBps * BYTES_PER_MB;
    this.staleAfterMs = Math.max(
      MIN_STALE_MS,
      Math.min(MAX_STALE_MS, 2 * MAX_NATIVE_PROGRESS_BYTES / currentBytesPerSecond * 1000),
    );

    if (this.firstSampleAt === null || this.lastSampleAt === null || this.smoothedSeconds === null) {
      this.firstSampleAt = sampledAt;
      this.lastSampleAt = sampledAt;
      this.smoothedSeconds = rawSeconds;
      return;
    }

    const deltaMs = sampledAt - this.lastSampleAt;
    const agedEstimate = Math.max(0, this.smoothedSeconds - deltaMs / 1000);
    const alpha = 1 - Math.pow(2, -deltaMs / ETA_HALF_LIFE_MS);
    this.smoothedSeconds = agedEstimate + alpha * (rawSeconds - agedEstimate);
    this.lastSampleAt = sampledAt;
  }

  estimateSeconds(now: number): number | null {
    if (this.remainingBytes <= 0) return 0;
    if (this.firstSampleAt === null || this.lastSampleAt === null || this.smoothedSeconds === null) {
      return null;
    }
    if (now - this.firstSampleAt < ETA_WARMUP_MS) return null;
    if (now - this.lastSampleAt > this.staleAfterMs) return null;
    return Math.max(0, this.smoothedSeconds - (now - this.lastSampleAt) / 1000);
  }

  hasRemainingBytes(): boolean {
    return this.remainingBytes > 0;
  }
}

export function formatTransferEta({
  estimatedSeconds,
  hasRemainingBytes,
  isFinished,
}: {
  estimatedSeconds: number | null;
  hasRemainingBytes: boolean;
  isFinished: boolean;
}): string {
  if (isFinished) return 'Done';
  if (!hasRemainingBytes) return 'Finishing…';
  if (estimatedSeconds === null) return 'Calculating…';
  if (estimatedSeconds < 10) return 'A few seconds';
  if (estimatedSeconds < 60) {
    const seconds = Math.max(10, Math.round(estimatedSeconds / 10) * 10);
    return seconds >= 60 ? 'About 1 min' : `About ${seconds}s`;
  }
  if (estimatedSeconds < 60 * 60) {
    return `About ${Math.max(1, Math.round(estimatedSeconds / 60))} min`;
  }
  if (estimatedSeconds <= 24 * 60 * 60) {
    return `About ${Math.max(1, Math.round(estimatedSeconds / 3600))} hr`;
  }
  return 'Over 1 day';
}
