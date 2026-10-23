const { chromium } = require('@playwright/test');
const { startFixture } = require('./fixture.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { serializeEvidence } = require('./diagnostics.cjs');
const { execFileSync } = require('node:child_process');

(async () => {
    const baselineIndex = process.argv.indexOf('--baseline-ref');
    const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
    const rootIndex = process.argv.indexOf('--static-root');
    const staticOverride = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : null;
    const label = baselineRef || staticOverride ? 'before' : 'after';
    const output = path.join(__dirname, 'artifacts', label);
    await fs.mkdir(output, { recursive: true });
    let baselineRoot, fixture, browser;
    try {
        if (baselineRef) {
            baselineRoot = path.join(os.tmpdir(), 'LocalMediaTransfer.Tests', crypto.randomUUID());
            const staticRoot = path.resolve(__dirname, '../../src/Server/static');
            await fs.cp(staticRoot, baselineRoot, { recursive: true });
            const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineRef, '--', 'src/Server/static'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }).trim().split('\n');
            for (const filename of files.filter(f => /\.(js|css|html|json)$/.test(f))) {
                const destination = path.join(baselineRoot, filename.replace('src/Server/static/', ''));
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.writeFile(destination, execFileSync('git', ['show', `${baselineRef}:${filename}`], { cwd: path.resolve(__dirname, '../..'), maxBuffer: 16 * 1024 * 1024 }));
            }
        }
        fixture = await startFixture(staticOverride || baselineRoot);
        browser = await chromium.launch();
        const measurements = [];
        for (const count of [100, 1000, 5000]) {
            const page = await browser.newPage();
            await page.goto(fixture.url + '/?token=synthetic-profile');
            await page.waitForFunction(() => !!window.__fileTransfer && !document.getElementById('chooseBtn').disabled);
            // Synthetic File creation is fixture work, not the chooser handler under test.
            await page.evaluate(count => { window.profileFiles = Array.from({ length: count }, (_, i) => new File(['synthetic'], `fixture-${i}.txt`)); }, count);
            await page.evaluate(() => {
                window.profileTasks = [];
                new PerformanceObserver(list => window.profileTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask' });
            });
            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.start');
            const traceEvents = [];
            cdp.on('Tracing.dataCollected', event => traceEvents.push(...event.value));
            await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing', transferMode: 'ReportEvents' });
            const result = await page.evaluate(async count => {
                const started = performance.now();
                await window.__fileTransfer.addFiles(window.profileFiles);
                window.profileFiles = null;
                const addMs = performance.now() - started;
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return { count, addMs, rows: document.querySelectorAll('.file-item').length, nodes: document.querySelectorAll('*').length };
            }, count);
            const paged = await page.locator('#fileDetails').count() > 0;
            if (paged) await page.locator('#fileDetails > summary').click();
            await page.waitForFunction(() => document.querySelectorAll('.file-item').length >= 100);
            const expansionMs = await page.evaluate(async paged => {
                const start = performance.now();
                if (paged) { const next = document.getElementById('fileNext'); if (!next.disabled) next.click(); }
                else { const groups = document.querySelectorAll('details'); if (groups.length >= 2) groups[1].open = true; }
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return performance.now() - start;
            }, paged);
            let searchMs = null;
            if (paged) {
                const started = performance.now();
                await page.locator('#fileSearch').fill('fixture-0.txt');
                await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 1);
                searchMs = performance.now() - started;
                await page.locator('#fileSearch').fill('');
                await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 100);
            }
            await page.waitForTimeout(100);
            const settled = await page.evaluate(() => ({ rows: document.querySelectorAll('.file-item').length, nodes: document.querySelectorAll('*').length, longTasks: window.profileTasks }));
            const previewStats = paged ? await page.evaluate(() => ({ bindings: window.MediaPreviews.bindings.size, cache: window.MediaPreviews.cache.size, running: window.MediaPreviews.running })) : null;
            const reset = await page.evaluate(() => {
                const start = performance.now(); window.__fileTransfer.resetFiles();
                return { resetMs: performance.now() - start, queue: window.__fileTransfer.getQueue().length, rows: document.querySelectorAll('.file-item').length, previewBindings: window.MediaPreviews?.bindings.size ?? null, previewCache: window.MediaPreviews?.cache.size ?? null };
            });
            const heap = await cdp.send('Runtime.getHeapUsage');
            const profile = (await cdp.send('Profiler.stop')).profile;
            const traceDone = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
            await cdp.send('Tracing.end'); await traceDone;
            await fs.writeFile(path.join(output, `${count}.cpuprofile`), serializeEvidence(profile, ['synthetic-profile']));
            await fs.writeFile(path.join(output, `${count}.trace.json`), serializeEvidence({ traceEvents }, ['synthetic-profile']));
            measurements.push({ ...result, settled, expansionMs, searchMs, previewStats, reset, heapUsedBytes: heap.usedSize });
            await page.close();
        }
        await fs.writeFile(path.join(output, 'measurements.json'), JSON.stringify({ label, baselineRef, browser: browser.version(), measurements }, null, 2));
        console.log(JSON.stringify(measurements.map(({count,addMs,settled,reset}) => ({count,addMs,rows:settled.rows,longTasks:settled.longTasks,reset})), null, 2));
    } finally {
        await Promise.allSettled([browser?.close(), fixture?.close()]);
        if (baselineRoot) {
            const allowed = path.resolve(os.tmpdir(), 'LocalMediaTransfer.Tests') + path.sep;
            if (!path.resolve(baselineRoot).startsWith(allowed)) throw new Error('Unsafe baseline cleanup');
            await fs.rm(baselineRoot, { recursive: true });
        }
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
