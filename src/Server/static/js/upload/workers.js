/**
 * Upload Workers - Parallel upload processing
 */

window.UploadWorkers = {

    WHOLE_FILE_TIMEOUT_MS: 180000,
    CHUNK_TIMEOUT_MS: 180000,
    MAX_CHUNK_RETRIES: 2,
    IOS_MAX_CHUNK_BYTES: window.TransferLimits.NativeChunkBytes,
    WHOLE_FILE_TIMEOUT_GRACE_MS: 120000,
    MIN_WHOLE_FILE_BPS: 1.5 * 1024 * 1024,

    isIOSLike() {
        return window.Utils?.isIOSLike?.() ??
            /iPhone|iPad|iPod/i.test(navigator.userAgent);
    },

    shouldUseChunkedUpload(meta, manager) {
        return meta.file.size > manager.SINGLE_FILE_MAX_BYTES;
    },

    computeWholeFileTimeoutMs(sizeBytes) {
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
            return this.WHOLE_FILE_TIMEOUT_MS;
        }

        const transferBudgetMs = Math.ceil((sizeBytes / this.MIN_WHOLE_FILE_BPS) * 1000);
        return Math.max(this.WHOLE_FILE_TIMEOUT_MS, transferBudgetMs + this.WHOLE_FILE_TIMEOUT_GRACE_MS);
    },

    recordTransferProgress(manager, meta, loadedBytes) {
        if (typeof manager.updateFileTransferProgress === 'function') {
            return manager.updateFileTransferProgress(meta, loadedBytes);
        }

        const fileSize = Number(meta?.size) || Number(meta?.file?.size) || 0;
        const safeLoaded = Number.isFinite(loadedBytes)
            ? Math.max(0, Math.min(loadedBytes, fileSize))
            : 0;
        meta.uploadedBytes = safeLoaded;
        meta.completedBytes = safeLoaded;
        return { uploadDelta: 0, completedDelta: 0 };
    },

    recordFileSpeed(manager, meta, bytesPerSecond) {
        if (typeof manager.updateFileSpeed === 'function') {
            return manager.updateFileSpeed(meta, bytesPerSecond);
        }
        meta._speed = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
            ? bytesPerSecond
            : 0;
        return meta._speed;
    },

    clearFileSpeed(manager, meta) {
        if (typeof manager.clearFileSpeed === 'function') {
            manager.clearFileSpeed(meta);
            return;
        }
        meta._speed = 0;
    },
    
    async uploadSingle(meta, manager) {
        return new Promise(async (resolve) => {
            let wasFailedBefore = false;
            try {
                wasFailedBefore = !!meta.failed;
                meta.failed = false;
                this.clearFileSpeed(manager, meta);
                meta.uploadedBytes = 0;
                meta.completedBytes = 0;

                window.ProgressTracker.setFileProgress(meta, 0, 'Uploading...');
                const performUpload = () => this.shouldUseChunkedUpload(meta, manager)
                    ? this.uploadChunked(meta, manager)
                    : this.uploadWholeFile(meta, manager);

                meta.serverResult = await performUpload();

                this.clearFileSpeed(manager, meta);
                if (wasFailedBefore && manager.errorCount > 0) {
                    manager.errorCount--;
                }
                this.recordTransferProgress(manager, meta, meta.size);
                manager.successCount++;
                if (meta.serverResult?.skipped) {
                    meta.skipped = true;
                    const existingName = meta.serverResult.filename || meta.name;
                    window.ProgressTracker.markFileSkipped(
                        meta,
                        existingName === meta.name
                            ? 'Already exists'
                            : `Already exists as ${existingName}`);
                } else {
                    const savedName = meta.serverResult?.filename || meta.name;
                    window.ProgressTracker.markFileSuccess(
                        meta,
                        savedName === meta.name ? 'Done' : `Saved as ${savedName}`);
                    window.uploadCacheManager?.trackUpload?.(
                        meta.id,
                        savedName,
                        meta.size);
                }
                
            } catch (error) {
                meta.failed = true;
                this.clearFileSpeed(manager, meta);
                if (!wasFailedBefore) {
                    manager.errorCount++;
                }
                window.ProgressTracker.markFileError(meta, error?.message || 'Error');
                manager.logClientEvent('ERROR', 'file_error', 'File upload failed', {
                    size: meta.size,
                    status: Number(error?.status) || 0,
                    errorType: error?.name || 'Error'
                });
            } finally {
                meta.done = true;
                meta.running = false;

                window.ProgressTracker.updateStatsUI(
                    manager.fileQueue,
                    manager.successCount,
                    manager.errorCount,
                    manager.totalBytes
                );

                manager.displaySpeedEMA = window.ProgressTracker.updateCurrentSpeedDisplay(
                    manager.getCurrentSpeedForDisplay?.() || 0,
                    manager.displaySpeedEMA,
                    manager.AGG_ALPHA
                );
                resolve();
            }
        });
    },

    uploadWholeFile(meta, manager) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const requestStartedAt = Date.now();
            xhr.open('POST', manager.UPLOAD_URL, true);
            xhr.timeout = this.computeWholeFileTimeoutMs(meta.size);

            if (window.SecurityManager.token) {
                xhr.setRequestHeader('X-Upload-Token', window.SecurityManager.token);
            }
            xhr.setRequestHeader('X-Filename', encodeURIComponent(meta.file.name));
            const formData = new FormData();
            formData.append('file', meta.file);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    manager.lastProgressTs = Date.now();
                    const now = Date.now();
                    const deltaLoaded = e.loaded - meta._lastLoaded;
                    const deltaTime = now - meta._lastTime;

                    if (deltaTime > 0 && meta._lastTime > 0) {
                        const instantSpeed = (deltaLoaded / deltaTime) * 1000;
                        const alpha = Math.min(1, deltaTime / manager.SPEED_WINDOW_MS);
                    this.recordFileSpeed(
                        manager,
                        meta,
                        meta._speed * (1 - alpha) + instantSpeed * alpha);
                    }

                    meta._lastLoaded = e.loaded;
                    meta._lastTime = now;
                    this.recordTransferProgress(manager, meta, e.loaded);

                    if (!meta._lastUIUpdate || now - meta._lastUIUpdate >= 100 || e.loaded === e.total) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        window.ProgressTracker.setFileProgress(meta, percent, `${percent}%`);
                        meta._lastUIUpdate = now;
                    }
                }
            };

            xhr.onload = () => {
                this.recordRequestTiming(meta, requestStartedAt, xhr);
                if (xhr.status >= 200 && xhr.status < 300) {
                    manager.lastProgressTs = Date.now();
                    this.recordTransferProgress(manager, meta, meta.size);
                    try {
                        resolve(JSON.parse(xhr.responseText || '{}'));
                    } catch {
                        reject(new Error('Server returned an invalid response'));
                    }
                } else {
                    reject(this.createUploadError(xhr));
                }
            };

            xhr.onerror = () => {
                this.recordRequestTiming(meta, requestStartedAt, xhr);
                reject(new Error('Network error'));
            };

            xhr.ontimeout = () => {
                this.recordRequestTiming(meta, requestStartedAt, xhr);
                reject(new Error('Upload timeout'));
            };

            xhr.onabort = () => {
                this.recordRequestTiming(meta, requestStartedAt, xhr);
                reject(new Error('Upload aborted'));
            };

            xhr.send(formData);
        });
    },

    // NEW HELPER: Replaces fetch with XHR to unlock mid-chunk progress events
    async uploadChunkXHR(url, headers, chunk, timeoutMs, retries, onRetry, onProgress, onTiming) {
        let attempt = 0;
        while (true) {
            try {
                const responseText = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    const requestStartedAt = Date.now();
                    xhr.open('POST', url, true);
                    xhr.timeout = timeoutMs;

                    for (const [key, value] of Object.entries(headers)) {
                        xhr.setRequestHeader(key, value);
                    }

                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            onProgress(e.loaded, e.total);
                        }
                    };

                    xhr.onload = () => {
                        if (typeof onTiming === 'function') {
                            onTiming(requestStartedAt, xhr);
                        }
                        if (xhr.status >= 200 && xhr.status < 300) {
                            if (typeof onProgress === 'function') {
                                const finalSize = chunk && typeof chunk.size === 'number' ? chunk.size : 0;
                                if (finalSize > 0) {
                                    onProgress(finalSize, finalSize);
                                }
                            }
                            resolve(xhr.responseText);
                        } else {
                            reject(this.createUploadError(xhr));
                        }
                    };

                    const fail = message => {
                        if (typeof onTiming === 'function') onTiming(requestStartedAt, xhr);
                        reject(new Error(message));
                    };
                    xhr.onerror = () => fail('Network error');
                    xhr.ontimeout = () => fail('Timeout');
                    xhr.onabort = () => fail('Abort');

                    xhr.send(chunk);
                });
                return responseText;
            } catch (err) {
                if (attempt >= retries || !this.isRetryableUploadError(err)) throw err;
                attempt++;
                if (onRetry) onRetry(attempt, err);
                await new Promise(r => setTimeout(r, 300 * attempt));
            }
        }
    },

    async uploadChunked(meta, manager) {
        const isIOS = this.isIOSLike();
        const chunkSize = isIOS ? Math.min(manager.chunkSizeBytes, this.IOS_MAX_CHUNK_BYTES) : manager.chunkSizeBytes;
        const totalChunks = Math.ceil(meta.file.size / chunkSize);
        if (totalChunks > window.TransferLimits.MaxChunksPerFile) {
            throw new Error('File exceeds the receiver limit of 10,000 chunks. Split it before uploading.');
        }
        if (meta.file.size > window.TransferLimits.MaxFileBytes) {
            throw new Error('File exceeds the receiver file-size limit. Split it before uploading.');
        }
        const fileId = this.buildChunkFileId(meta.file);
        let uploadedBytes = 0;
        let finalResult = null;

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, meta.file.size);
            
            // Just take the raw slice, do NOT use arrayBuffer()!
            const chunk = meta.file.slice(start, end);
            const chunkByteSize = Number(chunk.size);
            const safeChunkSize = (Number.isFinite(chunkByteSize) && chunkByteSize >= 0)
                ? chunkByteSize
                : Math.max(0, end - start);

            const headers = {
                'X-File-Id': fileId,
                'X-Filename': encodeURIComponent(meta.file.name),
                'X-Chunk-Index': String(i),
                'X-Total-Chunks': String(totalChunks),
                'X-File-Size': String(meta.file.size)
            };

            if (window.SecurityManager.token) {
                headers['X-Upload-Token'] = window.SecurityManager.token;
            }
            let chunkLastLoaded = 0;
            meta._lastTime = Date.now();

            const responseText = await this.uploadChunkXHR(
                manager.UPLOAD_CHUNK_URL,
                headers,
                chunk,
                this.CHUNK_TIMEOUT_MS,
                this.MAX_CHUNK_RETRIES,
                (attemptNumber, err) => {
                    manager.retryCount = (manager.retryCount || 0) + 1;
                    manager.logClientEvent('WARN', 'chunk_retry', 'Retrying chunk upload', {
                        chunkIndex: i,
                        attempt: attemptNumber,
                        errorType: err?.name || 'Error'
                    });
                },
                (loaded, total) => {
                    manager.lastProgressTs = Date.now(); 
                    const now = Date.now();
                    const deltaLoaded = loaded - chunkLastLoaded;
                    const deltaTime = Math.max(1, now - meta._lastTime);

                    if (deltaTime > 0 && deltaLoaded > 0) {
                        const instantSpeed = (deltaLoaded / deltaTime) * 1000;
                        const alpha = Math.min(1, deltaTime / manager.SPEED_WINDOW_MS);
                        this.recordFileSpeed(
                            manager,
                            meta,
                            meta._speed * (1 - alpha) + instantSpeed * alpha);
                    }

                    chunkLastLoaded = loaded;
                    meta._lastTime = now;

                    // Throttle DOM updates to 200ms (5 FPS) to prevent iOS layout thrashing
                    if (!meta._lastUIUpdate || now - meta._lastUIUpdate > 200 || loaded === total) {
                        const absoluteLoaded = uploadedBytes + loaded;
                        this.recordTransferProgress(manager, meta, absoluteLoaded);
                        const percent = Math.round((absoluteLoaded / meta.file.size) * 100);
                        window.ProgressTracker.setFileProgress(meta, percent, `${percent}%`);

                        manager.displaySpeedEMA = window.ProgressTracker.updateCurrentSpeedDisplay(
                            manager.getCurrentSpeedForDisplay?.() || 0,
                            manager.displaySpeedEMA,
                            manager.AGG_ALPHA
                        );
                        meta._lastUIUpdate = now;
                    }
                },
                (requestStartedAt, xhr) => this.recordRequestTiming(
                    meta,
                    requestStartedAt,
                    xhr)
            );

            if (i === totalChunks - 1) {
                try {
                    finalResult = JSON.parse(responseText);
                    if (!finalResult || finalResult.complete !== true) {
                        throw new Error('Missing finalization confirmation');
                    }
                } catch {
                    throw new Error('Server returned an invalid response');
                }
            }

            manager.lastProgressTs = Date.now();
            uploadedBytes += safeChunkSize;
            this.recordTransferProgress(manager, meta, uploadedBytes);
        }

        this.recordTransferProgress(manager, meta, meta.file.size);
        return finalResult || {};
    },

    buildChunkFileId(file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const randomPart = globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `${randomPart}-${safeName}`;
    },

    isRetryableUploadError(error) {
        const status = Number(error?.status) || 0;
        return status === 0 || status === 408 || status === 425 ||
            status === 429 || status >= 500;
    },

    parseServerTiming(value) {
        const result = {};
        if (typeof value !== 'string' || !value || value.length > 4096) return result;
        for (const entry of value.split(',')) {
            const [rawName, ...parameters] = entry.trim().split(';');
            const name = rawName?.trim();
            if (!['parse', 'decode', 'init', 'write', 'finalize', 'app'].includes(name)) continue;
            const durationParameter = parameters.find(parameter =>
                parameter.trim().toLowerCase().startsWith('dur='));
            const duration = Number(durationParameter?.split('=')[1]);
            if (Number.isFinite(duration) && duration >= 0 && duration <= 86400000) {
                result[name] = duration;
            }
        }
        return result;
    },

    recordRequestTiming(meta, requestStartedAt, xhr) {
        const duration = Date.now() - requestStartedAt;
        const requestDurationMs = Number.isFinite(duration)
            ? Math.min(86400000, Math.max(0, duration)) : 0;
        const server = this.parseServerTiming(
            xhr?.getResponseHeader?.('Server-Timing') || '');
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
        timing.maxRequestDurationMs = Math.max(
            timing.maxRequestDurationMs,
            requestDurationMs);
        meta.transferTiming = timing;
    },

    createUploadError(xhr) {
        let message = `Upload failed (${xhr.status})`;
        try {
            const body = JSON.parse(xhr.responseText || '{}');
            if (body.code === 'filename_conflict') {
                message = `A different file named "${body.filename || 'this file'}" already exists`;
            } else if (body.error) {
                message = body.error;
            }
        } catch {
        }
        const error = new Error(message);
        error.status = xhr.status;
        return error;
    }
};
