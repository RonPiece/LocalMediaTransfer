// Launched only by the canonical .NET harness; never launch the receiver here.
const { chromium, firefox, webkit, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { once } = require('node:events');
const { startDiagnostics } = require('./diagnostics.cjs');
let stage = 'startup';

(async () => {
    const engine = process.argv[2];
    const url = process.env.LMT_BROWSER_URL;
    const uploads = process.env.LMT_BROWSER_UPLOAD_ROOT;
    if (!url || !uploads || !['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Harness required');
    const browser = await ({ chromium, firefox, webkit })[engine].launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    let diagnostics;
    try {
        const page = await context.newPage();
        const response = await page.goto(url);
        const served = await response.text();
        const source = await fs.readFile(path.join(process.env.LMT_BROWSER_ASSET_ROOT, 'index.html'), 'utf8');
        if (served.replace(/\r\n/g, '\n') !== source.replace(/\r\n/g, '\n')) throw new Error('Stale receiver web assets; rebuild the receiver before testing');
        for (const match of source.matchAll(/(?:src|href)="(\/static\/(?:js\/[^"?]+\.js|style\.css)(?:\?[^" ]*)?)"/g)) {
            const assetUrl = new URL(match[1], url);
            const actual = await context.request.get(assetUrl.href);
            const expected = await fs.readFile(path.join(process.env.LMT_BROWSER_ASSET_ROOT, assetUrl.pathname.replace('/static/', '')), 'utf8');
            if (!actual.ok() || (await actual.text()).replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) throw new Error('Stale receiver script/style assets; rebuild or refresh the build output');
        }

        await expect(page.locator('#chooseBtn')).toBeEnabled();
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
        diagnostics = await startDiagnostics(page, engine);
        await diagnostics?.sample('ready');
        const name = `integration-${engine}.txt`;
        async function send(buffer, filename = name) {
            await page.locator('#fileInput').setInputFiles({ name: filename, mimeType: 'text/plain', buffer });
            await diagnostics?.sample(`${stage}: selected`);
            await page.locator('#uploadBtn').click();
            try { await expect(page.locator('#results')).toBeVisible({ timeout: 60000 }); }
            catch {
                const state = await page.evaluate(() => ({ phase: window.UploadManager.currentPhase, running: window.UploadManager.running, requests: window.TransferSession.aborters.size, files: window.__fileTransfer.getQueue().map(f => ({done:f.done,failed:f.failed,text:f.presentation?.text})) }));
                throw new Error('Completion deadline: ' + JSON.stringify(state));
            }
            const result = await page.evaluate(() => window.__fileTransfer.getQueue().map(f => ({ failed: f.failed, skipped: !!f.skipped, savedName: f.serverResult?.filename || f.name })));
            if (result.some(f => f.failed)) throw new Error('Transfer failed: ' + await page.locator('.progress-text').allTextContents());
            const accounting = await page.evaluate(() => ({
                acknowledged: window.UploadManager.completionRates.acknowledgedMediaBytes,
                current: window.UploadManager.completionRates.currentMediaBytesPerSecond,
                files: window.__fileTransfer.getQueue().reduce((sum, file) => sum + (file.acknowledgedBytes || 0), 0)
            }));
            if (accounting.current !== 0 || accounting.acknowledged !== accounting.files ||
                (!result[0].skipped && accounting.acknowledged !== buffer.length)) throw new Error('Acknowledged accounting mismatch');
            await diagnostics?.sample(`${stage}: completed`);
            return result[0];
        }
        async function reset() {
            await page.getByRole('button', { name: 'Start another transfer', exact: true }).click();
            await diagnostics?.sample('reset');
        }
        stage = 'whole-file integrity';
        const first = Buffer.from(`synthetic ${engine} integration content A`);
        await send(first);
        const normalTiming = await page.evaluate(() => performance.getEntriesByType('resource')
            .filter(entry => new URL(entry.name).pathname === '/upload_single')
            .flatMap(entry => entry.serverTiming.map(value => value.name)));
        if (!normalTiming.includes('finalize') || normalTiming.some(value => ['flush', 'hash', 'lockwait', 'verification', 'publication', 'index'].includes(value)))
            throw new Error('Detailed benchmark attribution leaked into normal operation');
        if (!(await fs.readFile(path.join(uploads, name))).equals(first)) throw new Error('Content mismatch');
        await reset();
        stage = 'duplicate';
        if (!(await send(first)).skipped) throw new Error('Duplicate was not skipped');
        await reset();
        stage = 'collision';
        const second = Buffer.from(`synthetic ${engine} integration content B`);
        const collision = await send(second);
        if (collision.savedName === name || path.basename(collision.savedName) !== collision.savedName) throw new Error('Collision allocation failed');
        if (!(await fs.readFile(path.join(uploads, collision.savedName))).equals(second)) throw new Error('Collision content mismatch');
        await reset();
        if (engine === 'chromium') {
            stage = 'chunked retry and integrity';
            const source = path.join(path.dirname(uploads), 'synthetic-chunk-source.bin');
            const stream = createWriteStream(source);
            const block = Buffer.alloc(1024 * 1024, 0x5a);
            for (let i = 0; i < 101; i++) if (!stream.write(block)) await once(stream, 'drain');
            stream.end(); await once(stream, 'finish');
            let injected = false, requests = 0;
            await page.route('**/upload_chunk', async route => {
                requests++;
                if (!injected) { injected = true; return route.fulfill({ status: 503, body: '{}' }); }
                await route.continue();
            });
            await page.locator('#fileInput').setInputFiles(source);
            await page.locator('#uploadBtn').click();
            await expect(page.locator('#results')).toBeVisible({ timeout: 120000 });
            const state = await page.evaluate(() => ({ retry: window.UploadManager.retryCount,
                acknowledged: window.UploadManager.completionRates.acknowledgedMediaBytes,
                failed: window.__fileTransfer.getQueue()[0].failed }));
            if (state.failed || state.retry !== 1 || requests < 3 || state.acknowledged !== 101 * 1024 * 1024) throw new Error('Chunk retry path failed');
            const hash = async filename => {
                const h = crypto.createHash('sha256');
                for await (const chunk of createReadStream(filename)) h.update(chunk);
                return h.digest('hex');
            };
            if (await hash(source) !== await hash(path.join(uploads, path.basename(source)))) throw new Error('Chunk content mismatch');
            await diagnostics?.sample('chunk retry: completed');
            await reset();
            await page.unroute('**/upload_chunk');
            if (diagnostics) {
                stage = 'mixed synthetic profile';
                const sources = [];
                for (let index = 0; index < 52; index++) {
                    const filename = path.join(path.dirname(uploads), `profile-synthetic-${index}.bin`);
                    const output = createWriteStream(filename);
                    const data = Buffer.alloc(1024 * 1024, index + 1);
                    const blocks = index < 50 ? 2 : 120;
                    for (let block = 0; block < blocks; block++) if (!output.write(data)) await once(output, 'drain');
                    output.end(); await once(output, 'finish'); sources.push(filename);
                }
                // Attribute disk-backed selection separately from DOM work.
                // These probes exist only inside the owned synthetic test page.
                await page.evaluate(() => {
                    const m = window.UploadManager, add = m.addFiles;
                    let prototype = File.prototype;
                    while (prototype && !Object.getOwnPropertyDescriptor(prototype, 'size')) prototype = Object.getPrototypeOf(prototype);
                    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'size');
                    const probe = window.__syntheticSelectionProbe = { addFilesMs: 0, sizeGetterMs: 0, sizeGetterCalls: 0, maxSizeGetterMs: 0 };
                    if (descriptor?.configurable && descriptor.get) Object.defineProperty(prototype, 'size', {
                        ...descriptor, get() {
                            const before = performance.now();
                            try { return descriptor.get.call(this); }
                            finally {
                                const elapsed = performance.now() - before;
                                probe.sizeGetterMs += elapsed; probe.sizeGetterCalls++;
                                probe.maxSizeGetterMs = Math.max(probe.maxSizeGetterMs, elapsed);
                            }
                        }
                    });
                    m.addFiles = function(files) {
                        const before = performance.now();
                        try { return add.call(this, files); }
                        finally { probe.addFilesMs += performance.now() - before; }
                    };
                    window.__restoreSyntheticSelectionProbe = () => {
                        m.addFiles = add;
                        if (descriptor?.configurable) Object.defineProperty(prototype, 'size', descriptor);
                    };
                });
                try { await page.locator('#fileInput').setInputFiles(sources); }
                finally { await page.evaluate(() => window.__restoreSyntheticSelectionProbe()); }
                await diagnostics.sample('mixed: selected');
                await page.locator('#uploadBtn').click();
                await expect(page.locator('#results')).toBeVisible({ timeout: 120000 });
                const mixed = await page.evaluate(() => ({ failed: window.UploadManager.errorCount,
                    acknowledged: window.UploadManager.completionRates.acknowledgedMediaBytes,
                    saved: window.__fileTransfer.getQueue().map(f => f.serverResult?.filename) }));
                if (mixed.failed || mixed.acknowledged !== 340 * 1024 * 1024) throw new Error('Mixed workload accounting failed');
                await diagnostics.sample('mixed: completed');
                for (let index = 0; index < sources.length; index++) {
                    const saved = mixed.saved[index];
                    if (!saved || saved !== path.basename(saved) || await hash(sources[index]) !== await hash(path.join(uploads, saved))) throw new Error('Mixed workload integrity failed');
                }
                await reset();
            }
        }
        console.log(`${engine}: isolated browser integration passed`);
    } finally {
        try { await diagnostics?.finish(); }
        finally { await context.close(); await browser.close(); }
    }
})().catch(error => { console.error(`Browser integration failed at ${stage}: ${String(error.message).replace(/https?:[^\s]+/g, '[origin]').replace(/[a-f0-9]{64}/g, '[credential]').slice(0,1200)}`); process.exitCode = 1; });
