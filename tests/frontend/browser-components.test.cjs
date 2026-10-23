const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function modules(overrides = {}) {
    const revoked = [];
    let nextUrl = 0;
    const context = vm.createContext({ window: {}, console, setTimeout, clearTimeout, performance,
        AbortController, Blob, URL: { createObjectURL: () => `blob:synthetic-${++nextUrl}`, revokeObjectURL: url => revoked.push(url) },
        IntersectionObserver: class {
            observe() { }
            unobserve() { }
            disconnect() { }
        }, ...overrides });
    for (const source of ['core/contracts', 'upload/selection', 'ui/file-list', 'ui/media-previews']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Server/static/js', source + '.js'), 'utf8'), context);
    }
    return { window: context.window, revoked };
}
test('runtime confirmations reject malformed or misleading receiver results', () => {
    const { window } = modules();
    for (const value of [null, [], {}, { success: 'true' }, { success: true, filename: {} }, { success: true, skipped: 'yes' }])
        assert.throws(() => window.TransferContracts.upload(value));
    assert.throws(() => window.TransferContracts.upload({ success: true }, true));
    assert.equal(window.TransferContracts.upload({ success: true, complete: true }, true).complete, true);
    assert.throws(() => window.TransferContracts.preflight({ files: [{ id: 'wrong', action: 'skip' }] }, new Set(['expected'])));
    assert.throws(() => window.TransferContracts.preflight({ files: [{ id: 'a', action: 'skip' }, { id: 'a', action: 'skip' }] }, new Set(['a'])));
});
test('selection ingestion serializes additions and reset invalidates late work', async () => {
    const { window } = modules();
    const selection = new window.BrowserSelection();
    const accepted = [];
    const first = selection.add([{ name: 'a' }], f => accepted.push(f.name), () => { });
    const second = selection.add([{ name: 'b' }], f => accepted.push(f.name), () => { });
    await Promise.all([first, second]);
    assert.deepEqual(accepted, ['a', 'b']);
    assert.equal(selection.pending, 0);
    const canceled = selection.add([{ name: 'c' }], f => accepted.push(f.name), () => { });
    selection.reset();
    await canceled;
    assert.deepEqual(accepted, ['a', 'b']);
    assert.equal(selection.pending, 0);
});
test('selection metadata failure releases pending work and permits another selection', async () => {
    const { window } = modules();
    const selection = new window.BrowserSelection();
    await assert.rejects(selection.add([{}, {}], () => { throw new Error('Unreadable metadata'); }, () => { }));
    assert.equal(selection.pending, 0);
    let accepted = 0;
    await selection.add([{}], () => accepted++, () => { });
    assert.equal(accepted, 1);
    assert.equal(selection.pending, 0);
});
test('file-list model searches saved names and bounds pages without reordering selection', () => {
    const { window } = modules();
    const model = new window.BrowserFileListModel();
    const files = Array.from({ length: 201 }, (_, i) => ({ id: String(i), name: `item-${i}`, done: i < 50, failed: false }));
    model.page = 2;
    assert.equal(model.select(files).files.length, 1);
    files[0].serverResult = { filename: 'Renamed.JPG' };
    model.query = 'renamed.jpg';
    const found = model.select(files);
    assert.equal(found.total, 1);
    assert.equal(found.files[0].id, '0');
    assert.equal(model.page, 0);
    model.query = '';
    model.filter = 'uploaded';
    assert.equal(model.select(files).total, 50);
});
test('preview scheduler prioritizes uploads, aborts decoding, and releases cached URLs', async () => {
    const { window, revoked } = modules();
    const previews = new window.BrowserMediaPreviews();
    const source = { id: 'a', name: 'a.jpg', file: { type: 'image/jpeg' }, size: 10 };
    previews.bindings.set({}, { source, visible: true, attempted: false });
    let starts = 0, active = 0, maxActive = 0;
    previews.decode = (_source, signal) => new Promise((resolve, reject) => { starts++; active++; maxActive = Math.max(maxActive, active); signal.addEventListener('abort', () => { active--; reject(new Error('aborted')); }, { once: true }); });
    previews.setPaused(true);
    await previews.pump();
    assert.equal(starts, 0);
    previews.setPaused(false);
    assert.equal(starts, 1);
    previews.setPaused(true);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(previews.running, false);
    assert.equal(previews.failed.size, 0);
    previews.decode = async () => new Blob(['synthetic']);
    previews.show = () => { };
    previews.setPaused(false);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(previews.cache.size, 1);
    assert.equal(maxActive, 1);
    previews.reset();
    assert.equal(previews.bindings.size, 0);
    assert.equal(previews.bytes, 0);
    assert.equal(revoked.length, 1);
});
test('preview failures and oversized output cannot create decode loops', async () => {
    const { window } = modules();
    const previews = new window.BrowserMediaPreviews();
    const source = { id: 'a', name: 'a.jpg', file: { type: 'image/jpeg' }, size: 10 };
    previews.bindings.set({}, { source, visible: true, attempted: false });
    let calls = 0;
    previews.decode = async () => { calls++; return new Blob([new Uint8Array(9 * 1024 * 1024)]); };
    previews.show = () => { };
    await previews.pump();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls, 1);
    assert.equal(previews.cache.size, 0);
    assert.equal(previews.running, false);
    assert.equal(previews.kind({ name: 'archive.rar', file: { type: '' } }), 'archive');
    previews.reset();
});

test('preview cache enforces both LRU entry and encoded-byte limits', async () => {
    const { window, revoked } = modules();
    const previews = new window.BrowserMediaPreviews();
    previews.show = () => {};
    previews.decode = async () => new Blob(['thumbnail']);
    for (let index = 0; index < 110; index++) {
        const source = { id: String(index), name: 'synthetic.jpg', size: 10, file: { type: 'image/jpeg' } };
        previews.bindings.set({}, { source, visible: true, attempted: false });
        await previews.pump();
    }
    assert.equal(previews.cache.size, 100);
    assert.equal(previews.cache.has('0'), false);
    assert.equal(revoked.length, 10);
    previews.reset();
    previews.decode = async () => new Blob([new Uint8Array(1024 * 1024)]);
    for (let index = 0; index < 9; index++) {
        const source = { id: String(index), name: 'synthetic.jpg', size: 10, file: { type: 'image/jpeg' } };
        previews.bindings.set({}, { source, visible: true, attempted: false });
        await previews.pump();
    }
    assert.equal(previews.bytes, 8 * 1024 * 1024);
    assert.equal(previews.cache.size, 8);
    previews.reset();
});

test('preview deadline releases source URLs and large images bypass decoding', async () => {
    let deadline = 0;
    const { window, revoked } = modules({
        Image: class { removeAttribute() {} }, HTMLVideoElement: class {},
        setTimeout(callback, milliseconds) { deadline = milliseconds; queueMicrotask(callback); return 1; },
        clearTimeout() {}
    });
    const previews = new window.BrowserMediaPreviews();
    await assert.rejects(previews.decode({ id: 'a', name: 'synthetic.jpg', file: { type: 'image/jpeg' }, size: 1 }, new AbortController().signal));
    assert.equal(deadline, 5000);
    assert.equal(revoked.length, 1);
    let decodes = 0;
    previews.decode = async () => { decodes++; return new Blob(['thumbnail']); };
    const source = { id: 'b', name: 'synthetic.jpg', file: { type: 'image/jpeg' }, size: 33 * 1024 * 1024 };
    previews.bindings.set({}, { source, visible: true, attempted: false });
    await previews.pump();
    assert.equal(decodes, 0);
    assert.equal(previews.failed.has('b'), true);
    previews.reset();
});
