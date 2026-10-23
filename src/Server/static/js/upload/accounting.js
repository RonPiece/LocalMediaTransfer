/** Pure run accounting. Mixed into the single controller; no state store or DOM. */
const lmtRunAccounting = {
    /** @this {RunAccountingOwner} @param {TransferFile} file @param {number} loadedBytes */
    updateFileTransferProgress(file, loadedBytes) {
        const fileSize = Number(file?.size) || Number(file?.file?.size) || 0;
        const safeLoaded = Number.isFinite(loadedBytes)
            ? Math.max(0, Math.min(loadedBytes, fileSize))
            : 0;
        const previousUploaded = Number(file.uploadedBytes) || 0;
        const previousCompleted = Number(file.completedBytes) || 0;
        const nextUploaded = Math.max(previousUploaded, safeLoaded);
        const nextCompleted = Math.max(previousCompleted, safeLoaded);
        const uploadDelta = Math.max(0, nextUploaded - previousUploaded);
        const completedDelta = Math.max(0, nextCompleted - previousCompleted);
        if (uploadDelta > 0) {
            this.globalUploadedBytes += uploadDelta;
            this.networkBytesUploaded = this.globalUploadedBytes;
        }
        if (completedDelta > 0) {
            this.globalCompletedBytes += completedDelta;
        }
        file.uploadedBytes = nextUploaded;
        file.completedBytes = nextCompleted;
        return { uploadDelta, completedDelta };
    },
    /** @this {RunAccountingOwner} @param {TransferFile} file @param {number} completedBytes */
    markFileCompletedWithoutUpload(file, completedBytes) {
        const fileSize = Number(file?.size) || Number(file?.file?.size) || 0;
        const safeCompleted = Number.isFinite(completedBytes)
            ? Math.max(0, Math.min(completedBytes, fileSize))
            : fileSize;
        const previousCompleted = Number(file.completedBytes) || 0;
        const completedDelta = Math.max(0, safeCompleted - previousCompleted);
        if (completedDelta > 0) {
            this.globalCompletedBytes += completedDelta;
        }
        file.completedBytes = safeCompleted;
        file.uploadedBytes = Number(file.uploadedBytes) || 0;
        return completedDelta;
    },
    /** @this {RunAccountingOwner} @param {TransferFile} file @param {number} acknowledgedBytes */
    recordFileAcknowledgement(file, acknowledgedBytes) {
        const previous = file.acknowledgedBytes || 0;
        const next = Math.min(file.size, Math.max(previous, Number.isFinite(acknowledgedBytes) ? acknowledgedBytes : previous));
        file.acknowledgedBytes = next;
        this.throughput?.recordAcknowledgement(next - previous);
    },
    /** @this {RunAccountingOwner} */
    getTimingSummary() {
        const timing = this.fileQueue.reduce((summary, file) => {
            const value = file.transferTiming;
            if (!value)
                return summary;
            summary.requestCount += value.requestCount || 0;
            summary.requestDurationMs += value.requestDurationMs || 0;
            summary.serverDurationMs += value.serverDurationMs || 0;
            summary.serverWriteDurationMs += value.serverWriteDurationMs || 0;
            summary.serverFinalizeDurationMs += value.serverFinalizeDurationMs || 0;
            summary.maxRequestDurationMs = Math.max(summary.maxRequestDurationMs, value.maxRequestDurationMs || 0);
            return summary;
        }, {
            requestCount: 0,
            requestDurationMs: 0,
            serverDurationMs: 0,
            serverWriteDurationMs: 0,
            serverFinalizeDurationMs: 0,
            maxRequestDurationMs: 0
        });
        return Object.fromEntries(Object.entries(timing).map(([key, value]) => [
            key,
            Number.isFinite(value) ? Math.round(value * 10) / 10 : 0
        ]));
    },
    /** @this {RunAccountingOwner} @param {Pick<TransferSummary, 'outcome'|'uploaded'|'skipped'|'failed'|'retryable'|'totalDurationMs'>} summary */
    finishSummary(summary) {
        this.summary = Object.freeze({ ...summary, selectedBytes: this.totalBytes,
            preparationDurationMs: this.checkDurationMs, uploadDurationMs: this.uploadDurationMs,
            acknowledgedMediaBytes: this.completionRates?.acknowledgedMediaBytes || 0,
            averageMediaBytesPerSecond: this.completionRates?.averageMediaBytesPerSecond || 0,
            peakMediaBytesPerSecond: this.completionRates?.peakMediaBytesPerSecond || 0 });
    },
    /** @param {TransferFile} meta @param {number} requestStartedAt @param {XMLHttpRequest} xhr */
    recordRequestTiming(meta, requestStartedAt, xhr) {
        const duration = Date.now() - requestStartedAt;
        const requestDurationMs = Number.isFinite(duration)
            ? Math.min(86400000, Math.max(0, duration)) : 0;
        const server = window.UploadWorkers.parseServerTiming(xhr?.getResponseHeader?.('Server-Timing') || '');
        const timing = meta.transferTiming || {
            requestCount: 0,
            requestDurationMs: 0,
            serverDurationMs: 0,
            serverWriteDurationMs: 0,
            serverFinalizeDurationMs: 0,
            maxRequestDurationMs: 0
        };
        timing.requestCount += 1;
        timing.requestDurationMs += requestDurationMs;
        timing.serverDurationMs += server.app || 0;
        timing.serverWriteDurationMs += server.write || 0;
        timing.serverFinalizeDurationMs += server.finalize || 0;
        timing.maxRequestDurationMs = Math.max(timing.maxRequestDurationMs, requestDurationMs);
        meta.transferTiming = timing;
    },
};
window.TransferAccounting = lmtRunAccounting;
