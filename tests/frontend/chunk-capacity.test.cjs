const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const ios of [false, true]) {
    test(`chunk capacity rejects before reading media (iOS=${ios})`, async () => {
        const context = { window: { Utils: { isIOSLike: () => ios } } };
        vm.createContext(context);
        vm.runInContext(fs.readFileSync(path.join(__dirname,
            '../../src/Server/static/js/core/transfer-limits.js'), 'utf8'), context);
        vm.runInContext(fs.readFileSync(path.join(__dirname,
            '../../src/Server/static/js/upload/workers.js'), 'utf8'), context);
        const workers = context.window.UploadWorkers;
        const configured = (ios ? 16 : 4) * 1024 * 1024;
        const effective = ios ? 8 * 1024 * 1024 : configured;
        let started = false;
        workers.buildChunkFileId = () => 'test';
        const manager = { chunkSizeBytes: configured, logClientEvent() {
            started = true;
            throw new Error('accepted boundary');
        } };
        const file = { size: effective * 10000 + 1, slice() {
            throw new Error('must not read media');
        } };
        await assert.rejects(workers.uploadChunked({ file }, manager), /10,000 chunks/);
        assert.equal(started, false);
        file.size--;
        await assert.rejects(workers.uploadChunked({ file }, manager), /accepted boundary/);
        assert.equal(started, true);
        started = false;
        workers.isIOSLike = () => false;
        manager.chunkSizeBytes = 64 * 1024 * 1024;
        file.size = context.window.TransferLimits.MaxFileBytes + 1;
        await assert.rejects(workers.uploadChunked({ file }, manager), /file-size limit/);
        assert.equal(started, false);
    });
}
