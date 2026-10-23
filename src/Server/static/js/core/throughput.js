/** Session-owned acknowledged-media rates, following the mobile rolling tracker.
 * Sending progress is deliberately independent of receiver acknowledgements.
 */
class BrowserThroughputTracker {
    /** @param {number} startedAt @param {number} chunkBytes @param {() => number} now */
    constructor(startedAt, chunkBytes, now = () => performance.now()) {
        this.now = now;
        this.startedAt = startedAt;
        this.lastTime = startedAt;
        this.chunkBytes = chunkBytes;
        this.windowMs = 5000;
        /** @type {{ at: number, bytes: number }[]} */
        this.samples = [];
        this.first = 0;
        this.activeBytes = 0;
        this.acknowledgedMediaBytes = 0;
        this.currentMediaBytesPerSecond = 0;
        this.peakMediaBytesPerSecond = 0;
        /** @type {number | null} */
        this.sampledAt = null;
        /** @type {number | null} */
        this.finishedAt = null;
    }

    time() {
        this.lastTime = Math.max(this.lastTime, this.now());
        return this.lastTime;
    }

    /** @param {number} bytes */
    recordAcknowledgement(bytes) {
        if (this.finishedAt !== null || !Number.isFinite(bytes) || bytes <= 0) return;
        const at = this.time();
        this.acknowledgedMediaBytes += bytes;
        this.activeBytes += bytes;
        this.samples.push({ at, bytes });
        while (this.first < this.samples.length && this.samples[this.first].at <= at - this.windowMs) {
            this.activeBytes -= this.samples[this.first++].bytes;
        }
        if (this.first > 1024 && this.first > this.samples.length / 2) {
            this.samples.splice(0, this.first);
            this.first = 0;
        }
        const seconds = Math.max(0.001, Math.min(this.windowMs, at - this.startedAt) / 1000);
        this.currentMediaBytesPerSecond = this.activeBytes / seconds;
        this.peakMediaBytesPerSecond = Math.max(this.peakMediaBytesPerSecond, this.currentMediaBytesPerSecond);
        this.sampledAt = at;
    }

    snapshot() {
        const at = this.finishedAt ?? this.time();
        // As on mobile, hold the latest rolling acknowledgement sample through
        // two slow chunk intervals, then expose zero rather than a phantom rate.
        const staleAfter = Math.max(5000, Math.min(30000,
            2 * this.chunkBytes / Math.max(1, this.currentMediaBytesPerSecond) * 1000));
        const fresh = this.finishedAt === null && this.sampledAt !== null && at - this.sampledAt <= staleAfter;
        return Object.freeze({
            currentMediaBytesPerSecond: fresh ? this.currentMediaBytesPerSecond : 0,
            averageMediaBytesPerSecond: this.acknowledgedMediaBytes / Math.max(0.001, (at - this.startedAt) / 1000),
            peakMediaBytesPerSecond: this.peakMediaBytesPerSecond,
            acknowledgedMediaBytes: this.acknowledgedMediaBytes,
            sampledAt: this.sampledAt
        });
    }

    finish() {
        this.finishedAt ??= this.time();
        const summary = this.snapshot();
        this.samples = [];
        this.first = 0;
        this.activeBytes = 0;
        return summary;
    }
}
window.BrowserThroughputTracker = BrowserThroughputTracker;
