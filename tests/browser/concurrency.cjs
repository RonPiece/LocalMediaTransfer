// Canonical harness only: same disk-backed fixtures, receiver and fixed chunk size.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const { once } = require('node:events');
const path = require('node:path');
const crypto = require('node:crypto');
const { startDiagnostics } = require('./diagnostics.cjs');
const { serializeEvidence } = require('./diagnostics.cjs');
(async () => {
    const url = process.env.LMT_BROWSER_URL, uploads = process.env.LMT_BROWSER_UPLOAD_ROOT, runId = process.env.LMT_BROWSER_RUN_ID;
    if (!url || !uploads || !/^[a-f0-9]{32}$/.test(runId || ''))
        throw Error('Canonical benchmark harness required');
    const root = path.resolve(uploads, '..');
    const allowed = path.resolve(require('node:os').tmpdir(), 'LocalMediaTransfer.Tests') + path.sep;
    if (!root.startsWith(allowed))
        throw Error('Unsafe fixture root');
    const output = path.join(__dirname, 'artifacts/concurrency', runId);
    await fs.mkdir(output, { recursive: true });
    const fixtures = { small: [], mixed: [] };
    const smokeOnly = process.env.LMT_BROWSER_BENCHMARK_SMOKE === '1';
    const controlOnly = process.env.LMT_BROWSER_BENCHMARK_CONTROL === '1';
    const hashes = new Map();
    async function hash(filename) { const h = crypto.createHash('sha256'); for await (const block of createReadStream(filename))
        h.update(block); return h.digest('hex'); }
    for (const [workload, count] of smokeOnly ? [['small', 8]] : controlOnly ? [['small', 128]] : [['small', 128], ['mixed', 52]])
        for (let i = 0; i < count; i++) {
            const size = workload === 'small' ? 64 * 1024 : i < 50 ? 2 * 1024 * 1024 : 120 * 1024 * 1024;
            const filename = path.join(root, `synthetic-${workload}-${i}.bin`);
            const stream = createWriteStream(filename);
            const block = Buffer.alloc(Math.min(size, 1024 * 1024), i + 1);
            for (let left = size; left > 0; left -= block.length)
                if (!stream.write(block.subarray(0, Math.min(left, block.length))))
                    await once(stream, 'drain');
            stream.end();
            await once(stream, 'finish');
            fixtures[workload].push(filename);
            hashes.set(path.basename(filename), await hash(filename));
        }
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const results = [];
    let serial = 0;
    try {
        const baseline = path.join(__dirname, 'artifacts/baseline-static-20261020');
        const hasBaseline = await fs.access(path.join(baseline, 'index.html')).then(() => true, () => false);
        let authenticated = false;
        async function prepareVariant(variant) {
            const page = await context.newPage();
            const assetRoot = variant === 'baseline' ? path.join(__dirname, 'artifacts/baseline-static-20261020') : process.env.LMT_BROWSER_ASSET_ROOT;
            await page.route('**/*', async (route) => {
                const request = route.request(), u = new URL(request.url());
                if (request.method() !== 'GET' || (u.pathname !== '/' && !u.pathname.startsWith('/static/')))
                    return route.continue();
                const relative = u.pathname === '/' ? 'index.html' : u.pathname.slice('/static/'.length);
                const file = path.resolve(assetRoot, relative);
                if (!file.startsWith(path.resolve(assetRoot) + path.sep))
                    return route.abort();
                const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
                let body;
                try { body = await fs.readFile(file); }
                catch { return route.abort(); }
                await route.fulfill({ body, contentType: types[path.extname(file)] || 'application/octet-stream' });
            });
            await page.goto(authenticated ? new URL('/', url).href : url);
            await expect(page.locator('#chooseBtn')).toBeEnabled();
            await page.waitForFunction(() => window.TransferSession.initialized && window.TransferSession.state === 'ready');
            authenticated = true;
            await page.unrouteAll({ behavior: 'wait' });
            await page.evaluate(async () => {
                await window.UploadManager.configReady;
                window.UploadManager.chunkSizeBytes = 16 * 1024 * 1024;
                window.DuplicatePreflight.run = async () => ({ skippedFiles: 0, skippedBytes: 0 });
                // Identical benchmark-only policy on both versions. No request interception while timed.
                const send = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.send = function (body) { this.setRequestHeader('X-Skip-Duplicates', 'false'); return send.call(this, body); };
            });
            const version = await page.evaluate(() => window.LMT_FRONTEND_VERSION);
            async function run(workload, concurrency, iteration, record) {
                await page.bringToFront();
                const prefix = `synthetic-${++serial}-`;
                await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'syntheticFixtureInput'; document.body.append(input); });
                await page.locator('#syntheticFixtureInput').setInputFiles(fixtures[workload]);
                await page.evaluate(async ({ prefix, concurrency }) => {
                    const input = document.getElementById('syntheticFixtureInput');
                    const files = Array.from(input.files).map(file => new File([file], prefix + file.name, { type: file.type }));
                    input.remove();
                    window.UploadManager.resetFiles();
                    window.UploadManager.CONCURRENCY = concurrency;
                    await window.__fileTransfer.addFiles(files);
                }, { prefix, concurrency });
                const measured = await page.evaluate(async () => {
                    performance.clearResourceTimings();
                    performance.setResourceTimingBufferSize(5000);
                    const start = performance.now();
                    await window.__fileTransfer.uploadFiles();
                    const m = window.UploadManager;
                    return { wallMs: performance.now() - start, uploadMs: m.uploadDurationMs, totalBytes: m.totalBytes, failed: m.errorCount,
                        rates: m.completionRates, timing: m.getTimingSummary(),
                        files: m.fileQueue.map(f => ({ source: f.name.replace(/^synthetic-\d+-/, ''), saved: f.serverResult?.filename, failed: f.failed })),
                        details: performance.getEntriesByType('resource').filter(r => /\/upload_(single|chunk)$/.test(new URL(r.name).pathname)).flatMap(r => r.serverTiming.map(t => ({ name: t.name, ms: t.duration }))) };
                });
                if (measured.failed || measured.files.some(f => f.failed || !f.saved || path.basename(f.saved) !== f.saved))
                    throw Error('Benchmark transfer failed');
                for (const file of measured.files) {
                    if (await hash(path.join(uploads, file.saved)) !== hashes.get(file.source))
                        throw Error('Benchmark content mismatch');
                    await fs.unlink(path.join(uploads, file.saved));
                }
                const details = {};
                for (const t of measured.details)
                    details[t.name] = (details[t.name] || 0) + t.ms;
                if (!('flush' in details) || !('lockwait' in details))
                    throw Error('Benchmark finalization attribution missing');
                const row = { variant, version, workload, concurrency, iteration, ...measured, details };
                delete row.files;
                if (record) {
                    results.push(row);
                    // Persist completed samples outside timing, retaining evidence if a later pass fails.
                    await fs.writeFile(path.join(output, 'partial-measurements.json'), serializeEvidence({ browser: browser.version(), chunkBytes: 16 * 1024 * 1024, results }));
                }
                console.log(`${variant} ${workload} concurrency=${concurrency} pass=${iteration} ${measured.rates.averageMediaBytesPerSecond / 1e6} MB/s`);
            }
            return { variant, page, assetRoot, run };
        }
        async function profileVariant({ page, assetRoot, run, variant }, workload) {
            const previous = process.env.LMT_BROWSER_PROFILE, previousRoot = process.env.LMT_BROWSER_ASSET_ROOT;
            process.env.LMT_BROWSER_PROFILE = '1';
            process.env.LMT_BROWSER_ASSET_ROOT = assetRoot;
            const diagnostic = await startDiagnostics(page, 'chromium', `chromium-${controlOnly ? 'control-' : ''}${variant}`);
            try {
                await diagnostic.sample('ready');
                await run(workload, 3, 'instrumented', false);
                await diagnostic.sample('complete');
            }
            finally {
                await diagnostic.finish();
                if (previous === undefined)
                    delete process.env.LMT_BROWSER_PROFILE;
                else
                    process.env.LMT_BROWSER_PROFILE = previous;
                process.env.LMT_BROWSER_ASSET_ROOT = previousRoot;
            }
        }
        const variants = hasBaseline ? ['baseline', 'updated'] : ['updated'];
        if (controlOnly) {
            const runners = [];
            for (const variant of [...variants].reverse()) runners.push(await prepareVariant(variant));
            try {
                for (const runner of runners) await runner.run('small', 3, 'warmup', false);
                for (let pass = 0; pass < 3; pass++) {
                    const order = pass % 2 ? [...runners].reverse() : runners;
                    for (const runner of order) await runner.run('small', 3, pass + 1, true);
                }
                for (const runner of runners) await profileVariant(runner, 'small');
            } finally { for (const runner of runners) await runner.page.close(); }
        } else for (const variant of variants) {
            const { page, assetRoot, run } = await prepareVariant(variant);
            if (smokeOnly) { await run('small', 1, 'smoke', true); await page.close(); continue; }
            for (const workload of ['small', 'mixed']) {
                for (const concurrency of [1, 2, 3, 4])
                    await run(workload, concurrency, 'warmup', false);
                for (let pass = 0; pass < 3; pass++)
                    for (let k = 0; k < 4; k++)
                        await run(workload, [1, 2, 3, 4][(k + pass) % 4], pass + 1, true);
            }
            await profileVariant({ page, assetRoot, run, variant }, 'mixed');
            await page.close();
        }
        await fs.writeFile(path.join(output, 'measurements.json'), serializeEvidence({ smokeOnly, controlOnly, browser: browser.version(), chunkBytes: 16 * 1024 * 1024, results, limits: ['Warm same-PC system-drive fixtures; not an HDD or network baseline.', 'Duplicate checks disabled consistently in benchmark mode; SHA-256 performed after timing.', 'Production concurrency and chunk defaults unchanged.'] }));
        await fs.writeFile(path.join(output, 'measurements.csv'), 'variant,workload,concurrency,iteration,uploadMs,averageMBps\n' + results.map(r => [r.variant, r.workload, r.concurrency, r.iteration, r.uploadMs, r.rates.averageMediaBytesPerSecond / 1e6].join(',')).join('\n') + '\n');
        console.log('Controlled browser concurrency and integrity passed.');
    }
    finally {
        await context.close();
        await browser.close();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
