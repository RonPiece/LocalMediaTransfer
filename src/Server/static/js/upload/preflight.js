/**
 * Candidate-based duplicate preflight.
 *
 * Metadata first identifies plausible matches. Only those files are read and
 * SHA-256 hashed, and the server remains authoritative about disk existence.
 */

const lmtPreflight = {
    PRECHECK_URL: '/upload/preflight',
    VERIFY_URL: '/upload/preflight/verify',
    REQUEST_TIMEOUT_MS: 30000,
    HASH_IDLE_MS: 30000,
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
            clearTimeout(pending.timer);
            if (message.type === 'progress') {
                pending.timer = setTimeout(pending.expire, this.HASH_IDLE_MS);
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
                    clearTimeout(pending.timer);
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
            const pending = { resolve, reject, onProgress, workerIndex, timer: null, expire: null };
            pending.expire = () => {
                // A stuck worker cannot accept another hash until it has been replaced.
                this.workers[workerIndex]?.terminate();
                this.workers[workerIndex] = null;
                for (const [id, request] of this.requests) {
                    if (request.workerIndex !== workerIndex) continue;
                    clearTimeout(request.timer);
                    request.reject(new Error('Hashing timed out'));
                    this.requests.delete(id);
                }
            };
            pending.timer = setTimeout(pending.expire, this.HASH_IDLE_MS);
            this.requests.set(requestId, pending);
            worker.postMessage({ requestId, file });
        });
    },

    async post(url, files) {
        // The receiver's limit applies per request, not per selection.
        const limit = window.TransferLimits.MaxQueuedFiles;
        if (files.length > limit) {
            const combined = [];
            for (let offset = 0; offset < files.length; offset += limit) {
                const batch = files.slice(offset, offset + limit);
                const response = await this.post(url, batch);
                combined.push(...window.TransferContracts.preflight(response, new Set(batch.map(file => file.id))));
            }
            return { files: combined };
        }
        const response = await window.lmtFetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ files })
        }, this.REQUEST_TIMEOUT_MS);
        if (!response.ok) {
            const error = new Error(`Duplicate check failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return response.json();
    },

    async run(fileQueue, observer) {
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
            window.TransferContracts.preflight(initial, new Set(pending.map(file => file.id))).map(item => [item.id, item.action]));
        const candidates = pending.filter(
            file => actionById.get(file.id) === 'hash_required');

        const verifiedFiles = [];
        let hashingStopped = false;
        const hashCandidate = async (file) => {
            observer.onChecking(file, 'file.checking');
            const sha256 = await this.hashFile(file.file, () => {});
            if (hashingStopped) return;
            if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Invalid hash result');
            observer.onChecking(file, 'file.verifying');
            verifiedFiles.push({
                id: file.id,
                name: file.name,
                size: file.size,
                sha256
            });
        };

        let candidateIndex = 0;
        const workerCount = Math.min(this.getHashWorkerCount(), candidates.length);
        const runners = Array.from({ length: workerCount }, async () => {
            try {
                while (!hashingStopped && candidateIndex < candidates.length) {
                    const file = candidates[candidateIndex++];
                    await hashCandidate(file);
                }
            } catch (error) {
                // Promise.all rejects immediately. Stop sibling workers before
                // the caller falls back to upload, so late hashes cannot alter rows.
                hashingStopped = true;
                this.dispose();
                throw error;
            }
        });
        await Promise.all(runners);

        if (!verifiedFiles.length) {
            return { skippedFiles: 0, skippedBytes: 0 };
        }

        const verified = await this.post(this.VERIFY_URL, verifiedFiles);
        const resultById = new Map(
            window.TransferContracts.preflight(verified, new Set(candidates.map(file => file.id))).map(item => [item.id, item]));
        let skippedFiles = 0;
        let skippedBytes = 0;
        for (const file of candidates) {
            const result = resultById.get(file.id);
            observer.onDecision(file, result);
            if (result?.action === 'skip') { skippedFiles++; skippedBytes += file.size; }
        }

        return { skippedFiles, skippedBytes };
    },

    dispose() {
        this.workers.forEach(worker => worker?.terminate());
        this.workers = [];
        this.worker = null;
        for (const request of this.requests.values()) {
            clearTimeout(request.timer);
            request.reject(new Error('Hashing stopped'));
        }
        this.requests.clear();
        this.nextWorkerIndex = 0;
    }
};

window.DuplicatePreflight = lmtPreflight;
