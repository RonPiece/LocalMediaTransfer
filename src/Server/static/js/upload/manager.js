/**
 * Upload Manager - Main upload logic and queue management
 */

window.UploadManager = {
    // Configuration
    UPLOAD_URL: '/upload_single',
    UPLOAD_CHUNK_URL: '/upload_chunk',
    CONCURRENCY: 4,
    SPEED_WINDOW_MS: 2000,
    AGG_ALPHA: 0.2,
    SINGLE_FILE_MAX_BYTES: 100 * 1024 * 1024,
    chunkSizeBytes: 32 * 1024 * 1024,
    isMobile: window.Utils?.isMobileLike?.() ??
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),

    // State variables
    fileQueue: [],
    running: 0,
    successCount: 0,
    errorCount: 0,
    totalBytes: 0,
    startTime: null,
    displaySpeedEMA: 0,
    lastSpeedReportTs: 0,
    speedInterval: null,
    heartbeatInterval: null,
    stallWatchInterval: null,
    lastProgressTs: 0,
    sessionId: null,
    logSequence: 0,
    isUploadInProgress: false,
    checkDurationMs: 0,
    uploadDurationMs: 0,
    skippedBytes: 0,
    networkBytesUploaded: 0,
    peakSpeedBytesPerSecond: 0,
    retryCount: 0,
    currentPhase: 'idle',
    nextUploadIndex: 0,
    pendingCount: 0,
    globalUploadedBytes: 0,
    globalCompletedBytes: 0,
    activeSpeedSum: 0,
    speedEpoch: 0,

    // DOM elements
    elements: {},

    init() {
        this.sessionId = this.createSessionId();
        this.initElements();
        this.initEventListeners();
        this.loadServerConfig();
        // SecurityManager is initialized by app.js before this module. Its
        // initialization is idempotent for direct/legacy callers.
        this.initTokenHandling();
        this.installRuntimeTelemetry();
        
        // Expose functions globally for compatibility
        window.__fileTransfer = {
            addFiles: this.addFiles.bind(this),
            uploadFiles: this.uploadFiles.bind(this),
            resetFiles: this.resetFiles.bind(this),
            getQueue: () => this.fileQueue
        };
        window.addMoreFiles = () => {
            if (this.isUploadInProgress) return;
            this.elements.fileInput?.click();
        };
        window.resetAndStart = () => {
            if (this.isUploadInProgress) return;
            this.resetFiles();
            this.elements.fileInput?.click();
        };
        window.resetForNewUpload = () => {
            this.resetFiles();
        };

        console.log('Upload manager initialized');
        this.logClientEvent('INFO', 'ui_initialized', 'Upload manager initialized', {
            frontendVersion: window.LMT_FRONTEND_VERSION || 'unknown',
            userAgent: navigator.userAgent,
            platform: navigator.platform || '',
            maxTouchPoints: navigator.maxTouchPoints || 0,
            iosLike: window.Utils?.isIOSLike?.() || false,
            path: window.location.pathname,
            mobile: this.isMobile
        });

        this.startHeartbeat();
    },

    installRuntimeTelemetry() {
        document.addEventListener('visibilitychange', () => {
            this.logClientEvent('INFO', 'visibility_changed', 'Document visibility changed', {
                visibilityState: document.visibilityState,
                hidden: document.hidden
            });
        });

        window.addEventListener('pagehide', () => {
            this.logClientEvent('WARN', 'pagehide', 'Page hidden/unloaded by browser');
        });

        window.addEventListener('offline', () => {
            this.logClientEvent('WARN', 'network_offline', 'Browser reported offline state');
        });

        window.addEventListener('online', () => {
            this.logClientEvent('INFO', 'network_online', 'Browser reported online state');
        });
    },

    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            this.logClientEvent('INFO', 'heartbeat', 'Client heartbeat', {
                running: this.running,
                pending: this.pendingCount,
                successCount: this.successCount,
                errorCount: this.errorCount
            });
        }, 20000);
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

    async logClientEvent(level, event, message, data = {}) {
        this.logSequence += 1;
        const payload = {
            session: this.sessionId,
            seq: this.logSequence,
            level,
            event,
            message,
            data,
            ts: new Date().toISOString(),
            path: window.location.pathname
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (window.SecurityManager?.token) {
                headers['X-Upload-Token'] = window.SecurityManager.token;
            }
            await fetch('/client_log', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                keepalive: true
            });
        } catch (error) {
            console.warn('client_log failed', error);
        }
    },

    reportSpeedSample(bytesPerSecond, force = false) {
        const now = Date.now();
        if (!force && now - this.lastSpeedReportTs < 1000) {
            return;
        }
        this.lastSpeedReportTs = now;

        const safeSpeed = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
            ? bytesPerSecond
            : 0;
        fetch('/client_metrics', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Upload-Token': window.SecurityManager?.token || ''
            },
            body: JSON.stringify({
                sessionId: this.sessionId,
                bytesPerSecond: safeSpeed
            }),
            keepalive: true
        }).catch(() => {});
    },

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

    updateFileSpeed(file, bytesPerSecond) {
        const previousSpeed = file._speedEpoch === this.speedEpoch
            ? Number(file._speed) || 0
            : 0;
        const nextSpeed = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
            ? bytesPerSecond
            : 0;
        file._speed = nextSpeed;
        file._speedEpoch = this.speedEpoch;
        this.activeSpeedSum = Math.max(0, this.activeSpeedSum + nextSpeed - previousSpeed);
        return nextSpeed;
    },

    clearFileSpeed(file) {
        this.updateFileSpeed(file, 0);
    },

    getCurrentSpeedForDisplay() {
        const hasRecentProgress = Date.now() - this.lastProgressTs <= 2000;
        if (!hasRecentProgress && this.activeSpeedSum > 0) {
            this.activeSpeedSum = 0;
            this.speedEpoch += 1;
        }
        return hasRecentProgress ? this.activeSpeedSum : 0;
    },

    async loadServerConfig() {
        try {
            const res = await fetch('/config');
            if (!res.ok) {
                return;
            }

            const cfg = await res.json();
            const defaultSingle = this.SINGLE_FILE_MAX_BYTES;
            const defaultChunk = this.chunkSizeBytes;

            this.SINGLE_FILE_MAX_BYTES = cfg?.shared?.singleFileMaxBytes || defaultSingle;

            if (this.isMobile) {
                this.chunkSizeBytes = cfg?.mobile?.chunkSizeBytes || defaultChunk;
                this.CONCURRENCY = cfg?.mobile?.parallelFiles || this.CONCURRENCY;
            } else {
                this.chunkSizeBytes = cfg?.desktop?.chunkSizeBytes || defaultChunk;
                this.CONCURRENCY = cfg?.desktop?.parallelFiles || this.CONCURRENCY;
            }
        } catch (error) {
            console.warn('Failed to load /config, using defaults', error);
        }
    },

    initElements() {
        this.elements = {
            fileInput: document.getElementById('fileInput'),
            uploadZone: document.getElementById('uploadZone'),
            chooseBtn: document.getElementById('chooseBtn'),
            uploadBtn: document.getElementById('uploadBtn'),
            resetBtn: document.getElementById('resetBtn'),
            progressContainer: document.getElementById('progress'),
            resultsContainer: document.getElementById('results'),
            totalTimerEl: document.getElementById('totalTimer')
        };
    },

    initEventListeners() {
        const { uploadZone, chooseBtn, fileInput, uploadBtn, resetBtn } = this.elements;
        if (!uploadZone || !chooseBtn || !fileInput || !uploadBtn || !resetBtn) {
            console.error('Required upload controls are missing from DOM');
            this.logClientEvent('ERROR', 'ui_controls_missing', 'Required upload controls are missing from DOM');
            return;
        }

        // Drag & drop handlers
        const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadZone.addEventListener(eventName, preventDefaults, false);
        });
        
        uploadZone.addEventListener('dragover', () => uploadZone.classList.add('dragover'));
        ['dragleave', 'drop'].forEach(ev => 
            uploadZone.addEventListener(ev, () => uploadZone.classList.remove('dragover'))
        );

        uploadZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files) this.addFiles(dt.files);
        });

        // File input and buttons
        chooseBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files) this.addFiles(e.target.files);
            fileInput.value = ''; // Reset for re-selection
        });

        uploadBtn.addEventListener('click', () => this.uploadFiles());
        resetBtn.addEventListener('click', () => this.resetFiles());
    },

    async initTokenHandling() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            await new Promise(resolve => 
                document.addEventListener('DOMContentLoaded', resolve, { once: true })
            );
        }

        await window.SecurityManager.init?.();
        const token = window.SecurityManager.token;

        if (!token || !window.SecurityManager.isValid) {
            const invalid = window.SecurityManager.failureReason === 'invalid';
            this.logClientEvent(
                'WARN',
                invalid ? 'access_link_invalid' : 'access_link_missing',
                invalid ? 'One-time access link rejected' : 'One-time access link missing');
            window.SecurityManager.disableControls();
            return;
        }

        this.logClientEvent('INFO', 'token_valid', 'Token accepted by server');
    },

    addFiles(files) {
        if (this.isUploadInProgress) {
            this.logClientEvent('WARN', 'queue_mutation_blocked', 'Files ignored while an upload is in progress');
            return false;
        }

        const arr = Array.from(files);
        if (!arr.length) return false;

        const queueStartIndex = this.fileQueue.length;

        // Group into batches of 100
        const batchSize = 100;
        let groupIndex = 0;
        
        for (let i = 0; i < arr.length; i += batchSize) {
            const chunk = arr.slice(i, i + batchSize);
            const parent = window.ProgressTracker.createGroupContainer(
                queueStartIndex + i,
                queueStartIndex + Math.min(i + batchSize, arr.length),
                groupIndex
            );
            
            // Use DocumentFragment to batch DOM insertions and prevent iOS reflow thrashing
            const fragment = document.createDocumentFragment();
            chunk.forEach((f) => {
                const id = window.Utils.generateFileId();
                const meta = { 
                    id, file: f, name: f.name, size: f.size, 
                    running: false, done: false, parent,
                    _lastLoaded: 0, _lastTime: 0, _speed: 0,
                    uploadedBytes: 0, completedBytes: 0, failed: false
                };
                this.fileQueue.push(meta);
                this.totalBytes += f.size;
                window.ProgressTracker.renderFileItem(meta, fragment);
            });
            parent.appendChild(fragment);
            groupIndex++;
        }

        window.ProgressTracker.updateStatsUI(
            this.fileQueue, 
            this.successCount, 
            this.errorCount, 
            this.totalBytes
        );
        this.refreshOverallProgress();

        this.logClientEvent('INFO', 'files_added', 'Files queued for upload', {
            batchCount: arr.length,
            queueSize: this.fileQueue.length,
            totalBytes: this.totalBytes
        });
        return true;
    },

    async uploadFiles() {
        if (this.isUploadInProgress) {
            this.logClientEvent('WARN', 'upload_reentry_blocked', 'Upload clicked while upload already in progress');
            return;
        }
        if (!this.fileQueue.length) {
            window.Modals.showNoFilesModal();
            this.logClientEvent('WARN', 'upload_requested_no_files', 'Upload clicked with empty queue');
            return;
        }

        const failedDoneFiles = this.fileQueue.filter(f => f.done && f.failed);
        failedDoneFiles.forEach((file) => {
            file.done = false;
            file.running = false;
            file.uploadedBytes = 0;
            file.completedBytes = 0;
            file._lastLoaded = 0;
            file._lastTime = 0;
            file._speed = 0;
            window.ProgressTracker.markFileQueued?.(
                file,
                window.I18n?.t('file.queued') || 'Queued');
        });

        if (this.fileQueue.every(file => file.done)) {
            window.Modals.showAlreadyUploadedModal();
            return;
        }

        this.isUploadInProgress = true;
        this.setUploadUiState(true);
        this.sessionId = this.createSessionId();
        this.logSequence = 0;
        this.lastSpeedReportTs = 0;
        const runStartedAt = Date.now();
        this.startTime = runStartedAt;
        this.displaySpeedEMA = 0;
        this.checkDurationMs = 0;
        this.uploadDurationMs = 0;
        this.skippedBytes = 0;
        this.networkBytesUploaded = 0;
        this.peakSpeedBytesPerSecond = 0;
        this.retryCount = 0;
        this.globalUploadedBytes = 0;
        this.globalCompletedBytes = 0;
        this.activeSpeedSum = 0;
        this.speedEpoch += 1;
        this.nextUploadIndex = 0;
        this.pendingCount = this.fileQueue.reduce((count, file) => count + (file.done ? 0 : 1), 0);
        this.setRunPhase(
            'checking',
            window.I18n?.t('phase.checking') || 'Checking existing files...');

        this.logClientEvent('INFO', 'upload_started', 'Upload run started', {
            queuedFiles: this.pendingCount,
            totalQueuedBytes: this.totalBytes,
            concurrency: this.CONCURRENCY
        });

        try {
            if (this.totalTimerInterval) clearInterval(this.totalTimerInterval);
            this.totalTimerInterval = setInterval(() => {
                const elapsed = (Date.now() - runStartedAt) / 1000;
                if (this.elements.totalTimerEl) {
                    this.elements.totalTimerEl.textContent =
                        window.I18n?.t('timer.total', {
                            phase: this.getPhaseLabel(),
                            time: window.Utils.formatTime(elapsed)
                        }) || `${this.getPhaseLabel()} | Total time: ${window.Utils.formatTime(elapsed)}`;
                }
            }, 1000);

            const checkStartedAt = Date.now();
            try {
                const preflight = await window.DuplicatePreflight.run(
                    this.fileQueue,
                    window.ProgressTracker,
                    this);
                this.skippedBytes = preflight.skippedBytes;
                this.globalCompletedBytes = Math.max(
                    this.globalCompletedBytes,
                    this.skippedBytes);
                this.successCount += preflight.skippedFiles;
                window.ProgressTracker.updateStatsUI(
                    this.fileQueue,
                    this.successCount,
                    this.errorCount,
                    this.totalBytes);
                this.refreshOverallProgress();
            } catch (error) {
                this.logClientEvent(
                    'WARN',
                    'preflight_fallback',
                    'Duplicate preflight failed; uploading normally',
                    { error: error?.message || 'unknown' });
                this.fileQueue
                    .filter(file => !file.done)
                    .forEach(file => window.ProgressTracker.markFileQueued?.(
                        file,
                        window.I18n?.t('file.ready') || 'Ready to upload'));
            }
            this.checkDurationMs = Date.now() - checkStartedAt;
            this.pendingCount = this.fileQueue.reduce((count, file) => count + (file.done ? 0 : 1), 0);
            this.nextUploadIndex = 0;

            const uploadStartedAt = Date.now();
            const hasPendingUploads = this.pendingCount > 0;
            if (hasPendingUploads) {
                this.setRunPhase(
                    'uploading',
                    window.I18n?.t('phase.uploading') || 'Uploading files...');
                this.startStallWatchdog();
                if (this.speedInterval) clearInterval(this.speedInterval);
                this.speedInterval = setInterval(() => {
                    this.displaySpeedEMA = window.ProgressTracker.updateCurrentSpeedDisplay(
                        this.getCurrentSpeedForDisplay(),
                        this.displaySpeedEMA,
                        this.AGG_ALPHA);
                    this.peakSpeedBytesPerSecond = Math.max(
                        this.peakSpeedBytesPerSecond,
                        this.displaySpeedEMA);
                    this.reportSpeedSample(this.displaySpeedEMA);
                    this.refreshOverallProgress();
                }, 500);

                const workers = [];
                for (let i = 0; i < this.CONCURRENCY; i++) {
                    workers.push(this.worker());
                }
                await Promise.all(workers);
            }
            this.uploadDurationMs = Date.now() - uploadStartedAt;
            this.refreshOverallProgress();

            this.setRunPhase(
                'verifying',
                window.I18n?.t('phase.verifying') || 'Finalizing results...');
            if (window.uploadCacheManager?.performCleanup) {
                await window.uploadCacheManager.performCleanup();
            }
            const totalDurationMs = Date.now() - runStartedAt;
            await this.submitTransferHistory(totalDurationMs);
            this.setRunPhase(
                'complete',
                window.I18n?.t('phase.complete') || 'Complete');

            const processedFiles = this.fileQueue.filter(
                file => file.done && !file.failed).length;
            const skippedFiles = this.fileQueue.filter(
                file => file.preflightSkipped || file.skipped).length;
            window.Modals.showUploadCompleteModal(
                processedFiles,
                skippedFiles,
                totalDurationMs);

            this.logClientEvent('INFO', 'upload_finished', 'Upload run finished', {
                successCount: this.successCount,
                errorCount: this.errorCount,
                queueSize: this.fileQueue.length,
                skippedBytes: this.skippedBytes,
                uploadedBytes: this.networkBytesUploaded
            });
        } finally {
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
            this.startTime = null;
            this.isUploadInProgress = false;
            this.setUploadUiState(false);
        }
    },

    async submitTransferHistory(totalDurationMs) {
        const uploadedItems = this.fileQueue.filter(
            file => file.done && !file.failed && !file.preflightSkipped && !file.skipped);
        const skippedItems = this.fileQueue.filter(
            file => file.preflightSkipped || file.skipped);
        const uploadedBytes = uploadedItems.reduce((total, file) => total + file.size, 0);
        const skippedBytes = skippedItems.reduce((total, file) => total + file.size, 0);
        const averageSpeedMBps = this.uploadDurationMs > 0
            ? (this.networkBytesUploaded / 1_000_000) /
                (this.uploadDurationMs / 1000)
            : 0;
        const payload = {
            sessionId: `${this.sessionId}-${Date.now()}`,
            completedAt: Date.now(),
            selectedFiles: this.fileQueue.length,
            uploadedFiles: uploadedItems.length,
            skippedFiles: skippedItems.length,
            failedFiles: this.errorCount,
            selectedBytes: this.totalBytes,
            uploadedBytes,
            skippedBytes,
            checkDurationMs: this.checkDurationMs,
            uploadDurationMs: this.uploadDurationMs,
            totalDurationMs,
            averageSpeedMBps,
            peakSpeedMBps: this.peakSpeedBytesPerSecond / 1_000_000,
            retries: this.retryCount,
            files: this.fileQueue.map(file => ({
                id: file.id,
                name: file.name,
                savedName: file.serverResult?.filename || file.name,
                size: file.size,
                outcome: file.failed
                    ? 'failed'
                    : file.preflightSkipped
                        ? 'skipped'
                        : file.skipped
                            ? 'duplicate_after_upload'
                        : 'uploaded'
            }))
        };
        try {
            const response = await fetch('/transfer_history', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Upload-Token': window.SecurityManager?.token || ''
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            this.logClientEvent(
                'WARN',
                'history_store_failed',
                'Unable to save transfer history',
                { error: error?.message || 'unknown' });
        }
    },

    async worker() {
        while (true) {
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
            } finally {
                next.running = false;
                this.running--;
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

        this.fileQueue = [];
        this.running = 0;
        this.successCount = 0;
        this.errorCount = 0;
        this.totalBytes = 0;
        this.displaySpeedEMA = 0;
        this.startTime = null;
        this.checkDurationMs = 0;
        this.uploadDurationMs = 0;
        this.skippedBytes = 0;
        this.networkBytesUploaded = 0;
        this.peakSpeedBytesPerSecond = 0;
        this.retryCount = 0;
        this.currentPhase = 'idle';
        this.nextUploadIndex = 0;
        this.pendingCount = 0;
        this.globalUploadedBytes = 0;
        this.globalCompletedBytes = 0;
        this.activeSpeedSum = 0;
        this.speedEpoch += 1;
        if (this.speedInterval) {
            clearInterval(this.speedInterval);
            this.speedInterval = null;
        }
        if (this.totalTimerInterval) {
            clearInterval(this.totalTimerInterval);
            this.totalTimerInterval = null;
        }
        this.stopStallWatchdog();
        
        if (this.elements.progressContainer) this.elements.progressContainer.innerHTML = '';
        if (this.elements.resultsContainer) this.elements.resultsContainer.innerHTML = '';
        if (this.elements.totalTimerEl) this.elements.totalTimerEl.textContent = '';
        
        const currentSpeedEl = document.getElementById('currentSpeed');
        if (currentSpeedEl) {
            currentSpeedEl.textContent = window.I18n?.t('speed.currentZero') || 'Current upload: 0 B/s';
        }
        
        window.ProgressTracker.updateStatsUI(
            this.fileQueue, 
            this.successCount, 
            this.errorCount, 
            this.totalBytes
        );
        this.refreshOverallProgress();

        this.logClientEvent('INFO', 'queue_reset', 'Upload queue reset by user');
    },

    setRunPhase(phase, label) {
        this.currentPhase = phase;
        if (!this.elements.totalTimerEl) return;

        this.elements.totalTimerEl.dataset.phase = phase;
        this.elements.totalTimerEl.textContent = label;
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

    setUploadUiState(isUploading) {
        const controls = [
            this.elements.uploadBtn,
            this.elements.chooseBtn,
            this.elements.resetBtn,
            this.elements.fileInput
        ];
        controls.forEach((el) => {
            if (!el) return;
            el.disabled = !!isUploading;
            el.setAttribute('aria-disabled', isUploading ? 'true' : 'false');
        });

        if (this.elements.uploadZone) {
            this.elements.uploadZone.setAttribute('aria-disabled', isUploading ? 'true' : 'false');
            this.elements.uploadZone.classList.toggle('upload-disabled', !!isUploading);
        }
    },

    refreshOverallProgress() {
        if (window.ProgressTracker && typeof window.ProgressTracker.updateAggregateProgress === 'function') {
            window.ProgressTracker.updateAggregateProgress(this.globalCompletedBytes, this.totalBytes);
        }
    }
};

console.log('🚀 Upload manager loaded');
