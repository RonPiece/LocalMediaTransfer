/** Optional best-effort diagnostics. No method changes transfer outcomes. */
const lmtTelemetry = {
    /** @type {WeakMap<object, { sessionId: string, pending: number | null, busy: boolean, terminal: boolean }>} */
    metrics: new WeakMap(),
    /** @type {WeakMap<object, { count: number, tail: Promise<void> }>} */
    events: new WeakMap(),

    async sendOptional(url, payload, token) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Upload-Token': token },
                body: JSON.stringify(payload), signal: controller.signal, keepalive: true
            });
            await response.text?.();
        } catch {} finally { clearTimeout(timeout); }
    },

    async logClientEvent(owner, level, event, message, data = {}) {
        let state = this.events.get(owner);
        if (!state) { state = { count: 0, tail: Promise.resolve() }; this.events.set(owner, state); }
        if (state.count >= 4) return;
        state.count++;
        owner.logSequence += 1;
        const payload = {
            session: owner.sessionId,
            seq: owner.logSequence,
            level,
            event,
            message,
            data,
            ts: new Date().toISOString(),
            path: window.location.pathname
        };

        const token = window.SecurityManager?.token || '';
        // Bound the chain as well as serialize it: a delayed start event must
        // not overtake an admitted finish event and reopen receiver activity.
        state.tail = state.tail.then(() => this.sendOptional('/client_log', payload, token))
            .finally(() => { state.count--; });
        await state.tail;
    },

    reportSpeedSample(owner, bytesPerSecond, force = false) {
        const now = Date.now();
        if (!force && now - owner.lastSpeedReportTs < 1000) {
            return;
        }
        owner.lastSpeedReportTs = now;

        const safeSpeed = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
            ? bytesPerSecond
            : 0;
        let state = this.metrics.get(owner);
        if (!state || state.sessionId !== owner.sessionId) {
            state = { sessionId: owner.sessionId, pending: null, busy: false, terminal: false };
            this.metrics.set(owner, state);
        }
        if (state.terminal) return;
        state.pending = safeSpeed;
        state.terminal = force && safeSpeed === 0;
        if (!state.busy) void this.flushMetrics(state, window.SecurityManager?.token || '');
    },

    async flushMetrics(state, token) {
        state.busy = true;
        try {
            while (state.pending !== null) {
                const bytesPerSecond = state.pending;
                state.pending = null;
                await this.sendOptional('/client_metrics', { sessionId: state.sessionId, bytesPerSecond }, token);
            }
        } finally { state.busy = false; }
    },

    async submitTransferHistory(owner, totalDurationMs) {
        const sessionId = owner.sessionId;
        const queue = owner.fileQueue;
        const uploadedItems = owner.fileQueue.filter(
            file => file.done && !file.failed && !file.preflightSkipped && !file.skipped);
        const skippedItems = owner.fileQueue.filter(
            file => file.preflightSkipped || file.skipped);
        const uploadedBytes = uploadedItems.reduce((total, file) => total + file.size, 0);
        const skippedBytes = skippedItems.reduce((total, file) => total + file.size, 0);
        const averageSpeedMBps = owner.completionRates ? owner.completionRates.averageMediaBytesPerSecond / 1_000_000 : owner.uploadDurationMs > 0
            ? (owner.networkBytesUploaded / 1_000_000) /
                (owner.uploadDurationMs / 1000)
            : 0;
        const payload = {
            sessionId: `${owner.sessionId}-${Date.now()}`,
            completedAt: Date.now(),
            selectedFiles: owner.fileQueue.length,
            uploadedFiles: uploadedItems.length,
            skippedFiles: skippedItems.length,
            failedFiles: owner.fileQueue.filter(file => file.failed || !file.done).length,
            selectedBytes: owner.totalBytes,
            uploadedBytes,
            skippedBytes,
            checkDurationMs: owner.checkDurationMs,
            uploadDurationMs: owner.uploadDurationMs,
            totalDurationMs,
            averageSpeedMBps,
            peakSpeedMBps: owner.peakSpeedBytesPerSecond / 1_000_000,
            retries: owner.retryCount,
            files: owner.fileQueue.map(file => ({
                id: file.id,
                name: file.name,
                savedName: file.serverResult?.filename || file.name,
                size: file.size,
                outcome: file.failed || !file.done
                    ? 'failed'
                    : file.preflightSkipped
                        ? 'skipped'
                        : file.skipped
                            ? 'duplicate_after_upload'
                        : 'uploaded'
            }))
        };
        try {
            const response = await window.lmtFetch('/transfer_history', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Upload-Token': window.SecurityManager?.token || ''
                },
                body: JSON.stringify(payload)
            }, 5000);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            if (owner.sessionId !== sessionId || owner.fileQueue !== queue) return;
            owner.logClientEvent(
                'WARN',
                'history_store_failed',
                'Unable to save transfer history',
                { error: error?.message || 'unknown' });
        }
    },
};
window.TransferTelemetry = lmtTelemetry;
