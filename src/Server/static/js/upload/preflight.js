/**
 * Candidate-based duplicate preflight.
 *
 * Metadata first identifies plausible matches. Only those files are read and
 * SHA-256 hashed, and the server remains authoritative about disk existence.
 */

window.DuplicatePreflight = {
    PRECHECK_URL: '/upload/preflight',
    VERIFY_URL: '/upload/preflight/verify',
    worker: null,
    workers: [],
    requests: new Map(),
    requestSequence: 0,
    nextWorkerIndex: 0,

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-Upload-Token': window.SecurityManager?.token || ''
        };
    },

    getHashWorkerCount() {
        const mobile = window.Utils?.isMobileLike?.() ||
            /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
        if (mobile) {
            return 1;
        }

        const cores = Number(navigator.hardwareConcurrency) || 2;
        return Math.max(1, Math.min(2, cores - 1));
    },

    ensureWorker(index = 0) {
        if (this.workers[index]) {
            return this.workers[index];
        }

        const worker = new Worker(`/static/js/upload/hash-worker.js?v=${window.LMT_FRONTEND_VERSION || '1'}`);
        worker.onmessage = (event) => {
            const message = event.data || {};
            const pending = this.requests.get(message.requestId);
            if (!pending) {
                return;
            }
            if (message.type === 'progress') {
                pending.onProgress?.(
                    message.processedBytes,
                    message.totalBytes);
                return;
            }
            this.requests.delete(message.requestId);
            if (message.type === 'complete') {
                pending.resolve(message.sha256);
            } else {
                pending.reject(new Error(message.error || 'Hashing failed'));
            }
        };
        worker.onerror = () => {
            for (const [requestId, pending] of this.requests.entries()) {
                if (pending.workerIndex === index) {
                    pending.reject(new Error('Hash worker failed'));
                    this.requests.delete(requestId);
                }
            }
            worker.terminate();
            this.workers[index] = null;
        };
        this.workers[index] = worker;
        this.worker = this.workers[0] || worker;
        return worker;
    },

    getNextWorker() {
        const poolSize = this.getHashWorkerCount();
        const workerIndex = this.nextWorkerIndex % poolSize;
        this.nextWorkerIndex += 1;
        return {
            worker: this.ensureWorker(workerIndex),
            workerIndex
        };
    },

    hashFile(file, onProgress) {
        return new Promise((resolve, reject) => {
            const { worker, workerIndex } = this.getNextWorker();
            const requestId = `hash-${Date.now()}-${++this.requestSequence}`;
            this.requests.set(requestId, { resolve, reject, onProgress, workerIndex });
            worker.postMessage({ requestId, file });
        });
    },

    async post(url, files) {
        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ files })
        });
        if (!response.ok) {
            throw new Error(`Duplicate check failed (${response.status})`);
        }
        return response.json();
    },

    async run(fileQueue, progressTracker, manager = null) {
        const pending = fileQueue.filter(file => !file.done);
        if (!pending.length) {
            return { skippedFiles: 0, skippedBytes: 0 };
        }

        const initial = await this.post(
            this.PRECHECK_URL,
            pending.map(file => ({
                id: file.id,
                name: file.name,
                size: file.size
            })));
        const actionById = new Map(
            (initial.files || []).map(item => [item.id, item.action]));
        const candidates = pending.filter(
            file => actionById.get(file.id) === 'hash_required');

        const verifiedFiles = [];
        const hashCandidate = async (file) => {
            progressTracker.setFileProgress(
                file,
                0,
                window.I18n?.t('file.checking') || 'Checking...');
            const sha256 = await this.hashFile(
                file.file,
                (processed, total) => {
                    if (processed === 0 || processed >= total) {
                        return;
                    }

                    progressTracker.setFileProgress(
                        file,
                        0,
                        window.I18n?.t('file.checking') || 'Checking...');
                });
            progressTracker.setFileProgress(
                file,
                0,
                window.I18n?.t('file.verifying') || 'Verifying...');
            verifiedFiles.push({
                id: file.id,
                name: file.name,
                size: file.size,
                sha256
            });
        };

        if (this.getHashWorkerCount() === 1 || candidates.length <= 1) {
            for (const file of candidates) {
                await hashCandidate(file);
            }
        } else {
            let candidateIndex = 0;
            const workerCount = Math.min(this.getHashWorkerCount(), candidates.length);
            const runners = Array.from({ length: workerCount }, async () => {
                while (candidateIndex < candidates.length) {
                    const file = candidates[candidateIndex++];
                    await hashCandidate(file);
                }
            });
            await Promise.all(runners);
        }

        if (!verifiedFiles.length) {
            return { skippedFiles: 0, skippedBytes: 0 };
        }

        const verified = await this.post(this.VERIFY_URL, verifiedFiles);
        const resultById = new Map(
            (verified.files || []).map(item => [item.id, item]));
        let skippedFiles = 0;
        let skippedBytes = 0;
        for (const file of candidates) {
            const result = resultById.get(file.id);
            if (result?.action === 'skip') {
                file.done = true;
                file.skipped = true;
                file.preflightSkipped = true;
                file.uploadedBytes = 0;
                if (manager && typeof manager.markFileCompletedWithoutUpload === 'function') {
                    manager.markFileCompletedWithoutUpload(file, file.size);
                } else {
                    file.completedBytes = file.size;
                }
                file.serverResult = {
                    skipped: true,
                    filename: result.filename
                };
                progressTracker.markFileSkipped(
                    file,
                    result.filename && result.filename !== file.name
                        ? `${window.I18n?.t('file.skipped') || 'Already exists'}: ${result.filename}`
                        : window.I18n?.t('file.skipped') || 'Already exists');
                skippedFiles++;
                skippedBytes += file.size;
            } else {
                progressTracker.markFileQueued?.(
                    file,
                    result?.action === 'upload_name_conflict'
                        ? 'Name exists; keeping both'
                        : window.I18n?.t('file.ready') || 'Ready to upload');
            }
        }
        return { skippedFiles, skippedBytes };
    },

    dispose() {
        this.workers.forEach(worker => worker?.terminate());
        this.workers = [];
        this.worker = null;
        this.requests.clear();
        this.nextWorkerIndex = 0;
    }
};
