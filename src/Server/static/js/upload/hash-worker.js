/* global hashwasm */
'use strict';

importScripts('/static/vendor/hash-wasm/sha256.umd.min.js');

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

self.onmessage = async (event) => {
    const { requestId, file } = event.data || {};
    try {
        if (!requestId || !file) {
            throw new Error('Invalid hash request');
        }

        const hasher = await hashwasm.createSHA256();
        hasher.init();
        let offset = 0;
        while (offset < file.size) {
            const end = Math.min(offset + HASH_CHUNK_BYTES, file.size);
            const bytes = new Uint8Array(
                await file.slice(offset, end).arrayBuffer());
            hasher.update(bytes);
            offset = end;
            self.postMessage({
                requestId,
                type: 'progress',
                processedBytes: offset,
                totalBytes: file.size
            });
        }
        self.postMessage({
            requestId,
            type: 'complete',
            sha256: hasher.digest('hex')
        });
    } catch (error) {
        self.postMessage({
            requestId,
            type: 'error',
            error: error?.message || 'Unable to hash file'
        });
    }
};
