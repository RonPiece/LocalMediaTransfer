const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        toggle(value, enabled) {
            if (enabled) values.add(value);
            else values.delete(value);
        },
        contains(value) { return values.has(value); }
    };
}

function createElement() {
    return {
        disabled: false,
        value: '',
        textContent: '',
        innerHTML: '',
        dataset: {},
        attributes: {},
        classList: createClassList(),
        firstChild: null,
        addEventListener() {},
        appendChild() {},
        insertBefore(child) {
            this.firstChild = child;
        },
        click() {},
        remove() { this.removed = true; },
        removeAttribute(name) { delete this.attributes[name]; },
        setAttribute(name, value) { this.attributes[name] = value; }
    };
}

function createContext(navigatorOverrides = {}) {
    const elements = new Map();
    const document = {
        readyState: 'complete',
        title: 'Local Media Transfer',
        hidden: false,
        visibilityState: 'visible',
        body: createElement(),
        addEventListener() {},
        createElement() { return createElement(); },
        createDocumentFragment() { return { appendChild() {} }; },
        getElementById(id) {
            if (id === 'tokenBanner' && !elements.has(id)) return null;
            if (!elements.has(id)) elements.set(id, createElement());
            return elements.get(id);
        }
    };
    document.body.insertBefore = child => {
        document.body.firstChild = child;
        if (child.id) elements.set(child.id, child);
    };

    const window = {
        I18n: { t: (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), require('../../src/Server/static/i18n/en.json')[key] || key) },
        location: {
            href: 'http://localhost:8080/?token=test',
            pathname: '/',
            search: '?token=test',
            hash: ''
        },
        history: {
            replaced: null,
            replaceState(_state, _title, url) { this.replaced = url; }
        },
        addEventListener() {},
        ProgressTracker: {
            remember() {},
            registerGroup() {},
            createGroupContainer() { return { appendChild() {} }; },
            renderFileItem() {},
            updateStatsUI() {},
            updateAggregateProgress() {},
            updateCurrentSpeedDisplay() { return 0; },
            markFileQueued() {},
            setFileProgress() {},
            markFileSkipped() {},
            markFileSuccess() {},
            markFileError() {}
        },
        Utils: {
            generateFileId() { return 'file-id'; },
            formatTime(value) { return String(value); }
        },
        Modals: {
            showNoFilesModal() {},
            showAlreadyUploadedModal() {},
            showUploadCompleteModal() {},
            showTokenModal() {}
        },
        SecurityManager: {
            token: 'test',
            isValid: true,
            init: async () => {},
            verifyTokenWithServer: async () => true,
            enableControls() {},
            disableControls() {}
        },
        uploadCacheManager: { performCleanup: async () => {} },
        DuplicatePreflight: {
            run: async () => ({ skippedFiles: 0, skippedBytes: 0 })
        }
    };

    let nextTimer = 1;
    const activeTimers = new Set();
    const context = {
        window,
        document,
        navigator: {
            userAgent: 'Node Test',
            platform: '',
            maxTouchPoints: 0,
            ...navigatorOverrides
        },
        console,
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        URLSearchParams,
        AbortController,
        Date,
        performance: { now: () => Date.now() },
        Math,
        Array,
        Promise,
        setTimeout,
        clearTimeout,
        setInterval() {
            const id = nextTimer++;
            activeTimers.add(id);
            return id;
        },
        clearInterval(id) { activeTimers.delete(id); }
    };

    window.lmtFetch = (url, options) => context.fetch(url, options);
    vm.createContext(context);
    return { context, elements, activeTimers };
}

function loadScript(context, relativePath) {
    const scriptPath = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(scriptPath, 'utf8');
    vm.runInContext(source, context, { filename: scriptPath });
}

function loadManager(navigatorOverrides = {}) {
    const harness = createContext(navigatorOverrides);
    loadScript(harness.context, '../../src/Server/static/js/core/utils.js');
    loadScript(harness.context, '../../src/Server/static/js/core/transfer-limits.js');
    loadScript(harness.context, '../../src/Server/static/js/core/telemetry.js');
    loadScript(harness.context, '../../src/Server/static/js/core/throughput.js');
    loadScript(harness.context, '../../src/Server/static/js/core/contracts.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/selection.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/accounting.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/controller.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/manager.js');
    return { ...harness, manager: harness.context.window.UploadManager };
}

function loadWorkers(navigatorOverrides = {}) {
    const harness = createContext(navigatorOverrides);
    harness.context.crypto = require('node:crypto').webcrypto;
    harness.context.AbortController = AbortController;
    loadScript(harness.context, '../../src/Server/static/js/core/transfer-limits.js');
    loadScript(harness.context, '../../src/Server/static/js/core/utils.js');
    loadScript(harness.context, '../../src/Server/static/js/core/contracts.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/accounting.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/controller.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/workers.js');
    const original = harness.context.window.UploadWorkers.uploadSingle;
    harness.context.window.UploadWorkers.uploadSingle = (meta, manager) => { Object.setPrototypeOf(manager, harness.context.window.TransferController); return original(meta, manager); };
    return { ...harness, workers: harness.context.window.UploadWorkers };
}

function loadPreflight(navigatorOverrides = {}) {
    const harness = createContext(navigatorOverrides);
    loadScript(harness.context, '../../src/Server/static/js/core/transfer-limits.js');
    loadScript(harness.context, '../../src/Server/static/js/core/contracts.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/accounting.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/controller.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/preflight.js');
    const original = harness.context.window.DuplicatePreflight.run;
    harness.context.window.DuplicatePreflight.run = (files, tracker, owner) => { const controller = owner || harness.context.window.TransferController; Object.setPrototypeOf(controller, harness.context.window.TransferController === controller ? Object.prototype : harness.context.window.TransferController); harness.context.window.ProgressTracker = { ...harness.context.window.ProgressTracker, ...tracker, remember: tracker.remember || (() => {}) }; return original.call(harness.context.window.DuplicatePreflight, files, controller.preflightObserver()); };
    return {
        ...harness,
        preflight: harness.context.window.DuplicatePreflight
    };
}

function loadSecurity(authorizationStore = new Map()) {
    const harness = createContext();
    harness.context.localStorage = {
        getItem(key) { return authorizationStore.get(key) || null; },
        setItem(key, value) { authorizationStore.set(key, value); },
        removeItem(key) { authorizationStore.delete(key); }
    };
    harness.context.window.I18n = {
        t(key) {
            return key === 'security.disabledTitle'
                ? 'locked'
                : key === 'security.lockedBanner'
                    ? 'locked banner'
                    : '';
        }
    };
    loadScript(harness.context, '../../src/Server/static/js/core/security.js');
    return {
        ...harness,
        authorizationStore,
        security: harness.context.window.SecurityManager
    };
}

function loadStorage() {
    const harness = createContext();
    const localStore = new Map([
        ['lmt.language', 'he'],
        ['upload_session_data', 'remove-local'],
        ['unrelated_upload_like_key', 'keep-local']
    ]);
    const sessionStore = new Map([
        ['lmt.language', 'ru'],
        ['lmt.upload.session', 'remove-session'],
        ['other_transfer_key', 'keep-session']
    ]);
    harness.context.localStorage = {
        removeItem(key) { localStore.delete(key); },
        getItem(key) { return localStore.get(key) || null; },
        key(index) { return Array.from(localStore.keys())[index] || null; },
        get length() { return localStore.size; }
    };
    harness.context.sessionStorage = {
        removeItem(key) { sessionStore.delete(key); },
        getItem(key) { return sessionStore.get(key) || null; },
        key(index) { return Array.from(sessionStore.keys())[index] || null; },
        get length() { return sessionStore.size; }
    };
    harness.context.window.caches = {
        keys: async () => ['LocalMediaTransferUploads', 'third-party-upload-cache'],
        deleted: [],
        async delete(name) {
            this.deleted.push(name);
            return true;
        }
    };
    harness.context.caches = harness.context.window.caches;
    harness.context.URL = {
        revoked: [],
        revokeObjectURL(url) {
            this.revoked.push(url);
        }
    };
    loadScript(harness.context, '../../src/Server/static/js/core/storage.js');
    return {
        ...harness,
        localStore,
        sessionStore,
        storage: harness.context.window.uploadCacheManager
    };
}

test('preflight hashes only server-selected candidates and skips before upload', async () => {
    const { context, preflight } = loadPreflight();
    const files = [
        { id: 'candidate', name: 'same.bin', size: 10, file: { size: 10 } },
        { id: 'new', name: 'new.bin', size: 20, file: { size: 20 } }
    ];
    let hashCalls = 0;
    let requestCount = 0;
    preflight.hashFile = async () => {
        hashCalls++;
        return 'a'.repeat(64);
    };
    context.fetch = async () => {
        requestCount++;
        return requestCount === 1
            ? {
                ok: true,
                json: async () => ({
                    files: [
                        { id: 'candidate', action: 'hash_required' },
                        { id: 'new', action: 'upload' }
                    ]
                })
            }
            : {
                ok: true,
                json: async () => ({
                    files: [{
                        id: 'candidate',
                        action: 'skip',
                        filename: 'same.bin'
                    }]
                })
            };
    };

    const result = await preflight.run(files, context.window.ProgressTracker);

    assert.equal(hashCalls, 1);
    assert.equal(result.skippedFiles, 1);
    assert.equal(result.skippedBytes, 10);
    assert.equal(files[0].done, true);
    assert.equal(files[0].preflightSkipped, true);
    assert.equal(files[0].uploadedBytes, 0);
    assert.equal(files[0].completedBytes, 10);
    assert.equal(files[1].done, undefined);
});

test('a failed file recovered by duplicate verification clears its prior failure', async () => {
    const { preflight, context } = loadPreflight();
    const file = { id: 'candidate', name: 'synthetic.bin', size: 10, file: {},
        failed: true, retryable: true, failure: { message: 'Temporary failure' } };
    const manager = { errorCount: 1, markFileCompletedWithoutUpload() {} };
    preflight.hashFile = async () => 'a'.repeat(64);
    preflight.post = async url => ({ files: [{ id: file.id,
        action: url === preflight.PRECHECK_URL ? 'hash_required' : 'skip' }] });
    await preflight.run([file], context.window.ProgressTracker, manager);
    assert.equal(file.failed, false);
    assert.equal(file.retryable, false);
    assert.equal(file.failure, undefined);
    assert.equal(manager.errorCount, 0);
});

test('failed parallel hashing disposes siblings before upload fallback', async () => {
    const { preflight, context } = loadPreflight({ hardwareConcurrency: 4 });
    let terminated = 0;
    context.Worker = class {
        postMessage({ requestId, file }) {
            if (file.fail) queueMicrotask(() => this.onmessage({ data: { requestId, type: 'error' } }));
        }
        terminate() { terminated++; }
    };
    const files = [true, false, false].map((fail, i) => ({ id: String(i), file: { fail } }));
    preflight.post = async () => ({ files: files.map(file => ({ id: file.id, action: 'hash_required' })) });
    try {
        await assert.rejects(preflight.run(files, context.window.ProgressTracker), /Hashing failed/);
        assert.equal(preflight.requests.size, 0);
        assert.equal(terminated, 2);
    } finally {
        preflight.dispose();
    }
});

test('chunk retry cannot start a new request after another file loses authentication', async () => {
    const { workers, context } = loadWorkers();
    context.window.TransferSession = { state: 'busy' };
    context.setTimeout = callback => {
        context.window.TransferSession.state = 'blocked';
        callback();
        return 1;
    };
    let attempts = 0;
    context.XMLHttpRequest = class {
        constructor() { this.upload = {}; }
        open() {} setRequestHeader() {}
        send() { attempts++; this.onerror(); }
    };
    workers.ownRequest = () => {};
    await assert.rejects(workers.uploadChunkXHR('/upload_chunk', {}, { size: 4 }, 1000, 2, {}));
    assert.equal(attempts, 1);
});

test('late history failure cannot attach diagnostics to a later queue', async () => {
    const { manager, context } = loadManager();
    let rejectHistory;
    context.window.lmtFetch = () => new Promise((_resolve, reject) => { rejectHistory = reject; });
    let diagnostics = 0;
    manager.logClientEvent = () => { diagnostics++; };
    const pending = manager.submitTransferHistory(1);
    manager.fileQueue = [];
    rejectHistory(new Error('Previous request timed out'));
    await pending;
    assert.equal(diagnostics, 0);
});

test('history never labels unattempted files as uploaded after authentication loss', async () => {
    const { manager, context } = loadManager();
    manager.fileQueue = [
        { id: 'saved', size: 1, done: true, failed: false },
        { id: 'aborted', size: 2, done: true, failed: true },
        { id: 'unattempted', size: 3, done: false, failed: false }
    ];
    manager.errorCount = 1;
    let payload;
    context.window.lmtFetch = async (_url, options) => {
        payload = JSON.parse(options.body);
        return { ok: true };
    };
    await manager.submitTransferHistory(1);
    assert.equal(payload.uploadedFiles, 1);
    assert.equal(payload.failedFiles, 2);
    assert.deepEqual(payload.files.map(file => file.outcome), ['uploaded', 'failed', 'failed']);
});

test('preflight hash worker count stays single on mobile and capped on desktop', () => {
    const mobile = loadPreflight({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        hardwareConcurrency: 8
    });
    const desktop = loadPreflight({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        hardwareConcurrency: 16
    });

    assert.equal(mobile.preflight.getHashWorkerCount(), 1);
    assert.equal(desktop.preflight.getHashWorkerCount(), 2);
});

test('security token verification fails closed on server and network errors', async () => {
    const { context, security } = loadSecurity();

    assert.equal(await security.verifyTokenWithServer(''), false);

    context.fetch = async () => ({ ok: false, json: async () => ({ valid: true }) });
    assert.equal(await security.verifyTokenWithServer('bad'), false);

    context.fetch = async () => ({ ok: true, json: async () => { throw new Error('not-json'); } });
    assert.equal(await security.verifyTokenWithServer('bad-json'), false);

    context.fetch = async () => { throw new Error('offline'); };
    assert.equal(await security.verifyTokenWithServer('offline'), false);
});

test('invalid token state locks upload controls until verification succeeds', () => {
    const { security, elements } = loadSecurity();

    security.disableControls();

    const section = elements.get('uploadSection');
    assert.equal(section.classList.contains('secure-locked'), true);
    for (const id of ['fileInput', 'chooseBtn', 'uploadBtn', 'resetBtn']) {
        const control = elements.get(id);
        assert.equal(control.disabled, true);
        assert.equal(control.attributes['aria-disabled'], 'true');
        assert.equal(control.title, 'locked');
        assert.equal(control.attributes['data-i18n-title'], 'security.disabledTitle');
    }
    const banner = section.firstChild;
    assert.equal(banner.textContent, 'locked banner');
    assert.equal(banner.attributes['data-i18n'], 'security.lockedBanner');

    security.enableControls();
    assert.equal(section.classList.contains('secure-locked'), false);
    for (const id of ['fileInput', 'chooseBtn', 'uploadBtn', 'resetBtn']) {
        const control = elements.get(id);
        assert.equal(control.disabled, false);
        assert.equal(control.attributes['aria-disabled'], undefined);
        assert.equal(control.attributes['data-i18n-title'], undefined);
    }
});

test('security errors use localized message keys for missing and expired links', async () => {
    const missingHarness = loadSecurity();
    let missingModal;
    missingHarness.context.window.location.search = '';
    missingHarness.context.window.location.hash = '';
    missingHarness.context.window.Modals.showTokenModal = options => {
        missingModal = options;
    };

    await missingHarness.security.init();

    assert.equal(missingHarness.security.failureReason, 'missing');
    assert.deepEqual(
        { ...missingModal },
        {
            titleKey: 'modal.securityTitle',
            messageKey: 'modal.noToken'
        });

    const expiredHarness = loadSecurity();
    let expiredModal;
    expiredHarness.context.window.location.search = '';
    expiredHarness.context.window.location.hash = `#bootstrap=${'b'.repeat(64)}`;
    expiredHarness.context.window.Modals.showTokenModal = options => {
        expiredModal = options;
    };
    expiredHarness.context.fetch = async () => ({ ok: false });

    await expiredHarness.security.init();

    assert.equal(expiredHarness.security.failureReason, 'invalid');
    assert.deepEqual(
        { ...expiredModal },
        {
            titleKey: 'modal.invalidTokenTitle',
            messageKey: 'modal.invalidToken'
        });
});

test('storage cleanup keeps unrelated keys and does not force garbage collection', async () => {
    const { context, localStore, sessionStore, storage } = loadStorage();
    let gcCalled = false;
    context.window.gc = () => { gcCalled = true; };

    await storage.clearBrowserCaches();

    assert.equal(gcCalled, false);
    assert.equal(localStore.has('lmt.language'), true);
    assert.equal(localStore.has('unrelated_upload_like_key'), true);
    assert.equal(localStore.has('upload_session_data'), false);
    assert.equal(sessionStore.has('lmt.language'), true);
    assert.equal(sessionStore.has('other_transfer_key'), true);
    assert.equal(sessionStore.has('lmt.upload.session'), false);
    assert.deepEqual(context.caches.deleted, ['LocalMediaTransferUploads']);
});

test('storage source does not call window.gc or broad-delete storage keys', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/js/core/storage.js'),
        'utf8');

    assert.equal(source.includes('window.gc'), false);
    assert.equal(source.includes('key.includes'), false);
    assert.equal(source.includes('cacheName.includes'), false);
    assert.equal(source.includes('forceGarbageCollection'), false);
});

test('modal source builds dialogs without innerHTML and scopes Escape to document', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/js/ui/modals.js'),
        'utf8');

    assert.equal(source.includes('innerHTML'), false);
    assert.equal(source.includes('document.addEventListener(\'keydown\''), true);
    assert.equal(source.includes('document.removeEventListener(\'keydown\''), true);
    assert.equal(source.includes('allowedActions'), true);
});

test('preflight checking does not show fake 99 percent per-file progress', async () => {
    const { context, preflight } = loadPreflight();
    const files = [
        { id: 'candidate', name: 'same.bin', size: 100, file: { size: 100 } }
    ];
    const progressCalls = [];

    preflight.hashFile = async (_file, onProgress) => {
        onProgress(99, 100);
        return 'a'.repeat(64);
    };

    let requestCount = 0;
    context.fetch = async () => {
        requestCount++;
        return requestCount === 1
            ? {
                ok: true,
                json: async () => ({
                    files: [{ id: 'candidate', action: 'hash_required' }]
                })
            }
            : {
                ok: true,
                json: async () => ({
                    files: [{
                        id: 'candidate',
                        action: 'skip',
                        filename: 'same.bin'
                    }]
                })
            };
    };

    context.window.ProgressTracker = {
        renderSnapshot(file) {
            if (file.presentation.state === 'queued') progressCalls.push({ id: file.id, percent: file.presentation.percent, text: file.presentation.text });
        },
        markFileSkipped() {},
        markFileQueued() {}
    };

    await preflight.run(files, context.window.ProgressTracker);

    assert.equal(
        progressCalls.some(call => call.percent === 99 || /99%/.test(call.text)),
        false);
    assert.deepEqual(
        [...new Set(progressCalls.map(call => call.text))],
        ['Checking...', 'Verifying...']);
});

test('workers claim each queued file once without repeated queue find scans', async () => {
    const { context, manager } = loadManager();
    const processed = [];
    manager.logClientEvent = () => {};
    manager.fileQueue = [
        { id: 'a', done: false, running: false },
        { id: 'b', done: true, running: false },
        { id: 'c', done: false, running: false },
        { id: 'd', done: false, running: false }
    ];
    manager.nextUploadIndex = 0;
    manager.pendingCount = 3;
    context.window.UploadWorkers = {
        async uploadSingle(file) {
            processed.push(file.id);
            file.done = true;
        }
    };

    await Promise.all([manager.worker(), manager.worker(), manager.worker()]);

    assert.deepEqual(processed.sort(), ['a', 'c', 'd']);
    assert.equal(new Set(processed).size, processed.length);
    assert.equal(manager.pendingCount, 0);
    assert.equal(manager.running, 0);
});

test('manager maintains upload counters without scanning the queue', () => {
    const { manager } = loadManager();
    const first = { size: 100, uploadedBytes: 0, completedBytes: 0 };
    const skipped = { size: 40, uploadedBytes: 0, completedBytes: 0 };

    manager.globalUploadedBytes = 0;
    manager.globalCompletedBytes = 0;
    manager.networkBytesUploaded = 0;

    manager.updateFileTransferProgress(first, 25);
    manager.updateFileTransferProgress(first, 80);
    manager.updateFileTransferProgress(first, 60);
    manager.markFileCompletedWithoutUpload(skipped, 40);

    assert.equal(first.uploadedBytes, 80);
    assert.equal(first.completedBytes, 80);
    assert.equal(skipped.uploadedBytes, 0);
    assert.equal(skipped.completedBytes, 40);
    assert.equal(manager.globalUploadedBytes, 80);
    assert.equal(manager.globalCompletedBytes, 120);
    assert.equal(manager.networkBytesUploaded, 80);
});

test('acknowledged rates ignore duplicate progress and expire without queue scans', () => {
    const { context, manager } = loadManager();
    const file = { size: 1_000_000 };
    let now = 10_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
        manager.throughput = new context.window.BrowserThroughputTracker(now, 100_000);
        now += 1000;
        manager.recordFileAcknowledgement(file, 500_000);
        manager.recordFileAcknowledgement(file, 500_000);
        manager.recordFileAcknowledgement(file, 100_000);
        assert.equal(manager.getCurrentSpeedForDisplay(), 500_000);
        assert.equal(manager.throughput.snapshot().acknowledgedMediaBytes, 500_000);
        now += 5001;
        assert.equal(manager.getCurrentSpeedForDisplay(), 0);
        manager.recordFileAcknowledgement(file, 1_000_000);
        assert.equal(manager.getCurrentSpeedForDisplay(), 100_000);
    } finally {
        Date.now = originalNow;
    }
});

test('desktop-mode iPadOS is detected as iOS and mobile', () => {
    const { context, manager } = loadManager({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5
    });

    assert.equal(context.window.Utils.isIOSLike(), true);
    assert.equal(context.window.Utils.isMobileLike(), true);
    assert.equal(manager.isMobile, true);
});

test('browser-specific receiver tuning is applied before upload', async () => {
    const { context, manager } = loadManager();
    context.fetch = async () => ({
        ok: true,
        json: async () => ({
            browser: {
                mobile: { chunkSizeBytes: 8, parallelFiles: 2 },
                desktop: { chunkSizeBytes: 16, parallelFiles: 3 }
            },
            desktop: { chunkSizeBytes: 4, parallelFiles: 6 },
            shared: { singleFileMaxBytes: 100 }
        })
    });

    await manager.loadServerConfig();

    assert.equal(manager.chunkSizeBytes, 16);
    assert.equal(manager.CONCURRENCY, 3);
    assert.equal(manager.SINGLE_FILE_MAX_BYTES, 100);
});

test('iPadOS files above the server whole-file limit use chunked upload', () => {
    const { workers } = loadWorkers({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5
    });
    const manager = { SINGLE_FILE_MAX_BYTES: 100 * 1024 * 1024 };
    const meta = { file: { size: 192 * 1024 * 1024 } };

    assert.equal(workers.shouldUseChunkedUpload(meta, manager), true);
});

test('server timing is accumulated without recording request metadata', () => {
    const { workers } = loadWorkers();
    const meta = {};
    const originalNow = Date.now;
    Date.now = () => 1250;
    try {
        workers.recordRequestTiming(meta, 1000, {
            getResponseHeader: () => 'app;dur=40.5, write;dur=25, finalize;dur=10'
        });
    } finally {
        Date.now = originalNow;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(meta.transferTiming)), {
        requestCount: 1,
        requestDurationMs: 250,
        serverDurationMs: 40.5,
        serverWriteDurationMs: 25,
        serverFinalizeDurationMs: 10,
        maxRequestDurationMs: 250
    });
});

test('queue mutation is blocked while an upload is active', () => {
    const { manager } = loadManager();
    const events = [];
    manager.logClientEvent = (...args) => events.push(args);
    manager.fileQueue = [];
    manager.isUploadInProgress = true;

    const accepted = manager.addFiles([{ name: 'blocked.bin', size: 10 }]);

    assert.equal(accepted, false);
    assert.equal(manager.fileQueue.length, 0);
    assert.equal(events[0][1], 'queue_mutation_blocked');
});

test('upload re-entry does not start another worker set', async () => {
    const { manager } = loadManager();
    let workerCalls = 0;
    manager.logClientEvent = () => {};
    manager.fileQueue = [{ done: false }];
    manager.isUploadInProgress = true;
    manager.worker = async () => { workerCalls++; };

    await manager.uploadFiles();

    assert.equal(workerCalls, 0);
    assert.equal(manager.isUploadInProgress, true);
});

test('upload completion clears timers and restores controls', async () => {
    const { manager, activeTimers } = loadManager();
    const uiStates = [];
    manager.logClientEvent = () => {};
    manager.fileQueue = [{ done: false, running: false, size: 5, uploadedBytes: 0 }];
    manager.totalBytes = 5;
    manager.CONCURRENCY = 1;
    manager.setUploadUiState = state => uiStates.push(state);
    manager.startStallWatchdog = () => {};
    manager.stopStallWatchdog = () => {};
    manager.worker = async () => {
        manager.fileQueue[0].done = true;
        manager.fileQueue[0].uploadedBytes = 5;
        manager.fileQueue[0].completedBytes = 5;
    };

    await manager.uploadFiles();

    assert.deepEqual(uiStates, [true, false]);
    assert.equal(manager.totalTimerInterval, null);
    assert.equal(manager.speedInterval, null);
    assert.equal(manager.isUploadInProgress, false);
    assert.equal(activeTimers.size, 0);
});

test('all preflight duplicates complete once without starting upload workers', async () => {
    const { context, manager } = loadManager();
    const summaries = [];
    let workerCalls = 0;
    manager.logClientEvent = () => {};
    manager.fileQueue = [{
        id: 'duplicate',
        name: 'same.bin',
        size: 10,
        done: false,
        running: false,
        uploadedBytes: 0,
        completedBytes: 0
    }];
    manager.totalBytes = 10;
    manager.CONCURRENCY = 2;
    manager.setUploadUiState = () => {};
    manager.startStallWatchdog = () => {};
    manager.stopStallWatchdog = () => {};
    manager.worker = async () => { workerCalls++; };
    context.window.DuplicatePreflight.run = async files => {
        files[0].done = true;
        files[0].skipped = true;
        files[0].preflightSkipped = true;
        files[0].completedBytes = 10;
        return { skippedFiles: 1, skippedBytes: 10 };
    };
    const finish = manager.finishSummary.bind(manager);
    manager.finishSummary = value => { finish(value); summaries.push([value]); };

    await manager.uploadFiles();

    assert.equal(workerCalls, 0);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0][0].uploaded, 0);
    assert.equal(summaries[0][0].skipped, 1);
    assert.equal(Number.isFinite(summaries[0][0].totalDurationMs), true);
    assert.equal(summaries[0][0].totalDurationMs >= 0, true);
    assert.equal(manager.currentPhase, 'complete');
    assert.equal(manager.networkBytesUploaded, 0);
    assert.equal(manager.skippedBytes, 10);
});

test('upload phases progress from checking through completion', async () => {
    const { manager } = loadManager();
    const phases = [];
    const originalSetRunPhase = manager.setRunPhase.bind(manager);
    manager.setRunPhase = (phase, label) => {
        phases.push(phase);
        originalSetRunPhase(phase, label);
    };
    manager.logClientEvent = () => {};
    manager.fileQueue = [{
        id: 'new',
        name: 'new.bin',
        size: 5,
        done: false,
        running: false,
        uploadedBytes: 0,
        completedBytes: 0
    }];
    manager.totalBytes = 5;
    manager.CONCURRENCY = 1;
    manager.setUploadUiState = () => {};
    manager.startStallWatchdog = () => {};
    manager.stopStallWatchdog = () => {};
    manager.worker = async () => {
        manager.fileQueue[0].done = true;
        manager.fileQueue[0].uploadedBytes = 5;
        manager.fileQueue[0].completedBytes = 5;
    };

    await manager.uploadFiles();

    assert.deepEqual(phases, ['checking', 'uploading', 'verifying', 'complete']);
});

test('one-time browser bootstrap is exchanged and removed from browser history', async () => {
    const { context, security, authorizationStore } = loadSecurity();
    const bootstrap = 'a'.repeat(64);
    context.window.location.search = '';
    context.window.location.hash = `#bootstrap=${bootstrap}`;
    const requests = [];
    context.fetch = async (url, options) => {
        requests.push({ url, options });
        if (url === '/exchange_bootstrap') {
            return { ok: true, json: async () => ({ token: 'memory-only-token' }) };
        }
        return { ok: true, json: async () => ({ valid: true }) };
    };

    await security.init();

    assert.equal(security.token, 'memory-only-token');
    assert.equal(security.isValid, true);
    assert.equal(
        authorizationStore.get('lmt.browser.authorization.v1'),
        'memory-only-token');
    assert.equal(context.window.history.replaced, '/');
    assert.equal(requests[0].url, '/exchange_bootstrap');
    assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
    assert.equal(requests[0].options.credentials, 'omit');
    assert.equal(requests[0].options.body.includes(bootstrap), true);
    assert.equal(requests[1].url, '/verify_token');
});

test('browser authorization survives refresh and clears after server rejection', async () => {
    const authorizationStore = new Map([
        ['lmt.browser.authorization.v1', 'temporary-browser-token']
    ]);
    const first = loadSecurity(authorizationStore);
    first.context.window.location.search = '';
    first.context.window.location.hash = '';
    const firstRequests = [];
    first.context.fetch = async (url) => {
        firstRequests.push(url);
        return { ok: true, json: async () => ({ valid: true, scope: 'browser' }) };
    };

    await first.security.init();

    assert.equal(first.security.token, 'temporary-browser-token');
    assert.deepEqual(firstRequests, ['/verify_token']);

    const expired = loadSecurity(authorizationStore);
    expired.context.window.location.search = '';
    expired.context.window.location.hash = '';
    expired.context.fetch = async () => ({ ok: false, status: 403 });
    await expired.security.init();

    assert.equal(expired.security.failureReason, 'invalid');
    assert.equal(authorizationStore.has('lmt.browser.authorization.v1'), false);
});

test('legacy query token is scrubbed after reading', async () => {
    const { context, security } = loadSecurity();
    context.window.location.search = '?token=legacy-token&language=he';
    context.fetch = async () => ({
        ok: true,
        json: async () => ({ valid: true })
    });

    await security.init();

    assert.equal(security.token, 'legacy-token');
    assert.equal(context.window.history.replaced, '/?language=he');
});

test('transfer history separates saved bytes from duplicate network bytes', async () => {
    const { context, manager } = loadManager();
    let payload;
    context.fetch = async (_url, options) => {
        payload = JSON.parse(options.body);
        return { ok: true };
    };
    manager.sessionId = 'session';
    manager.totalBytes = 60;
    manager.networkBytesUploaded = 50;
    manager.uploadDurationMs = 1000;
    manager.skippedBytes = 10;
    manager.fileQueue = [
        { id: 'new', name: 'new.bin', size: 20, done: true, failed: false },
        { id: 'late-duplicate', name: 'late.bin', size: 30, done: true, failed: false, skipped: true },
        { id: 'early-duplicate', name: 'early.bin', size: 10, done: true, failed: false, skipped: true, preflightSkipped: true }
    ];

    await manager.submitTransferHistory(1200);

    assert.equal(payload.uploadedFiles, 1);
    assert.equal(payload.skippedFiles, 2);
    assert.equal(payload.selectedBytes, 60);
    assert.equal(payload.uploadedBytes, 20);
    assert.equal(payload.skippedBytes, 40);
    assert.equal(payload.averageSpeedMBps, 0.00005);
});

test('frontend entrypoint has no runtime CDN dependencies', () => {
    const html = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/index.html'),
        'utf8');
    const externalAsset = /<(?:script|link)\b[^>]+(?:src|href)=["']https?:\/\//i;
    const forbiddenRuntimeText = [
        'bootstrap',
        'font awesome',
        'googleapis',
        'gstatic',
        'material-symbols',
        'expand_more',
        'fa-',
        'fas ',
        'fab ',
        '<i '
    ];

    assert.equal(externalAsset.test(html), false);
    for (const forbidden of forbiddenRuntimeText) {
        assert.equal(
            html.toLowerCase().includes(forbidden),
            false,
            `index.html should not contain ${forbidden}`
        );
    }
});

test('frontend loader cache key matches its module asset version', () => {
    const html = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/index.html'),
        'utf8');
    const loader = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/js/app.js'),
        'utf8');
    const version = loader.match(/const assetVersion = '([^']+)'/)?.[1];

    assert.ok(version, 'app.js should declare an asset version');
    assert.equal(
        html.includes(`/static/js/app.js?v=${version}`),
        true,
        'index.html should invalidate the loader when its module version changes'
    );
    const scripts = Array.from(html.matchAll(/<script(?: defer)? src="([^"]+)"/g), match => match[1]);
    assert.ok(scripts.length >= 13, 'dependencies should be ordered deferred declarations');
    assert.ok(scripts.every(src => src.endsWith(`?v=${version}`)), 'every runtime script shares the release asset key');
    assert.equal(
        html.includes(`/static/style.css?v=${version}`),
        true,
        'index.html should invalidate the stylesheet with the same release asset version'
    );
});

test('loaded frontend scripts avoid icon-font dependencies', () => {
    const scriptFiles = [
        'js/app.js',
        'js/core/i18n.js',
        'js/ui/icons.js',
        'js/ui/progress.js',
        'js/ui/modals.js',
        'js/ui/ios-tips.js',
        'js/upload/preflight.js',
        'js/upload/manager.js',
        'js/upload/workers.js',
        'js/core/security.js',
        'js/core/storage.js',
        'js/core/utils.js'
    ];

    const forbiddenRuntimeText = [
        'font awesome',
        'googleapis',
        'gstatic',
        'material-symbols',
        'expand_more',
        'fa-',
        'fas ',
        'fab ',
        '<i '
    ];

    for (const file of scriptFiles) {
        const text = fs.readFileSync(
            path.resolve(__dirname, '../../src/Server/static', file),
            'utf8').toLowerCase();
        for (const forbidden of forbiddenRuntimeText) {
            assert.equal(
                text.includes(forbidden),
                false,
                `${file} should not contain ${forbidden}`
            );
        }
    }
});

test('i18n detects Hebrew, Russian, and defaults to English', async () => {
    const scriptPath = path.resolve(__dirname, '../../src/Server/static/js/core/i18n.js');
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');
    const loaded = [];
    const html = {
        lang: '',
        dir: ''
    };
    const body = {
        attributes: {},
        setAttribute(name, value) {
            this.attributes[name] = value;
        }
    };
    const document = {
        getElementById() { return null; },
        documentElement: html,
        body,
        querySelectorAll() {
            return [];
        }
    };

    async function detect(language) {
        loaded.length = 0;
        const context = {
            window: { LMT_FRONTEND_VERSION: 'test' },
            document,
            navigator: { language, languages: [language] },
            localStorage: { getItem: () => null },
            console,
            fetch: async (url) => {
                loaded.push(url);
                return {
                    ok: true,
                    json: async () => ({ 'app.title': 'ok' })
                };
            }
        };
        context.window.lmtFetch = context.fetch;
        vm.createContext(context);
        vm.runInContext(scriptSource, context, { filename: scriptPath });
        await context.window.I18n.init();
        return context.window.I18n.lang;
    }

    assert.equal(await detect('he-IL'), 'he');
    assert.equal(await detect('ru-RU'), 'ru');
    assert.equal(await detect('fr-FR'), 'en');
});

test('successful retry removes the previous error and adds one success', async () => {
    const { context, workers } = loadWorkers();
    const manager = {
        SINGLE_FILE_MAX_BYTES: 100,
        SPEED_WINDOW_MS: 2000,
        AGG_ALPHA: 0.2,
        fileQueue: [],
        successCount: 0,
        errorCount: 1,
        totalBytes: 10,
        displaySpeedEMA: 0,
        logClientEvent() {}
    };
    const meta = {
        id: 'retry',
        name: 'retry.bin',
        size: 10,
        file: { size: 10 },
        failed: true,
        done: false,
        running: true
    };
    manager.fileQueue.push(meta);
    workers.uploadWholeFile = async () => {};
    context.window.uploadCacheManager = { trackUpload() {} };

    await workers.uploadSingle(meta, manager);

    assert.equal(manager.errorCount, 0);
    assert.equal(manager.successCount, 1);
    assert.equal(meta.failed, false);
    assert.equal(meta.done, true);
    assert.equal(meta.completedBytes, 10);
});

test('server-verified duplicate is shown as skipped', async () => {
    const { context, workers } = loadWorkers();
    let skippedText = '';
    context.window.ProgressTracker.renderSnapshot = meta => { skippedText = meta.presentation.text; };
    const manager = {
        SINGLE_FILE_MAX_BYTES: 100,
        SPEED_WINDOW_MS: 2000,
        AGG_ALPHA: 0.2,
        fileQueue: [],
        successCount: 0,
        errorCount: 0,
        totalBytes: 10,
        displaySpeedEMA: 0,
        logClientEvent() {}
    };
    const meta = {
        id: 'duplicate',
        name: 'same.bin',
        size: 10,
        file: { name: 'same.bin', size: 10 },
        failed: false,
        done: false,
        running: true
    };
    manager.fileQueue.push(meta);
    workers.uploadWholeFile = async () => ({
        skipped: true,
        filename: 'same.bin'
    });

    await workers.uploadSingle(meta, manager);

    assert.equal(meta.skipped, true);
    assert.equal(manager.successCount, 1);
    assert.equal(meta.uploadedBytes, 10);
    assert.equal(meta.completedBytes, 10);
    assert.equal(skippedText, 'Already exists');
});

test('numbered filename is shown after a same-name collision', async () => {
    const { context, workers } = loadWorkers();
    let successText = '';
    context.window.ProgressTracker.renderSnapshot = meta => { successText = meta.presentation.text; };
    const manager = {
        SINGLE_FILE_MAX_BYTES: 10_000,
        SPEED_WINDOW_MS: 2000,
        AGG_ALPHA: 0.2,
        fileQueue: [],
        successCount: 0,
        errorCount: 0,
        totalBytes: 2048,
        displaySpeedEMA: 0,
        logClientEvent() {}
    };
    workers.uploadWholeFile = async () => ({
        success: true,
        skipped: false,
        filename: 'IMG_1234 (2).JPG'
    });

    const meta = {
        id: 'numbered',
        name: 'IMG_1234.JPG',
        size: 2048,
        file: { name: 'IMG_1234.JPG', size: 2048 },
        failed: false,
        done: false,
        running: true
    };
    manager.fileQueue.push(meta);
    await workers.uploadSingle(meta, manager);

    assert.equal(successText, 'Saved as IMG_1234 (2).JPG');
});

test('a rendering failure cannot turn a receiver-confirmed upload into a failed file', async () => {
    const { context, manager } = loadManager();
    const file = { id: 'synthetic-render', name: 'synthetic.bin', size: 8, file: { size: 8 }, failed: false };
    manager.fileQueue = [file];
    context.window.UploadWorkers = {
        shouldUseChunkedUpload: () => false,
        uploadWholeFile: async () => ({ success: true, filename: 'synthetic.bin' }),
        isRetryableUploadError: () => false
    };
    context.window.ProgressTracker.renderSnapshot = () => { throw new Error('Synthetic detached view'); };
    context.window.ProgressTracker.updateStatsUI = () => { throw new Error('Synthetic detached stats'); };
    await manager.processFile(file);
    assert.equal(file.done, true);
    assert.equal(file.failed, false);
    assert.equal(manager.successCount, 1);
    assert.equal(manager.errorCount, 0);
    assert.equal(file.presentation.state, 'success');
});

test('observations from a replaced run cannot mutate new counters or file presentation', () => {
    const { manager } = loadManager();
    const file = { id: 'synthetic-stale', size: 8, uploadedBytes: 0, completedBytes: 0,
        acknowledgedBytes: 0, presentation: { percent: 0, text: 'Queued', state: 'queued' } };
    manager.isUploadInProgress = true;
    const observer = manager.transportObserver(file);
    manager.revision++;
    observer.onSending(100, true);
    observer.onRetry(1, 0, new Error('Synthetic old response'));
    observer.recordFileAcknowledgement(file, 8);
    observer.updateFileTransferProgress(file, 8);
    assert.equal(file.presentation.text, 'Queued');
    assert.equal(file.acknowledgedBytes, 0);
    assert.equal(manager.globalUploadedBytes, 0);
    assert.equal(manager.retryCount, 0);
});

test('recent activity retains the latest terminal file despite parallel progress and resets cleanly', () => {
    const { manager } = loadManager();
    const first = { id: 'synthetic-first', name: 'first.bin', size: 8, presentation: { percent: 0, state: 'queued', text: '' } };
    const second = { id: 'synthetic-second', name: 'second.bin', size: 8, presentation: { percent: 0, state: 'queued', text: '' } };
    manager.running = 2;
    manager.presentFile(first, { labelKey: 'file.uploading' });
    manager.presentFile(second, { labelKey: 'file.uploading' });
    assert.equal(manager.getSnapshot().activity.id, first.id);
    assert.equal(manager.getSnapshot().activeFiles, 2);
    manager.presentFile(second, { state: 'success', percent: 100, labelKey: 'file.done' });
    manager.presentFile(first, { percent: 75, text: '75%', labelKey: '' });
    const snapshot = manager.getSnapshot();
    assert.equal(snapshot.activity.id, second.id);
    assert.equal(snapshot.activity.presentation.state, 'success');
    assert.equal(Object.isFrozen(snapshot.activity.presentation), true);
    assert.notEqual(snapshot.activity.presentation, second.presentation);
    manager.presentFile(first, { state: 'error', text: 'Synthetic rejection', labelKey: '' });
    assert.equal(manager.getSnapshot().activity.id, first.id);
    manager.resetFiles();
    assert.equal(manager.getSnapshot().activity, null);
    assert.equal(manager.getSnapshot().activeFiles, 0);
});

test('preflight sends large selections in bounded batches', async () => {
    const { context, preflight } = loadPreflight();
    const batches = [];
    context.fetch = async (_url, options) => {
        const files = JSON.parse(options.body).files;
        batches.push(files.length);
        return { ok: true, json: async () => ({ files: files.map(file => ({ id: file.id, action: 'upload' })) }) };
    };
    const files = Array.from({ length: 2501 }, (_, index) => ({ id: String(index), name: 'synthetic.bin', size: 1 }));
    const result = await preflight.post(preflight.PRECHECK_URL, files);
    assert.deepEqual(batches, [1000, 1000, 501]);
    assert.equal(result.files.length, files.length);
});

test('speed samples are sent to the authenticated GUI metrics endpoint', () => {
    const { context, manager } = loadManager();
    let request = null;
    context.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true };
    };

    manager.reportSpeedSample(12 * 1024 * 1024, true);

    assert.equal(request.url, '/client_metrics');
    assert.equal(request.options.headers['X-Upload-Token'], 'test');
    assert.equal(JSON.parse(request.options.body).sessionId, manager.sessionId);
    assert.equal(
        JSON.parse(request.options.body).bytesPerSecond,
        12 * 1024 * 1024
    );
});

test('metrics coalesce stalled samples and terminal zero is ordered last', async () => {
    const { context, manager } = loadManager();
    const requests = [];
    context.fetch = (_url, options) => new Promise(resolve => {
        requests.push({ body: JSON.parse(options.body), resolve });
    });
    manager.reportSpeedSample(10, true);
    manager.reportSpeedSample(20, true);
    manager.reportSpeedSample(30, true);
    assert.equal(requests.length, 1);
    manager.reportSpeedSample(0, true);
    manager.reportSpeedSample(99, true);
    requests[0].resolve({});
    await new Promise(setImmediate);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.bytesPerSecond, 0);
    requests[1].resolve({});
    await new Promise(setImmediate);
    assert.equal(requests.length, 2);
});

test('optional telemetry deadlines release a stalled request and bound event fanout', async () => {
    const { context, manager } = loadManager();
    let active = 0;
    let peak = 0;
    let total = 0;
    context.setTimeout = (callback, delay) => setTimeout(callback, delay === 5000 ? 5 : delay);
    context.fetch = (_url, options) => new Promise((_resolve, reject) => {
        total++;
        peak = Math.max(peak, ++active);
        options.signal.addEventListener('abort', () => { active--; reject(new Error('deadline')); });
    });
    await Promise.all(Array.from({ length: 20 }, () => manager.logClientEvent('INFO', 'sample', 'Synthetic')));
    assert.equal(peak, 1);
    assert.equal(total, 4);
    assert.equal(active, 0);
    assert.equal(context.window.TransferTelemetry.events.get(manager).count, 0);
});

test('sending a whole file does not acknowledge it until a valid receiver response', async () => {
    const { context, workers } = loadWorkers();
    let xhr;
    context.FormData = class { append() {} };
    context.XMLHttpRequest = class {
        constructor() { xhr = this; this.upload = {}; }
        open() {} setRequestHeader() {} send() {} getResponseHeader() { return ''; }
    };
    const acknowledgements = [];
    let text;
    context.window.ProgressTracker.setFileProgress = (_file, _percent, value) => { text = value; };
    const manager = { updateFileTransferProgress() { return {uploadDelta: 0, completedDelta: 0}; }, onSending: (_percent, waiting) => { if (waiting) text = 'Waiting for receiver…'; }, recordFileAcknowledgement: (_file, bytes) => acknowledgements.push(bytes) };
    const meta = { size: 10, file: { name: 'synthetic.bin' } };
    const pending = workers.uploadWholeFile(meta, manager);
    xhr.upload.onprogress({ lengthComputable: true, loaded: 10, total: 10 });
    assert.equal(text, 'Waiting for receiver…');
    assert.deepEqual(acknowledgements, []);
    xhr.status = 200; xhr.responseText = '{"success":true}'; xhr.onload();
    await pending;
    assert.deepEqual(acknowledgements, [10]);
    const rejected = workers.uploadWholeFile(meta, manager);
    xhr.status = 200; xhr.responseText = '{"success":false}'; xhr.onload();
    await assert.rejects(rejected, /invalid response/);
    assert.deepEqual(acknowledgements, [10]);
});

test('chunk retries are counted through the retry callback', async () => {
    const { context, workers } = loadWorkers();
    let attempts = 0;
    let retries = 0;
    context.setTimeout = callback => {
        callback();
        return 1;
    };
    context.XMLHttpRequest = class {
        constructor() {
            this.upload = {};
            this.status = 200;
            this.responseText = 'ok';
        }
        open() {}
        setRequestHeader() {}
        send() {
            attempts++;
            if (attempts === 1) this.onerror();
            else this.onload();
        }
    };

    await workers.uploadChunkXHR(
        '/upload_chunk',
        {},
        { size: 4 },
        1000,
        2,
        { onRetry: () => { retries++; }, onProgress: () => {} }
    );

    assert.equal(attempts, 2);
    assert.equal(retries, 1);
});

test('chunk upload does not retry terminal client errors', async () => {
    const { context, workers } = loadWorkers();
    let attempts = 0;
    context.XMLHttpRequest = class {
        constructor() {
            this.upload = {};
            this.status = 409;
            this.responseText = '{"error":"conflict"}';
        }
        open() {}
        setRequestHeader() {}
        getResponseHeader() { return ''; }
        send() {
            attempts++;
            this.onload();
        }
    };

    await assert.rejects(workers.uploadChunkXHR(
        '/upload_chunk', {}, { size: 4 }, 1000, 2, {}),
    /conflict/);
    assert.equal(attempts, 1);
});

test('client lifecycle telemetry includes the upload token', async () => {
    const { context, manager } = loadManager();
    let request = null;
    context.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({}) };
    };

    await manager.logClientEvent('INFO', 'upload_started', 'new transfer');

    assert.equal(request.url, '/client_log');
    assert.equal(request.options.headers['X-Upload-Token'], 'test');
    const body = JSON.parse(request.options.body);
    assert.equal(body.session, manager.sessionId);
    assert.equal(body.path, '/');
    assert.equal(body.href, undefined);
    assert.equal(JSON.stringify(body).includes('token=test'), false);
});

test('configuration wait owns the queue and prevents duplicate worker sets', async () => {
    const { manager } = loadManager();
    let release;
    manager.configReady = new Promise(resolve => { release = resolve; });
    manager.logClientEvent = () => {};
    manager.fileQueue = [{ done: false, size: 5 }];
    manager.CONCURRENCY = 1;
    manager.setUploadUiState = () => {};
    manager.startStallWatchdog = manager.stopStallWatchdog = () => {};
    let calls = 0;
    manager.worker = async () => { calls++; manager.fileQueue[0].done = true; };
    const first = manager.uploadFiles();
    await manager.uploadFiles();
    assert.equal(manager.isUploadInProgress, true);
    assert.equal(manager.addFiles([{ name: 'blocked.bin', size: 1 }]), false);
    manager.resetFiles();
    assert.equal(manager.fileQueue.length, 1);
    release();
    await first;
    assert.equal(calls, 1);
    assert.equal(manager.isUploadInProgress, false);
});

test('malformed, failed and stalled configuration uses bounded defaults', async () => {
    for (const bad of [-1, 0, 1.5, '16', {}, Number.MAX_SAFE_INTEGER, Infinity]) {
        const { context, manager } = loadManager();
        context.fetch = async () => ({ ok: true, json: async () => ({
            shared: { singleFileMaxBytes: bad },
            browser: { desktop: { chunkSizeBytes: bad, parallelFiles: bad } }
        }) });
        await manager.loadServerConfig();
        assert.equal(manager.SINGLE_FILE_MAX_BYTES, 100 * 1024 * 1024);
        assert.equal(manager.chunkSizeBytes, 16 * 1024 * 1024);
        assert.equal(manager.CONCURRENCY, 3);
    }
    const { context, manager } = loadManager();
    context.fetch = async () => ({ ok: false });
    await manager.loadServerConfig();
    assert.equal(manager.CONCURRENCY, 3);
    manager.CONFIG_TIMEOUT_MS = 1;
    context.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    await manager.loadServerConfig();
    assert.equal(manager.chunkSizeBytes, 16 * 1024 * 1024);
});

test('all browsers chunk above the exact 100 MiB whole-request boundary', () => {
    for (const userAgent of ['Desktop', 'iPhone', 'Android']) {
        const { workers } = loadWorkers({ userAgent });
        const manager = { SINGLE_FILE_MAX_BYTES: 100 * 1024 * 1024 };
        for (const [size, chunked] of [[100 * 1024 * 1024, false],
            [100 * 1024 * 1024 + 1, true], [101 * 1024 * 1024, true]]) {
            assert.equal(workers.shouldUseChunkedUpload({ file: { size } }, manager), chunked);
        }
    }
});

test('final chunk requires explicit completion even on HTTP success', async () => {
    for (const body of ['', '{}', 'null', '{"complete":false}', 'invalid']) {
        const { workers } = loadWorkers();
        workers.uploadChunkXHR = async () => body;
        const meta = { file: { name: 'synthetic.bin', size: 1, slice: () => ({ size: 1 }) } };
        await assert.rejects(workers.uploadChunked(meta, { chunkSizeBytes: 1 }), /invalid response/);
    }
});

test('temporary verification failures retain saved browser authorization', async () => {
    for (const response of [null, { ok: false, status: 503 }]) {
        const saved = new Map([['lmt.browser.authorization.v1', 'browser-credential']]);
        const { context, security } = loadSecurity(saved);
        context.window.location.search = '';
        context.fetch = async () => { if (!response) throw new Error('offline'); return response; };
        await security.init();
        assert.equal(security.isValid, false);
        assert.equal(saved.get('lmt.browser.authorization.v1'), 'browser-credential');
    }
});

test('timing parser allows only bounded known numeric phases and reset clears totals', () => {
    const { workers } = loadWorkers();
    assert.deepEqual(JSON.parse(JSON.stringify(workers.parseServerTiming(
        'app;dur=1e308, write;dur=-1, finalize;dur=Infinity, secret;dur=12, decode;dur=2'))),
    { decode: 2 });
    const { manager } = loadManager();
    manager.fileQueue = [{ transferTiming: { requestCount: 2, requestDurationMs: 20 } }];
    assert.equal(manager.getTimingSummary().requestCount, 2);
    manager.logClientEvent = () => {};
    manager.resetFiles();
    assert.equal(manager.getTimingSummary().requestCount, 0);
});
