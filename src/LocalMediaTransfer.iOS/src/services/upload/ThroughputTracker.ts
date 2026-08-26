type ThroughputSample = {
  acknowledgedAt: number;
  mediaBytes: number;
  encodedBytes: number;
};

const BYTES_PER_MB = 1_000_000;

export class ThroughputTracker {
  private readonly samples: ThroughputSample[] = [];
  private firstActiveSampleIndex = 0;
  private activeMediaBytes = 0;
  private activeEncodedBytes = 0;
  private uploadedMediaBytes = 0;
  private acknowledgedEncodedBytes = 0;
  private peakMediaMBps = 0;

  constructor(
    private readonly startedAt: number,
    private readonly windowMs = 5000,
  ) {}

  recordAcknowledgement(mediaBytes: number, encodedBytes: number, now = Date.now()) {
    this.uploadedMediaBytes += mediaBytes;
    this.acknowledgedEncodedBytes += encodedBytes;
    this.activeMediaBytes += mediaBytes;
    this.activeEncodedBytes += encodedBytes;
    this.samples.push({ acknowledgedAt: now, mediaBytes, encodedBytes });
    const cutoff = now - this.windowMs;
    while (
      this.firstActiveSampleIndex < this.samples.length &&
      this.samples[this.firstActiveSampleIndex].acknowledgedAt <= cutoff
    ) {
      this.activeMediaBytes -= this.samples[this.firstActiveSampleIndex].mediaBytes;
      this.activeEncodedBytes -= this.samples[this.firstActiveSampleIndex].encodedBytes;
      this.firstActiveSampleIndex++;
    }
    if (this.firstActiveSampleIndex > 1024 && this.firstActiveSampleIndex > this.samples.length / 2) {
      this.samples.splice(0, this.firstActiveSampleIndex);
      this.firstActiveSampleIndex = 0;
    }

    const elapsedSeconds = Math.max(0.001, (now - this.startedAt) / 1000);
    const windowSeconds = Math.max(0.001, Math.min(this.windowMs / 1000, elapsedSeconds));
    const currentMediaMBps = this.activeMediaBytes / BYTES_PER_MB / windowSeconds;
    this.peakMediaMBps = Math.max(this.peakMediaMBps, currentMediaMBps);
    return {
      currentMediaMBps,
      averageMediaMBps: this.uploadedMediaBytes / BYTES_PER_MB / elapsedSeconds,
      peakMediaMBps: this.peakMediaMBps,
      currentEncodedMBps: this.activeEncodedBytes / BYTES_PER_MB / windowSeconds,
      uploadedMediaBytes: this.uploadedMediaBytes,
      acknowledgedEncodedBytes: this.acknowledgedEncodedBytes,
    };
  }
}
