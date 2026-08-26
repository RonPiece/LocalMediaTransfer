/**
 * Upload Workers - Parallel upload processing
 */

window.UploadWorkers = {

    WHOLE_FILE_TIMEOUT_MS: 180000,
    CHUNK_TIMEOUT_MS: 180000,
    MAX_CHUNK_RETRIES: 2,
    IOS_WHOLE_FILE_FALLBACK_BYTES: 1024 * 1024 * 1024,
    IOS_MAX_CHUNK_BYTES: 8 * 1024 * 1024,
    WHOLE_FILE_TIMEOUT_GRACE_MS: 120000,
    MIN_WHOLE_FILE_BPS: 1.5 * 1024 * 1024,
    _iosLargeTransferTail: Promise.resolve(),

    isIOSLike() {
        return window.Utils?.isIOSLike?.() ??
            /iPhone|iPad|iPod/i.test(navigator.userAgent);
    },

    shouldUseChunkedUpload(meta, manager) {
        const overSharedThreshold = meta.file.size > manager.SINGLE_FILE_MAX_BYTES;
        if (!overSharedThreshold) {
            return false;
        }

        if (!this.isIOSLike()) {
            return true;
        }

        // Legacy compatibility on iOS: avoid chunk mode for medium-large files,
        // because whole-file XHR has proven more stable on Safari in this range.
        return meta.file.size > this.IOS_WHOLE_FILE_FALLBACK_BYTES;
    },

    async withIOSLargeTransfer(task) {
        const previous = this._iosLargeTransferTail;
        let release;
        this._iosLargeTransferTail = new Promise(resolve => {
            release = resolve;
        });

        await previous.catch(() => {});
        try {
            return await task();
        } finally {
            release();
        }
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
                manager.logClientEvent('INFO', 'file_started', 'File upload started', {
                    file: meta.name,
                    size: meta.size,
                    id: meta.id
                });
                wasFailedBefore = !!meta.failed;
                meta.failed = false;
                this.clearFileSpeed(manager, meta);
                meta.uploadedBytes = 0;
                meta.completedBytes = 0;

                window.ProgressTracker.setFileProgress(meta, 0, 'Uploading...');
                const performUpload = () => this.shouldUseChunkedUpload(meta, manager)
                    ? this.uploadChunked(meta, manager)
                    : this.uploadWholeFile(meta, manager);

                if (this.isIOSLike() && meta.size > manager.SINGLE_FILE_MAX_BYTES) {
                    manager.logClientEvent('INFO', 'ios_large_file_wait', 'Large iOS transfer queued for serialized access', {
                        file: meta.name,
                        id: meta.id,
                        size: meta.size
                    });
                    meta.serverResult = await this.withIOSLargeTransfer(async () => {
                        manager.logClientEvent('INFO', 'ios_large_file_start', 'Large iOS transfer acquired upload slot', {
                            file: meta.name,
                            id: meta.id,
                            size: meta.size,
                            mode: this.shouldUseChunkedUpload(meta, manager) ? 'chunked' : 'whole-file'
                        });
                        return performUpload();
                    });
                } else {
                    meta.serverResult = await performUpload();
                }

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
                    manager.logClientEvent('INFO', 'file_skipped', 'Exact duplicate verified by server', {
                        file: meta.name,
                        existingName,
                        size: meta.size,
                        id: meta.id
                    });
                } else {
                    const savedName = meta.serverResult?.filename || meta.name;
                    window.ProgressTracker.markFileSuccess(
                        meta,
                        savedName === meta.name ? 'Done' : `Saved as ${savedName}`);
                    window.uploadCacheManager?.trackUpload?.(
                        meta.id,
                        savedName,
                        meta.size);
                    manager.logClientEvent('INFO', 'file_success', 'File upload succeeded', {
                        file: meta.name,
                        savedName,
                        size: meta.size,
                        id: meta.id
                    });
                }
                
            } catch (error) {
                console.error('Upload error:', error);
                meta.failed = true;
                this.clearFileSpeed(manager, meta);
                if (!wasFailedBefore) {
                    manager.errorCount++;
                }
                window.ProgressTracker.markFileError(meta, error?.message || 'Error');
                manager.logClientEvent('ERROR', 'file_error', 'File upload failed', {
                    file: meta.name,
                    size: meta.size,
                    id: meta.id,
                    error: error?.message || 'unknown'
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

                    const percent = Math.round((e.loaded / e.total) * 100);
                    window.ProgressTracker.setFileProgress(meta, percent, `${percent}%`);
                }
            };

            xhr.onload = () => {
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

            xhr.onerror = function () {
                reject(new Error('Network error'));
            };

            xhr.ontimeout = function () {
                reject(new Error('Upload timeout'));
            };

            xhr.onabort = function () {
                reject(new Error('Upload aborted'));
            };

            xhr.send(formData);
        });
    },

    // NEW HELPER: Replaces fetch with XHR to unlock mid-chunk progress events
    async uploadChunkXHR(url, headers, chunk, timeoutMs, retries, onRetry, onProgress) {
        let attempt = 0;
        while (true) {
            try {
                const responseText = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
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

                    xhr.onerror = () => reject(new Error('Network error'));
                    xhr.ontimeout = () => reject(new Error('Timeout'));
                    xhr.onabort = () => reject(new Error('Abort'));

                    xhr.send(chunk);
                });
                return responseText;
            } catch (err) {
                if (attempt >= retries) throw err;
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
        const fileId = this.buildChunkFileId(meta.file);
        let uploadedBytes = 0;
        let finalResult = null;

        manager.logClientEvent('INFO', 'chunk_session_start', 'Chunk upload session started', {
            file: meta.name, id: meta.id, totalChunks, chunkSize
        });

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
                        file: meta.name, id: meta.id, chunkIndex: i, attempt: attemptNumber, reason: err?.name || err?.message || 'unknown'
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
                }
            );

            if (i === totalChunks - 1 && responseText) {
                try {
                    finalResult = JSON.parse(responseText);
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

console.log('⚙️ Upload workers loaded');
