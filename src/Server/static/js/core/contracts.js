/** Runtime boundaries for untrusted receiver JSON. No transport or DOM ownership. */
const lmtContracts = {
    /** @param {unknown} value @returns {Error} */
    error(value) {
        if (value instanceof Error)
            return value;
        const error = new Error(this.object(value) && typeof value.message === 'string' ? value.message : 'Transfer failed');
        if (this.object(value)) {
            if (typeof value.status === 'number' && Number.isFinite(value.status))
                error.status = value.status;
            if (typeof value.retryable === 'boolean')
                error.retryable = value.retryable;
        }
        return error;
    },
    /** @param {unknown} value @returns {value is Record<string, unknown>} */
    object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); },
    /** @param {unknown} value @param {boolean} finalChunk @param {number} [chunkIndex] @param {number} [totalChunks] @returns {UploadConfirmation} */
    upload(value, finalChunk = false, chunkIndex, totalChunks) {
        if (!this.object(value) || value.success !== true ||
            (finalChunk && value.complete !== true) ||
            (value.filename !== undefined && typeof value.filename !== 'string') ||
            (value.skipped !== undefined && typeof value.skipped !== 'boolean') ||
            (value.complete !== undefined && typeof value.complete !== 'boolean') ||
            (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256))) ||
            (chunkIndex !== undefined && ((value.chunkIndex !== undefined && value.chunkIndex !== chunkIndex) ||
                (value.totalChunks !== undefined && value.totalChunks !== totalChunks) || (!finalChunk && value.complete === true)))) {
            throw Object.assign(new Error('Invalid upload confirmation'), { retryable: false });
        }
        return { success: true, filename: typeof value.filename === 'string' ? value.filename : undefined,
            skipped: typeof value.skipped === 'boolean' ? value.skipped : undefined,
            complete: typeof value.complete === 'boolean' ? value.complete : undefined };
    },
    /** @param {unknown} value @param {Set<string>} ids @returns {PreflightConfirmation[]} */
    preflight(value, ids) {
        if (!this.object(value) || !Array.isArray(value.files))
            throw new Error('Invalid duplicate response');
        const seen = new Set();
        return value.files.map((item) => {
            if (!this.object(item) || typeof item.id !== 'string' || !ids.has(item.id) || seen.has(item.id) ||
                typeof item.action !== 'string' || !['upload', 'skip', 'hash_required', 'upload_name_conflict', 'inconclusive'].includes(item.action) ||
                (item.filename !== undefined && typeof item.filename !== 'string'))
                throw new Error('Invalid duplicate result');
            seen.add(item.id);
            return { id: item.id, action: item.action, filename: typeof item.filename === 'string' ? item.filename : undefined };
        });
    },
    /** @param {unknown} value @param {number} maximum @param {number} fallback */
    boundedInteger(value, maximum, fallback) {
        return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
    }
};
window.TransferContracts = lmtContracts;
