const BYTES_PER_MB = 1_000_000;
const MAX_NATIVE_PROGRESS_BYTES = 8 * 1024 * 1024;

/** Allow two slow chunk acknowledgements before treating a rate as stale. */
export function rateStaleAfterMs(currentMediaMBps: number): number {
  if (!Number.isFinite(currentMediaMBps) || currentMediaMBps <= 0) return 5000;
  return Math.max(5000, Math.min(30000,
    2 * MAX_NATIVE_PROGRESS_BYTES / (currentMediaMBps * BYTES_PER_MB) * 1000));
}

export function isRateFresh(sampledAt: number, currentMediaMBps: number, now: number): boolean {
  return sampledAt > 0 && currentMediaMBps > 0 &&
    now >= sampledAt && now - sampledAt <= rateStaleAfterMs(currentMediaMBps);
}
