/**
 * Upload Workers - Parallel upload processing
 */

const lmtWorkers = {

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

    /** @param {TransferFile} meta @param {{SINGLE_FILE_MAX_BYTES: number}} manager */
    shouldUseChunkedUpload(meta, manager) {
        return meta.file.size > manager.SINGLE_FILE_MAX_BYTES;
    },

    /** @param {number} sizeBytes */
    computeWholeFileTimeoutMs(sizeBytes) {
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
            return this.WHOLE_FILE_TIMEOUT_MS;
        }

        const transferBudgetMs = Math.ceil((sizeBytes / this.MIN_WHOLE_FILE_BPS) * 1000);
        return Math.max(this.WHOLE_FILE_TIMEOUT_MS, transferBudgetMs + this.WHOLE_FILE_TIMEOUT_GRACE_MS);
    },

    /** @param {TransportContext} observer @param {TransferFile} meta @param {number} loadedBytes */
    recordTransferProgress(observer, meta, loadedBytes) {
        return observer.updateFileTransferProgress(meta, loadedBytes);
    },

    /** Compatibility adapter; file outcomes belong to the controller. */
    /** @param {TransferFile} meta @param {typeof lmtController} manager */
    uploadSingle(meta, manager) { return window.TransferController.processFile.call(manager, meta); },

    /** @param {TransferFile} meta @param {TransportContext} manager */
    uploadWholeFile(meta, manager) {
        let lastUIUpdate = 0;
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            this.ownRequest(xhr);
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
                    manager.onActivity?.();
                    const now = Date.now();
                    this.recordTransferProgress(manager, meta, e.loaded);

                    if (!lastUIUpdate || now - lastUIUpdate >= 100 || e.loaded === e.total) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        manager.onSending?.(percent, e.loaded === e.total);
                        lastUIUpdate = now;
                    }
                }
            };

            xhr.onload = () => {
                manager.onTiming?.(requestStartedAt, xhr);
                if (xhr.status >= 200 && xhr.status < 300) {
                    manager.onActivity?.();
                    this.recordTransferProgress(manager, meta, meta.size);
                    try {
                        const result = window.TransferContracts.upload(JSON.parse(xhr.responseText || '{}'));
                        manager.recordFileAcknowledgement?.(meta, meta.size);
                        resolve(result);
                    } catch {
                        reject(Object.assign(new Error(window.I18n?.t('error.response') || 'Server returned an invalid response'), { retryable: false }));
                    }
                } else {
                    reject(this.createUploadError(xhr));
                }
            };

            xhr.onerror = () => {
                manager.onTiming?.(requestStartedAt, xhr);
                reject(new Error(window.I18n?.t('error.network') || 'Network error'));
            };

            xhr.ontimeout = () => {
                manager.onTiming?.(requestStartedAt, xhr);
                reject(new Error(window.I18n?.t('error.timeout') || 'Upload timeout'));
            };

            xhr.onabort = () => {
                manager.onTiming?.(requestStartedAt, xhr);
                reject(new Error(window.I18n?.t('error.aborted') || 'Upload aborted'));
            };

            xhr.send(formData);
        });
    },

    /** XHR provides upload progress events that Fetch does not expose.
     * @param {string} url
     * @param {Record<string, string>} headers
     * @param {Blob} chunk
     * @param {number} timeoutMs
     * @param {number} retries
     * @param {ChunkUploadObserver} observer
     */
    async uploadChunkXHR(url, headers, chunk, timeoutMs, retries, observer = {}) {
        let attempt = 0;
        while (true) {
            // Authentication may be lost by another file during retry backoff
            // or between sequential chunks. Never open a new request afterward.
            if (window.TransferSession?.state === 'blocked') {
                throw Object.assign(new Error(window.I18n?.t('error.aborted') || 'Upload aborted'), { retryable: false });
            }
            try {
                const responseText = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    this.ownRequest(xhr);
                    const requestStartedAt = Date.now();
                    xhr.open('POST', url, true);
                    xhr.timeout = timeoutMs;

                    for (const [key, value] of Object.entries(headers)) {
                        xhr.setRequestHeader(key, value);
                    }

                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            observer.onProgress?.(e.loaded, e.total);
                        }
                    };

                    xhr.onload = () => {
                        observer.onTiming?.(requestStartedAt, xhr);
                        if (xhr.status >= 200 && xhr.status < 300) {
                            if (observer.onProgress) {
                                const finalSize = chunk && typeof chunk.size === 'number' ? chunk.size : 0;
                                if (finalSize > 0) {
                                    observer.onProgress(finalSize, finalSize);
                                }
                            }
                            resolve(xhr.responseText);
                        } else {
                            reject(this.createUploadError(xhr));
                        }
                    };

                    /** @param {string} message */
                    const fail = message => {
                        observer.onTiming?.(requestStartedAt, xhr);
                        reject(new Error(message));
                    };
                    xhr.onerror = () => fail(window.I18n?.t('error.network') || 'Network error');
                    xhr.ontimeout = () => fail(window.I18n?.t('error.timeout') || 'Timeout');
                    xhr.onabort = () => fail(window.I18n?.t('error.aborted') || 'Abort');

                    xhr.send(chunk);
                });
                return responseText;
            } catch (err) {
                if (attempt >= retries || !this.isRetryableUploadError(err)) throw err;
                attempt++;
                observer.onRetry?.(attempt, window.TransferContracts.error(err));
                await new Promise(r => setTimeout(r, 300 * attempt));
            }
        }
    },

    /** @param {TransferFile} meta @param {TransportContext} manager */
    async uploadChunked(meta, manager) {
        const isIOS = this.isIOSLike();
        const chunkSize = isIOS ? Math.min(manager.chunkSizeBytes, this.IOS_MAX_CHUNK_BYTES) : manager.chunkSizeBytes;
        const totalChunks = Math.ceil(meta.file.size / chunkSize);
        if (totalChunks > window.TransferLimits.MaxChunksPerFile) {
            throw Object.assign(new Error(window.I18n?.t('error.chunkLimit') || 'File exceeds the receiver limit of 10,000 chunks. Split it before uploading.'), { retryable: false });
        }
        if (meta.file.size > window.TransferLimits.MaxFileBytes) {
            throw Object.assign(new Error(window.I18n?.t('error.fileLimit') || 'File exceeds the receiver file-size limit. Split it before uploading.'), { retryable: false });
        }
        const fileId = this.buildChunkFileId(meta.file);
        let uploadedBytes = 0;
        let lastUIUpdate = 0;
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

            /** @type {Record<string, string>} */
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

            const responseText = await this.uploadChunkXHR(
                manager.UPLOAD_CHUNK_URL,
                headers,
                chunk,
                this.CHUNK_TIMEOUT_MS,
                this.MAX_CHUNK_RETRIES,
                {
                    onRetry: (attemptNumber, err) => {
                        manager.onRetry?.(attemptNumber, i, err);
                    },
                    onProgress: (loaded, total) => {
                        manager.onActivity?.();
                        const now = Date.now();

                        // Throttle DOM updates to 200ms (5 FPS) to prevent iOS layout thrashing
                        if (!lastUIUpdate || now - lastUIUpdate > 200 || loaded === total) {
                            const absoluteLoaded = uploadedBytes + loaded;
                            this.recordTransferProgress(manager, meta, absoluteLoaded);
                            const percent = Math.round((absoluteLoaded / meta.file.size) * 100);
                            manager.onSending?.(percent, loaded === total);
                            lastUIUpdate = now;
                        }
                    },
                    onTiming: (requestStartedAt, xhr) => manager.onTiming?.(requestStartedAt, xhr)
                }
            );

            try {
                const result = window.TransferContracts.upload(JSON.parse(responseText), i === totalChunks - 1, i, totalChunks);
                if (i === totalChunks - 1) finalResult = result;
            } catch {
                throw Object.assign(new Error(window.I18n?.t('error.response') || 'Server returned an invalid response'), { retryable: false });
            }

            manager.onActivity?.();
            uploadedBytes += safeChunkSize;
            manager.recordFileAcknowledgement?.(meta, uploadedBytes);
            this.recordTransferProgress(manager, meta, uploadedBytes);
        }

        this.recordTransferProgress(manager, meta, meta.file.size);
        return finalResult || {};
    },

    /** @param {File} file */
    buildChunkFileId(file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const randomPart = globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `${randomPart}-${safeName}`;
    },

    /** @param {XMLHttpRequest} xhr */
    ownRequest(xhr) {
        if (!window.TransferSession) return;
        const abort = () => xhr.abort();
        window.TransferSession.aborters.add(abort);
        xhr.addEventListener('loadend', () => window.TransferSession.aborters.delete(abort), { once: true });
    },

    /** @param {unknown} cause */
    isRetryableUploadError(cause) {
        const error = window.TransferContracts.error(cause);
        if (window.TransferSession?.state === 'blocked') return false;
        if (error?.retryable === false) return false;
        const status = Number(error?.status) || 0;
        return status === 0 || status === 408 || status === 425 ||
            status === 429 || status >= 500;
    },

    /** @param {string} value @returns {Record<string, number>} */
    parseServerTiming(value) {
        /** @type {Record<string, number>} */
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

    /** Compatibility adapter: only controller accounting writes file timing.
     * @param {TransferFile} meta @param {number} requestStartedAt @param {XMLHttpRequest} xhr */
    recordRequestTiming(meta, requestStartedAt, xhr) { return window.TransferController.recordRequestTiming(meta, requestStartedAt, xhr); },

    /** @param {XMLHttpRequest} xhr */
    createUploadError(xhr) {
        let message = window.I18n?.t('error.http', { status: xhr.status }) || `Upload failed (${xhr.status})`;
        try {
            const body = JSON.parse(xhr.responseText || '{}');
            if (body.code === 'filename_conflict' && typeof body.filename === 'string') {
                message = window.I18n?.t('error.conflict', { name: body.filename || 'this file' }) || `A different file named "${body.filename || 'this file'}" already exists`;
            } else if (typeof body.error === 'string') {
                message = body.error;
            }
        } catch {
        }
        const error = new Error(message);
        error.status = xhr.status;
        if (xhr.status === 401 || xhr.status === 403) window.TransferSession?.authenticationLost();
        return error;
    }
};

window.UploadWorkers = lmtWorkers;
