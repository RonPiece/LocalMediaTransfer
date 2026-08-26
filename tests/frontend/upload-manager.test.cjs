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
        Date,
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
    loadScript(harness.context, '../../src/Server/static/js/upload/manager.js');
    return { ...harness, manager: harness.context.window.UploadManager };
}

function loadWorkers(navigatorOverrides = {}) {
    const harness = createContext(navigatorOverrides);
    harness.context.crypto = require('node:crypto').webcrypto;
    harness.context.AbortController = AbortController;
    loadScript(harness.context, '../../src/Server/static/js/core/utils.js');
    loadScript(harness.context, '../../src/Server/static/js/upload/workers.js');
    return { ...harness, workers: harness.context.window.UploadWorkers };
}

function loadPreflight(navigatorOverrides = {}) {
    const harness = createContext(navigatorOverrides);
    loadScript(harness.context, '../../src/Server/static/js/upload/preflight.js');
    return {
        ...harness,
        preflight: harness.context.window.DuplicatePreflight
    };
}

function loadSecurity() {
    const harness = createContext();
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
        setFileProgress(file, percent, text) {
            progressCalls.push({ id: file.id, percent, text });
        },
        markFileSkipped() {},
        markFileQueued() {}
    };

    await preflight.run(files, context.window.ProgressTracker);

    assert.equal(
        progressCalls.some(call => call.percent === 99 || /99%/.test(call.text)),
        false);
    assert.deepEqual(
        progressCalls.map(call => call.text),
        ['Checking...', 'Checking...', 'Verifying...']);
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

test('manager speed sum expires without queue scans and recovers with epoch accounting', () => {
    const { manager } = loadManager();
    const file = { _speed: 0 };
    let now = 10_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
        manager.speedEpoch = 0;
        manager.activeSpeedSum = 0;
        manager.lastProgressTs = now;
        manager.updateFileSpeed(file, 100);
        assert.equal(manager.getCurrentSpeedForDisplay(), 100);

        now += 2500;
        assert.equal(manager.getCurrentSpeedForDisplay(), 0);
        assert.equal(manager.activeSpeedSum, 0);

        manager.lastProgressTs = now;
        manager.updateFileSpeed(file, 50);
        assert.equal(manager.getCurrentSpeedForDisplay(), 50);
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

test('medium iPadOS video uses the whole-file compatibility path', () => {
    const { workers } = loadWorkers({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5
    });
    const manager = { SINGLE_FILE_MAX_BYTES: 100 * 1024 * 1024 };
    const meta = { file: { size: 192 * 1024 * 1024 } };

    assert.equal(workers.shouldUseChunkedUpload(meta, manager), false);
});

test('large iOS transfers are serialized', async () => {
    const { workers } = loadWorkers({
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
        platform: 'iPad',
        maxTouchPoints: 5
    });
    let active = 0;
    let peak = 0;
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });

    const first = workers.withIOSLargeTransfer(async () => {
        active++;
        peak = Math.max(peak, active);
        await firstGate;
        active--;
    });
    const second = workers.withIOSLargeTransfer(async () => {
        active++;
        peak = Math.max(peak, active);
        active--;
    });

    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);

    assert.equal(peak, 1);
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
    context.window.Modals.showUploadCompleteModal = (...args) => {
        summaries.push(args);
    };

    await manager.uploadFiles();

    assert.equal(workerCalls, 0);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0][0], 1);
    assert.equal(summaries[0][1], 1);
    assert.equal(Number.isFinite(summaries[0][2]), true);
    assert.equal(summaries[0][2] >= 0, true);
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
    const { context, security } = loadSecurity();
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
    assert.equal(context.window.history.replaced, '/');
    assert.equal(requests[0].url, '/exchange_bootstrap');
    assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
    assert.equal(requests[0].options.credentials, 'omit');
    assert.equal(requests[0].options.body.includes(bootstrap), true);
    assert.equal(requests[1].url, '/verify_token');
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
    context.window.ProgressTracker.markFileSkipped = (_meta, text) => {
        skippedText = text;
    };
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
    context.window.ProgressTracker.markFileSuccess = (_meta, text) => {
        successText = text;
    };
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
        () => { retries++; },
        () => {}
    );

    assert.equal(attempts, 2);
    assert.equal(retries, 1);
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
