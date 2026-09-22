/** Terminal outcomes are recorded once per expanded media item. */
export class TransferOutcomes {
  private readonly terminalIds = new Set<string>();
  private counts = {
    filesCompleted: 0, uploadedFiles: 0, skippedFiles: 0, failedFiles: 0,
    preparationFailedFiles: 0, successfulUploadedBytes: 0, skippedBytes: 0,
    avoidedBytes: 0, finalizationDuplicateBytes: 0, serverSkippedFiles: 0, serverSkippedBytes: 0,
  };

  get filesCompleted(): number { return this.counts.filesCompleted; }
  get uploadedFiles(): number { return this.counts.uploadedFiles; }
  get skippedFiles(): number { return this.counts.skippedFiles; }
  get failedFiles(): number { return this.counts.failedFiles; }
  get preparationFailedFiles(): number { return this.counts.preparationFailedFiles; }
  get successfulUploadedBytes(): number { return this.counts.successfulUploadedBytes; }
  get skippedBytes(): number { return this.counts.skippedBytes; }
  get avoidedBytes(): number { return this.counts.avoidedBytes; }
  get finalizationDuplicateBytes(): number { return this.counts.finalizationDuplicateBytes; }
  get serverSkippedFiles(): number { return this.counts.serverSkippedFiles; }
  get serverSkippedBytes(): number { return this.counts.serverSkippedBytes; }

  get snapshot(): Readonly<typeof this.counts> { return { ...this.counts }; }

  private begin(id: string): boolean {
    if (this.terminalIds.has(id)) return false;
    this.terminalIds.add(id);
    this.counts.filesCompleted += 1;
    return true;
  }

  fail(id: string, preparation = false): boolean {
    if (!this.begin(id)) return false;
    this.counts.failedFiles += 1;
    if (preparation) this.counts.preparationFailedFiles += 1;
    return true;
  }

  skip(id: string, bytes: number, stage: 'preflight' | 'finalization'): void {
    if (!this.begin(id)) return;
    this.counts.skippedFiles += 1;
    this.counts.skippedBytes += bytes;
    if (stage === 'preflight') this.counts.avoidedBytes += bytes;
    else {
      this.counts.finalizationDuplicateBytes += bytes;
      this.counts.serverSkippedFiles += 1;
      this.counts.serverSkippedBytes += bytes;
    }
  }

  save(id: string, bytes: number): void {
    if (!this.begin(id)) return;
    this.counts.uploadedFiles += 1;
    this.counts.successfulUploadedBytes += bytes;
  }
}

/** Measures periods where all started workers are idle using one session clock. */
export class UploadWorkerActivity {
  private started = false;
  private idleSince: number | null = null;
  private completedIdleMs = 0;
  private active = 0;
  private peak = 0;
  constructor(private readonly now: () => number = Date.now) {}
  get activeCount(): number { return this.active; }
  get peakCount(): number { return this.peak; }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.idleSince = this.now();
  }
  busy(): number {
    if (this.active === 0 && this.idleSince !== null) {
      this.completedIdleMs += Math.max(0, this.now() - this.idleSince);
      this.idleSince = null;
    }
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    return this.active;
  }
  idle(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.started && this.active === 0) this.idleSince = this.now();
  }
  idleMilliseconds(now = this.now()): number {
    return this.completedIdleMs + (this.started && this.active === 0 && this.idleSince !== null
      ? Math.max(0, now - this.idleSince) : 0);
  }
}
