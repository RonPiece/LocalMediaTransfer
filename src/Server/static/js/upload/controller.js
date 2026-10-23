/**
 * Single owner of selection, run lifecycle, file outcomes and counters.
 */
const lmtController = {
    ...lmtRunAccounting,
    // Configuration
    UPLOAD_URL: '/upload_single',
    UPLOAD_CHUNK_URL: '/upload_chunk',
    CONCURRENCY: 4,
    SINGLE_FILE_MAX_BYTES: window.TransferLimits.WholeFileBytes,
    chunkSizeBytes: 16 * 1024 * 1024,
    configReady: Promise.resolve(),
    CONFIG_TIMEOUT_MS: 10000,
    isMobile: window.Utils?.isMobileLike?.() ??
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    // State variables
    /** @type {TransferFile[]} */
    fileQueue: [],
    running: 0,
    successCount: 0,
    errorCount: 0,
    totalBytes: 0,
    /** @type {number | null} */
    startTime: null,
    currentMediaBytesPerSecond: 0,
    lastSpeedReportTs: 0,
    /** @type {number | null} */
    speedInterval: null,
    /** @type {number | null} */
    stallWatchInterval: null,
    /** @type {number | null} */
    totalTimerInterval: null,
    lastProgressTs: 0,
    /** @type {string | null} */
    sessionId: null,
    logSequence: 0,
    isUploadInProgress: false,
    checkDurationMs: 0,
    uploadDurationMs: 0,
    skippedBytes: 0,
    skippedCount: 0,
    networkBytesUploaded: 0,
    peakSpeedBytesPerSecond: 0,
    retryCount: 0,
    /** @type {BrowserThroughputTracker | null} */
    throughput: null,
    /** @type {ReturnType<BrowserThroughputTracker['snapshot']> | null} */
    completionRates: null,
    currentPhase: 'idle',
    nextUploadIndex: 0,
    pendingCount: 0,
    globalUploadedBytes: 0,
    globalCompletedBytes: 0,
    /** @type {BrowserSelection | null} */
    selection: null,
    /** @type {TransferSummary | null} */
    summary: null,
    /** @type {TransferFile | null} */
    activityFile: null,
    revision: 0,
    /** @returns {Readonly<TransferRunSnapshot>} */
    getSnapshot() {
        return Object.freeze({ phase: this.currentPhase, active: this.isUploadInProgress,
            selectedFiles: this.fileQueue.length, selectedBytes: this.totalBytes,
            selectionPending: this.selection?.pending || 0, summary: this.summary,
            activeFiles: this.running,
            activity: this.activityFile ? Object.freeze({
                id: this.activityFile.id, file: this.activityFile.file, name: this.activityFile.name,
                size: this.activityFile.size, done: this.activityFile.done, failed: this.activityFile.failed,
                skipped: this.activityFile.skipped, preflightSkipped: this.activityFile.preflightSkipped,
                serverResult: this.activityFile.serverResult && { ...this.activityFile.serverResult },
                presentation: Object.freeze({ ...this.activityFile.presentation })
            }) : null,
            counts: { uploaded: this.successCount - this.skippedCount, skipped: this.skippedCount, failed: this.errorCount } });
    },
    init() {
        this.sessionId = this.createSessionId();
        this.selection = new window.BrowserSelection();
        window.TransferView.bind(this);
        this.configReady = this.loadServerConfig();
        // SecurityManager is initialized by app.js before this module. Its
        // initialization is idempotent for direct/legacy callers.
        this.initTokenHandling();
        this.installRuntimeTelemetry();
        this.logClientEvent('INFO', 'ui_initialized', 'Upload manager initialized', {
            frontendVersion: window.LMT_FRONTEND_VERSION || 'unknown',
            iosLike: window.Utils?.isIOSLike?.() || false,
            mobile: this.isMobile
        });
    },
    installRuntimeTelemetry() {
        const connection = document.getElementById('connectionNotice');
        window.addEventListener('offline', () => {
            if (connection) {
                connection.hidden = false;
                connection.textContent = window.I18n?.t('connection.offline') || 'Connection unavailable. Waiting for the network.';
            }
            this.logClientEvent('WARN', 'network_offline', 'Browser reported offline state');
        });
        window.addEventListener('online', () => {
            if (connection)
                connection.hidden = true;
            this.logClientEvent('INFO', 'network_online', 'Browser reported online state');
        });
    },
    startStallWatchdog() {
        if (this.stallWatchInterval) {
            clearInterval(this.stallWatchInterval);
        }
        this.lastProgressTs = Date.now();
        this.stallWatchInterval = setInterval(() => {
            if (this.running === 0) {
                return;
            }
            const idleMs = Date.now() - this.lastProgressTs;
            if (idleMs > 45000) {
                this.logClientEvent('WARN', 'stall_detected', 'No upload progress detected for 45s while workers active', {
                    running: this.running,
                    pending: this.pendingCount,
                    idleMs
                });
                this.lastProgressTs = Date.now();
            }
        }, 5000);
    },
    stopStallWatchdog() {
        if (this.stallWatchInterval) {
            clearInterval(this.stallWatchInterval);
            this.stallWatchInterval = null;
        }
    },
    createSessionId() {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    },
    /** @param {string} level @param {string} event @param {string} message @param {Record<string, unknown>} data */
    async logClientEvent(level, event, message, data = {}) {
        return window.TransferTelemetry?.logClientEvent(this, level, event, message, data);
    },
    /** @param {number} bytesPerSecond @param {boolean} force */
    reportSpeedSample(bytesPerSecond, force = false) {
        return window.TransferTelemetry?.reportSpeedSample(this, bytesPerSecond, force);
    },
    getCurrentSpeedForDisplay() {
        return this.throughput?.snapshot().currentMediaBytesPerSecond || 0;
    },
    publishThroughput() {
        const rates = this.throughput?.snapshot();
        this.currentMediaBytesPerSecond = rates?.currentMediaBytesPerSecond || 0;
        this.peakSpeedBytesPerSecond = rates?.peakMediaBytesPerSecond || 0;
        window.ProgressTracker.updateCurrentSpeedDisplay(this.currentMediaBytesPerSecond);
        this.reportSpeedSample(this.currentMediaBytesPerSecond);
        this.refreshOverallProgress();
        window.FileListView?.changed();
    },
    async loadServerConfig() {
        const fallback = this.isMobile
            ? { chunkSizeBytes: 8 * 1024 * 1024, parallelFiles: 2 }
            : { chunkSizeBytes: 16 * 1024 * 1024, parallelFiles: 3 };
        this.chunkSizeBytes = fallback.chunkSizeBytes;
        this.CONCURRENCY = fallback.parallelFiles;
        this.SINGLE_FILE_MAX_BYTES = window.TransferLimits.WholeFileBytes;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.CONFIG_TIMEOUT_MS);
        try {
            const res = await fetch('/config', { signal: controller.signal });
            if (!res.ok) {
                return;
            }
            const cfg = await res.json();
            const defaultSingle = this.SINGLE_FILE_MAX_BYTES;
            const boundedInteger = window.TransferContracts.boundedInteger;
            this.SINGLE_FILE_MAX_BYTES = boundedInteger(cfg?.shared?.singleFileMaxBytes, defaultSingle, defaultSingle);
            const browserConfig = this.isMobile
                ? (cfg?.browser?.mobile || cfg?.mobile)
                : (cfg?.browser?.desktop || cfg?.desktop);
            this.chunkSizeBytes = boundedInteger(browserConfig?.chunkSizeBytes, window.TransferLimits.MaxChunkBytes, fallback.chunkSizeBytes);
            this.CONCURRENCY = boundedInteger(browserConfig?.parallelFiles, 6, fallback.parallelFiles);
        }
        catch (error) {
        }
        finally {
            clearTimeout(timeout);
        }
    },
    async initTokenHandling() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        await window.SecurityManager.init?.();
        const token = window.SecurityManager.token;
        if (!token || !window.SecurityManager.isValid) {
            const invalid = window.SecurityManager.failureReason === 'invalid';
            this.logClientEvent('WARN', invalid ? 'access_link_invalid' : 'access_link_missing', invalid ? 'One-time access link rejected' : 'One-time access link missing');
            window.SecurityManager.disableControls();
            return;
        }
        this.logClientEvent('INFO', 'token_valid', 'Token accepted by server');
    },
    /** @param {FileList | File[]} files */
    addFiles(files) {
        if (this.isUploadInProgress) {
            this.logClientEvent('WARN', 'queue_mutation_blocked', 'Selection ignored during upload');
            return false;
        }
        if (window.TransferSession && window.TransferSession.state !== 'ready')
            return false;
        if (!this.selection)
            this.selection = new window.BrowserSelection();
        this.summary = null;
        const revision = this.revision;
        const job = this.selection.add(files, file => {
            const size = file.size;
            this.fileQueue.push({ id: window.Utils.generateFileId(), file, name: file.name, size,
                running: false, done: false, failed: false, retryable: false,
                acknowledgedBytes: 0, uploadedBytes: 0, completedBytes: 0,
                presentation: { percent: 0, text: window.I18n?.t('file.queued') || 'Queued', state: 'queued', labelKey: 'file.queued' } });
            this.totalBytes += size;
        }, () => {
            window.FileListView?.setFiles(this.fileQueue);
            window.ProgressTracker.updateStatsUI(this.fileQueue, this.successCount, this.errorCount, this.totalBytes);
            window.TransferSession?.renderControls();
        });
        window.TransferSession?.renderControls();
        return job.catch(() => {
            if (revision !== this.revision)
                return;
            this.logClientEvent('WARN', 'selection_read_failed', 'Some selection metadata was unavailable');
            window.TransferView?.selectionError();
        });
    },
    async uploadFiles() {
        if (this.selection?.pending || this.isUploadInProgress) {
            this.logClientEvent('WARN', 'upload_reentry_blocked', 'Upload clicked while upload already in progress');
            return;
        }
        if (window.TransferSession && window.TransferSession.state !== 'ready')
            return;
        if (!this.fileQueue.length) {
            window.Modals.showNoFilesModal();
            this.logClientEvent('WARN', 'upload_requested_no_files', 'Upload clicked with empty queue');
            return;
        }
        // Own the queue before the first await: clicks, drop and Reset must all
        // remain blocked while the receiver configuration is loading.
        this.summary = null;
        ++this.revision;
        this.activityFile = null;
        this.isUploadInProgress = true;
        this.setUploadUiState(true);
        try {
            await this.configReady;
        }
        catch {
            this.isUploadInProgress = false;
            this.setUploadUiState(false);
            return;
        }
        const failedDoneFiles = this.fileQueue.filter(f => f.done && f.failed && f.retryable !== false);
        failedDoneFiles.forEach((file) => {
            file.done = false;
            file.running = false;
            file.uploadedBytes = 0;
            file.completedBytes = 0;
            file.acknowledgedBytes = 0;
            this.presentFile(file, { state: 'queued', percent: 0, labelKey: 'file.queued' });
        });
        if (this.fileQueue.every(file => file.done)) {
            this.isUploadInProgress = false;
            this.setUploadUiState(false);
            window.Modals.showAlreadyUploadedModal();
            return;
        }
        this.sessionId = this.createSessionId();
        this.logSequence = 0;
        this.lastSpeedReportTs = 0;
        const runStartedAt = Date.now();
        this.startTime = runStartedAt;
        this.currentMediaBytesPerSecond = 0;
        this.checkDurationMs = 0;
        this.uploadDurationMs = 0;
        this.skippedBytes = 0;
        this.networkBytesUploaded = 0;
        this.peakSpeedBytesPerSecond = 0;
        this.retryCount = 0;
        this.globalUploadedBytes = 0;
        this.throughput = null;
        this.completionRates = null;
        this.globalCompletedBytes = this.fileQueue.reduce((sum, file) => sum + (file.done && !file.failed ? file.size : 0), 0);
        this.nextUploadIndex = 0;
        this.pendingCount = this.fileQueue.reduce((count, file) => count + (file.done ? 0 : 1), 0);
        this.setRunPhase('checking', window.I18n?.t('phase.checking') || 'Checking existing files...');
        this.logClientEvent('INFO', 'upload_started', 'Upload run started', {
            queuedFiles: this.pendingCount,
            totalQueuedBytes: this.totalBytes,
            concurrency: this.CONCURRENCY
        });
        try {
            if (this.totalTimerInterval)
                clearInterval(this.totalTimerInterval);
            this.totalTimerInterval = setInterval(() => {
                const elapsed = (Date.now() - runStartedAt) / 1000;
                window.TransferView?.elapsed(elapsed, this.getPhaseLabel());
            }, 1000);
            const checkStartedAt = Date.now();
            try {
                const preflight = await window.DuplicatePreflight.run(this.fileQueue, this.preflightObserver());
                this.skippedBytes = preflight.skippedBytes;
                this.globalCompletedBytes = Math.max(this.globalCompletedBytes, this.skippedBytes);
                this.successCount += preflight.skippedFiles;
                this.skippedCount += preflight.skippedFiles;
                window.ProgressTracker.updateStatsUI(this.fileQueue, this.successCount, this.errorCount, this.totalBytes);
                this.refreshOverallProgress();
            }
            catch (cause) {
                const error = window.TransferContracts.error(cause);
                if (error?.status === 401 || error?.status === 403) {
                    window.TransferSession?.authenticationLost();
                    throw error;
                }
                this.logClientEvent('WARN', 'preflight_fallback', 'Duplicate preflight failed; uploading normally', { error: error?.message || 'unknown' });
                this.fileQueue
                    .filter(file => !file.done)
                    .forEach(file => this.presentFile(file, { state: 'queued', percent: 0, labelKey: 'file.ready' }));
            }
            this.checkDurationMs = Date.now() - checkStartedAt;
            this.pendingCount = this.fileQueue.reduce((count, file) => count + (file.done ? 0 : 1), 0);
            this.nextUploadIndex = 0;
            const uploadStartedAt = Date.now();
            this.throughput = new window.BrowserThroughputTracker(performance.now(), this.chunkSizeBytes);
            const hasPendingUploads = this.pendingCount > 0;
            if (hasPendingUploads) {
                this.setRunPhase('uploading', window.I18n?.t('phase.uploading') || 'Uploading files...');
                this.startStallWatchdog();
                if (this.speedInterval)
                    clearInterval(this.speedInterval);
                this.speedInterval = setInterval(() => {
                    this.publishThroughput();
                }, 500);
                const workers = [];
                for (let i = 0; i < this.CONCURRENCY; i++) {
                    workers.push(this.worker());
                }
                await Promise.all(workers);
            }
            this.uploadDurationMs = Date.now() - uploadStartedAt;
            this.completionRates = this.throughput.finish();
            this.peakSpeedBytesPerSecond = this.completionRates.peakMediaBytesPerSecond;
            this.settleUnfinishedFiles();
            this.refreshOverallProgress();
            this.setRunPhase('verifying', window.I18n?.t('phase.verifying') || 'Finalizing results...');
            const totalDurationMs = Date.now() - runStartedAt;
            // Optional work cannot hold terminal UI or unlock a later run.
            void this.submitTransferHistory(totalDurationMs);
            const processed = this.fileQueue.filter(file => file.done && !file.failed);
            const skipped = processed.filter(file => file.preflightSkipped || file.skipped).length;
            const failed = this.fileQueue.filter(file => file.failed || !file.done).length;
            const retryable = this.fileQueue.filter(file => file.failed && file.retryable).length;
            const blocked = window.TransferSession?.state === 'blocked';
            this.setRunPhase('complete', window.I18n?.t('phase.complete') || 'Complete');
            this.finishSummary({
                outcome: blocked ? 'blocked' : failed ? (processed.length ? 'mixed' : 'failed') : 'complete',
                uploaded: processed.length - skipped, skipped, failed, retryable, totalDurationMs
            });
            this.logClientEvent('INFO', 'upload_finished', 'Upload run finished', {
                successCount: this.successCount,
                errorCount: this.errorCount,
                queueSize: this.fileQueue.length,
                skippedBytes: this.skippedBytes,
                uploadedBytes: this.networkBytesUploaded,
                timing: this.getTimingSummary()
            });
        }
        catch (error) {
            this.completionRates ??= this.throughput?.finish() ?? null;
            this.settleUnfinishedFiles();
            this.setRunPhase('failed', window.I18n?.t('result.failedTitle') || 'Transfer failed');
            const blocked = window.TransferSession?.state === 'blocked';
            const completed = this.fileQueue.filter(file => file.done && !file.failed);
            const skipped = completed.filter(file => file.skipped || file.preflightSkipped).length;
            this.finishSummary({ outcome: blocked ? 'blocked' : completed.length ? 'mixed' : 'failed', uploaded: completed.length - skipped, skipped,
                failed: this.fileQueue.length - completed.length, retryable: 0, totalDurationMs: Date.now() - runStartedAt });
        }
        finally {
            this.completionRates ??= this.throughput?.finish() ?? null;
            window.DuplicatePreflight?.dispose?.();
            if (this.totalTimerInterval) {
                clearInterval(this.totalTimerInterval);
                this.totalTimerInterval = null;
            }
            if (this.speedInterval) {
                clearInterval(this.speedInterval);
                this.speedInterval = null;
            }
            this.stopStallWatchdog();
            this.reportSpeedSample(0, true);
            this.currentMediaBytesPerSecond = 0;
            window.ProgressTracker.updateCurrentSpeedDisplay(0);
            this.startTime = null;
            this.isUploadInProgress = false;
            this.setUploadUiState(false);
        }
    },
    /** @param {number} totalDurationMs */
    async submitTransferHistory(totalDurationMs) {
        return window.TransferTelemetry?.submitTransferHistory(this, totalDurationMs);
    },
    async worker() {
        while (true) {
            if (window.TransferSession?.state === 'blocked')
                break;
            let next = null;
            while (this.nextUploadIndex < this.fileQueue.length) {
                const candidate = this.fileQueue[this.nextUploadIndex++];
                if (!candidate || candidate.running || candidate.done) {
                    continue;
                }
                next = candidate;
                break;
            }
            if (!next) {
                break;
            }
            next.running = true;
            this.running++;
            try {
                await window.UploadWorkers.uploadSingle(next, this);
            }
            finally {
                next.running = false;
                this.running--;
                window.TransferView?.scheduleActivity();
                window.FileListView?.changed();
                if (next.done) {
                    this.pendingCount = Math.max(0, this.pendingCount - 1);
                }
            }
        }
    },
    resetFiles() {
        if (this.isUploadInProgress) {
            this.logClientEvent('WARN', 'queue_reset_blocked', 'Reset ignored while upload is in progress');
            return;
        }
        window.TransferSession?.reset();
        this.revision++;
        this.activityFile = null;
        window.TransferView?.resetActivity();
        this.selection?.reset();
        this.summary = null;
        window.TransferView?.clearSelectionError();
        window.MediaPreviews?.reset();
        window.FileListView?.reset();
        window.ProgressTracker.reset?.();
        window.DuplicatePreflight.dispose?.();
        try {
            Promise.resolve(window.uploadCacheManager?.performCleanup?.()).catch(() => { });
        }
        catch { }
        this.fileQueue = [];
        this.running = 0;
        this.successCount = 0;
        this.errorCount = 0;
        this.totalBytes = 0;
        this.currentMediaBytesPerSecond = 0;
        this.startTime = null;
        this.checkDurationMs = 0;
        this.uploadDurationMs = 0;
        this.skippedBytes = 0;
        this.skippedCount = 0;
        this.networkBytesUploaded = 0;
        this.peakSpeedBytesPerSecond = 0;
        this.retryCount = 0;
        this.throughput = null;
        this.completionRates = null;
        this.currentPhase = 'idle';
        this.nextUploadIndex = 0;
        this.pendingCount = 0;
        this.globalUploadedBytes = 0;
        this.globalCompletedBytes = 0;
        if (this.speedInterval) {
            clearInterval(this.speedInterval);
            this.speedInterval = null;
        }
        if (this.totalTimerInterval) {
            clearInterval(this.totalTimerInterval);
            this.totalTimerInterval = null;
        }
        this.stopStallWatchdog();
        window.TransferView?.elapsed(0, '');
        window.ProgressTracker.updateStatsUI(this.fileQueue, this.successCount, this.errorCount, this.totalBytes);
        this.refreshOverallProgress();
        window.TransferSession?.renderControls();
        this.logClientEvent('INFO', 'queue_reset', 'Upload queue reset by user');
    },
    /** @param {string} phase @param {string} label */
    setRunPhase(phase, label) {
        this.currentPhase = phase;
        window.TransferView?.phase(label);
        window.TransferView?.renderActivity(this.getSnapshot());
    },
    getPhaseLabel() {
        switch (this.currentPhase) {
            case 'checking': return window.I18n?.t('phase.checking') || 'Checking existing files...';
            case 'uploading': return window.I18n?.t('phase.uploading') || 'Uploading files...';
            case 'verifying': return window.I18n?.t('phase.verifying') || 'Finalizing results...';
            case 'complete': return window.I18n?.t('phase.complete') || 'Complete';
            default: return window.I18n?.t('phase.ready') || 'Ready';
        }
    },
    /** @param {boolean} isUploading */
    setUploadUiState(isUploading) {
        if (window.TransferSession) {
            window.TransferSession.renderControls();
            return;
        }
    },
    /** @param {TransferFile} meta @returns {TransportContext} */
    transportObserver(meta) {
        const revision = this.revision;
        const live = () => revision === this.revision && this.isUploadInProgress;
        return {
            UPLOAD_URL: this.UPLOAD_URL, UPLOAD_CHUNK_URL: this.UPLOAD_CHUNK_URL,
            SINGLE_FILE_MAX_BYTES: this.SINGLE_FILE_MAX_BYTES, chunkSizeBytes: this.chunkSizeBytes,
            updateFileTransferProgress: (_file, bytes) => live() ? this.updateFileTransferProgress(meta, bytes) : { uploadDelta: 0, completedDelta: 0 },
            recordFileAcknowledgement: (_file, bytes) => { if (live())
                this.recordFileAcknowledgement(meta, bytes); },
            onActivity: () => { if (live())
                this.lastProgressTs = Date.now(); },
            onSending: (percent, waiting) => {
                if (!live())
                    return;
                const labelKey = waiting ? 'file.waitingForReceiver' : '';
                this.presentFile(meta, { labelKey, percent, text: waiting ? window.I18n.t(labelKey) : `${percent}%` });
            },
            onRetry: (attempt, index, error) => {
                if (!live())
                    return;
                this.retryCount++;
                this.presentFile(meta, { labelKey: 'file.retrying', labelValues: { attempt } });
                this.logClientEvent('WARN', 'chunk_retry', 'Retrying chunk upload', { chunkIndex: index, attempt, errorType: error.name });
            },
            onTiming: (started, xhr) => { if (live())
                window.UploadWorkers.recordRequestTiming(meta, started, xhr); }
        };
    },
    /** @returns {PreflightObserver} */
    preflightObserver() {
        const revision = this.revision;
        return {
            onChecking: (file, key) => {
                if (revision !== this.revision)
                    return;
                this.presentFile(file, { labelKey: key, percent: 0 });
            },
            onDecision: (file, result) => {
                if (revision !== this.revision)
                    return;
                if (result?.action === 'skip') {
                    if (file.failed)
                        this.errorCount = Math.max(0, this.errorCount - 1);
                    file.failed = false;
                    file.retryable = false;
                    delete file.failure;
                    file.done = file.skipped = file.preflightSkipped = true;
                    file.uploadedBytes = 0;
                    file.serverResult = { skipped: true, filename: result.filename };
                    this.markFileCompletedWithoutUpload(file, file.size);
                    this.presentFile(file, { state: 'skipped', percent: 100, labelKey: result.filename && result.filename !== file.name ? 'file.existingAs' : 'file.skipped', labelValues: { name: result.filename || file.name } });
                }
                else {
                    const key = result?.action === 'upload_name_conflict' ? 'file.conflict' : 'file.ready';
                    this.presentFile(file, { state: 'queued', percent: 0, labelKey: key });
                }
            }
        };
    },
    /** Freeze files that could not be claimed after a terminal/authentication stop. */
    settleUnfinishedFiles() {
        for (const file of this.fileQueue) {
            if (file.done) continue;
            file.done = file.failed = true;
            file.retryable = false;
            this.errorCount++;
            this.presentFile(file, { state: 'error', labelKey: 'file.notSent' });
        }
    },
    /** Domain presentation is updated before best-effort DOM work. Rendering must never change an acknowledged outcome.
     * @param {TransferFile} file @param {Partial<FilePresentation>} patch */
    presentFile(file, patch) {
        file.presentation = { ...(file.presentation || { percent: 0, text: '', state: 'queued' }), ...patch };
        if (file.presentation.labelKey)
            file.presentation.text = window.I18n.t(file.presentation.labelKey, file.presentation.labelValues || {});
        // Follow one file before the first outcome, then retain the most recent
        // outcome. Progress from parallel files must not rotate this row.
        if (!this.activityFile || (patch.state && patch.state !== 'queued')) this.activityFile = file;
        try {
            window.ProgressTracker.renderSnapshot?.(file);
            window.TransferView?.scheduleActivity();
        }
        catch {
            void this.logClientEvent('WARN', 'file_render_failed', 'File presentation could not refresh');
        }
    },
    /** @param {TransferFile} meta */
    async processFile(meta) {
        const manager = this;
        const transport = window.UploadWorkers;
        let wasFailedBefore = false;
        try {
            wasFailedBefore = !!meta.failed;
            meta.failed = false;
            meta.acknowledgedBytes = 0;
            meta.uploadedBytes = 0;
            meta.completedBytes = 0;
            this.presentFile(meta, { state: 'queued', percent: 0, labelKey: 'file.uploading' });
            const performUpload = () => transport.shouldUseChunkedUpload(meta, manager)
                ? transport.uploadChunked(meta, this.transportObserver(meta))
                : transport.uploadWholeFile(meta, this.transportObserver(meta));
            meta.serverResult = await performUpload();
            meta.retryable = false;
            delete meta.failure;
            if (wasFailedBefore && manager.errorCount > 0) {
                manager.errorCount--;
            }
            this.updateFileTransferProgress(meta, meta.size);
            manager.successCount++;
            if (meta.serverResult?.skipped) {
                this.skippedCount++;
                meta.skipped = true;
                const existingName = meta.serverResult.filename || meta.name;
                this.presentFile(meta, { state: 'skipped', percent: 100, labelKey: existingName === meta.name ? 'file.skipped' : 'file.existingAs', labelValues: { name: existingName } });
            }
            else {
                const savedName = meta.serverResult?.filename || meta.name;
                this.presentFile(meta, { state: 'success', percent: 100, labelKey: savedName === meta.name ? 'file.done' : 'file.savedAs', labelValues: { name: savedName } });
                try {
                    window.uploadCacheManager?.trackUpload?.(meta.id, savedName, meta.size);
                }
                catch { }
            }
        }
        catch (cause) {
            const error = window.TransferContracts.error(cause);
            meta.failed = true;
            meta.retryable = window.TransferSession?.state !== 'blocked' && transport.isRetryableUploadError(error);
            meta.failure = { message: error?.message || '', status: Number(error?.status) || 0, retryable: meta.retryable };
            if (!wasFailedBefore) {
                manager.errorCount++;
            }
            this.presentFile(meta, { state: 'error', labelKey: '', text: error?.message || 'Error' });
            manager.logClientEvent('ERROR', 'file_error', 'File upload failed', {
                size: meta.size,
                status: Number(error?.status) || 0,
                errorType: error?.name || 'Error'
            });
        }
        finally {
            meta.done = true;
            meta.running = false;
            try {
                window.ProgressTracker.updateStatsUI(manager.fileQueue, manager.successCount, manager.errorCount, manager.totalBytes);
            }
            catch {
                void this.logClientEvent('WARN', 'stats_render_failed', 'Transfer statistics could not refresh');
            }
        }
    },
    refreshOverallProgress() {
        if (window.ProgressTracker && typeof window.ProgressTracker.updateAggregateProgress === 'function') {
            window.ProgressTracker.updateAggregateProgress(this.globalCompletedBytes, this.totalBytes);
        }
    }
};
window.TransferController = lmtController;
