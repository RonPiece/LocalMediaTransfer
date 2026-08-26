const BYTES_PER_MB = 1_000_000;

type ReporterOptions = {
  intervalMs?: number;
  now?: () => number;
};

/**
 * Coalesces high-frequency native progress into at most one best-effort server
 * sample per interval. Sends are serialized, and the session ID lets the
 * server reject a delayed sample from a previous transfer.
 */
export class ClientMetricsReporter {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private lastSentAt: number | null = null;
  private pendingBytesPerSecond: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sendChain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly sessionId: string,
    private readonly send: (sessionId: string, bytesPerSecond: number) => Promise<void>,
    options: ReporterOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 1000;
    this.now = options.now ?? Date.now;
  }

  recordCurrentMediaRate(currentMediaMBps: number): void {
    if (this.stopped) return;
    this.pendingBytesPerSecond = Math.max(0, currentMediaMBps) * BYTES_PER_MB;
    const now = this.now();
    if (this.lastSentAt === null || now - this.lastSentAt >= this.intervalMs) {
      this.flush(now);
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush(this.now());
      }, this.intervalMs - (now - this.lastSentAt));
    }
  }

  async finish(): Promise<void> {
    if (this.stopped) return this.sendChain;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingBytesPerSecond = null;
    this.enqueue(0);
    return this.sendChain;
  }

  private flush(now: number): void {
    if (this.stopped || this.pendingBytesPerSecond === null) return;
    const bytesPerSecond = this.pendingBytesPerSecond;
    this.pendingBytesPerSecond = null;
    this.lastSentAt = now;
    this.enqueue(bytesPerSecond);
  }

  private enqueue(bytesPerSecond: number): void {
    this.sendChain = this.sendChain
      .then(() => this.send(this.sessionId, bytesPerSecond))
      .catch(() => undefined);
  }
}
