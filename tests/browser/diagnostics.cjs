// Synthetic real-receiver diagnostics only. Never persist headers or bodies.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const allowed = new Set(['/upload_single', '/upload_chunk', '/upload/preflight', '/upload/preflight/verify', '/client_metrics', '/client_log', '/transfer_history']);

function serializeEvidence(value, secrets = []) {
    let text = JSON.stringify(value, (key, item) =>
        /headers?|postdata|requestbody|responsebody|cookie|authorization/i.test(key) ? undefined : item);
    for (const secret of secrets) {
        if (secret.length < 8) continue;
        text = text.split(secret).join('[credential]').split(encodeURIComponent(secret)).join('[credential]');
    }
    return text;
}

async function startDiagnostics(page, engine, label = engine) {
    if (process.env.LMT_BROWSER_PROFILE !== '1') return null;
    const runId = process.env.LMT_BROWSER_RUN_ID;
    if (!/^[a-f0-9]{32}$/.test(runId || '')) throw new Error('Canonical profile run identity required');
    if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid diagnostic label');
    const output = path.join(__dirname, 'artifacts', 'receiver-profile', runId, label);
    await fs.mkdir(output, { recursive: true });
    const assetIdentity = {};
    for (const asset of ['index.html', 'js/app.js', 'js/upload/manager.js', 'js/core/throughput.js', 'js/core/telemetry.js', ...(label.endsWith('baseline') ? [] : ['js/upload/controller.js', 'js/ui/media-previews.js', 'js/ui/file-list.js'])]) {
        assetIdentity[asset] = crypto.createHash('sha256')
            .update(await fs.readFile(path.join(process.env.LMT_BROWSER_ASSET_ROOT, asset))).digest('hex');
    }
    // Authentication is complete and the address bar is clean before profiling.
    const credential = await page.evaluate(() => window.SecurityManager.token);
    const secrets = new Set([credential, process.env.LMT_BROWSER_URL].filter(Boolean));
    const original = new URL(process.env.LMT_BROWSER_URL);
    for (const value of original.searchParams.values()) secrets.add(value);
    for (const value of new URLSearchParams(original.hash.slice(1)).values()) secrets.add(value);
    async function save(name, value) {
        await fs.writeFile(path.join(output, name), serializeEvidence(value, secrets));
    }
    const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
    const network = [], pending = new Map(), events = [], samples = [];
    if (cdp) {
        await cdp.send('Network.enable');
        cdp.on('Network.requestWillBeSent', e => {
            const route = new URL(e.request.url).pathname;
            if (allowed.has(route)) pending.set(e.requestId, { route, started: e.timestamp });
        });
        cdp.on('Network.responseReceived', e => {
            const request = pending.get(e.requestId);
            if (!request) return;
            const t = e.response.timing;
            Object.assign(request, { status: e.response.status, sendMs: t ? t.sendEnd - t.sendStart : null,
                waitMs: t ? t.receiveHeadersStart - t.sendEnd : null });
        });
        cdp.on('Network.loadingFinished', e => {
            const request = pending.get(e.requestId);
            if (!request) return;
            pending.delete(e.requestId);
            network.push({ ...request, totalMs: (e.timestamp - request.started) * 1000 });
        });
        cdp.on('Network.loadingFailed', e => {
            const request = pending.get(e.requestId);
            if (!request) return;
            pending.delete(e.requestId);
            network.push({ ...request, failed: true, cancelled: !!e.canceled });
        });
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
        cdp.on('Tracing.dataCollected', e => events.push(...e.value));
        await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing', transferMode: 'ReportEvents' });
    }
    await page.evaluate(() => {
        window.__syntheticDiagnosticTasks = [];
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
            window.__syntheticDiagnosticObserver = new PerformanceObserver(list => {
                window.__syntheticDiagnosticTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })));
            });
            window.__syntheticDiagnosticObserver.observe({ type: 'longtask' });
        }
    });
    return {
        async sample(stage) {
            await page.evaluate(label => performance.mark(`synthetic:${label}`), stage);
            const state = await page.evaluate(() => ({ at: performance.now(), version: window.LMT_FRONTEND_VERSION,
                queue: window.UploadManager.fileQueue.length, rows: document.querySelectorAll('.file-item').length,
                nodes: document.querySelectorAll('*').length, activeRequests: window.TransferSession.aborters.size,
                phase: window.UploadManager.currentPhase, timing: window.UploadManager.getTimingSummary(),
                selectionProbe: window.__syntheticSelectionProbe ?? null,
                rates: window.UploadManager.throughput?.snapshot() ?? null }));
            samples.push({ stage, ...state, heap: cdp ? await cdp.send('Runtime.getHeapUsage') : null });
        },
        async finish() {
            const browserData = await page.evaluate(() => {
                window.__syntheticDiagnosticObserver?.disconnect();
                return { longTasks: window.__syntheticDiagnosticTasks,
                    resources: performance.getEntriesByType('resource').map(r => ({ route: new URL(r.name).pathname,
                        duration: r.duration, timings: r.serverTiming.map(t => ({ name: t.name, duration: t.duration })) })) };
            });
            browserData.resources = browserData.resources.filter(r => allowed.has(r.route));
            if (cdp) {
                const cpu = await cdp.send('Profiler.stop');
                const allocations = await cdp.send('HeapProfiler.stopSampling');
                const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
                await cdp.send('Tracing.end'); await done;
                await save('transfer.cpuprofile', cpu.profile);
                await save('allocations.json', allocations.profile);
                await save('transfer.trace.json', { traceEvents: events });
                await save('network.json', network);
                await cdp.detach();
            }
            await save('summary.json', { engine, assetIdentity, samples, ...browserData,
                limits: ['Synthetic functional flow under instrumentation; not a throughput benchmark.',
                    'Heap counters and allocation sampling do not establish complete garbage collection.',
                    'Chunk retry uses request interception and must not be used as a speed baseline.'] });
        }
    };
}
module.exports = { startDiagnostics, serializeEvidence };
