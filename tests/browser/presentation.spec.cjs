const { test, expect } = require('@playwright/test');
const { startFixture } = require('./fixture.cjs');
const path = require('node:path');
let fixture;
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture.close(); });
async function open(page) { await page.goto(fixture.url + '/?token=synthetic-presentation'); await expect(page.locator('#chooseBtn')).toBeEnabled(); }
async function selected(page, files) { await page.locator('#fileInput').setInputFiles(files); await page.waitForFunction(() => window.UploadManager.selection.pending === 0); }
async function photo() { return { name: 'synthetic-photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }; }
test('file details start collapsed, paginate, search saved names, and filter failures', async ({ page }, testInfo) => {
    await open(page);
    await page.evaluate(async () => { await window.__fileTransfer.addFiles(Array.from({ length: 205 }, (_, i) => new File(['synthetic'], `synthetic-${i}.txt`))); });
    await expect(page.locator('.file-item')).toHaveCount(0);
    await page.locator('#fileDetails > summary').click();
    await expect(page.locator('.file-item')).toHaveCount(100);
    await page.locator('#fileNext').click();
    await expect(page.locator('#fileRange')).toContainText('101');
    await page.locator('#fileSearch').fill('synthetic-204');
    await expect(page.locator('.file-item')).toHaveCount(1);
    await page.locator('#fileSearch').fill('missing');
    await expect(page.locator('#fileRange')).toContainText('No files match');
    await page.locator('#resetBtn').click();
    await page.route('**/upload_single', route => {
        const name = route.request().headers()['x-filename'];
        return route.fulfill(name === 'synthetic-fail.txt' ? { status: 503, json: { error: 'Temporary failure' } } : { json: { success: true, filename: 'synthetic-renamed.txt' } });
    });
    await selected(page, ['synthetic-fail.txt', 'synthetic-ok.txt'].map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('synthetic') })));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'mixed');
    await page.locator('#fileDetails > summary').click();
    await page.locator('#fileFilter').selectOption('failed');
    await expect(page.locator('.file-item')).toHaveCount(1);
    await page.locator('#fileFilter').selectOption('all');
    await page.locator('#fileSearch').fill('renamed');
    await expect(page.locator('.file-item')).toHaveCount(1);
    await expect(page.locator('#retryFailed')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mixed-results.png'), fullPage: true });
});
test('photo thumbnails remain separate from status and archives use type icons', async ({ page }) => {
    await open(page);
    await selected(page, [await photo(), { name: 'synthetic-archive.rar', mimeType: '', buffer: Buffer.from('synthetic') }]);
    await page.locator('#fileDetails > summary').click();
    await page.locator('#fileRows .media-preview[data-kind="photo"]').scrollIntoViewIfNeeded();
    await expect(page.locator('#fileRows .media-preview[data-kind="photo"] img')).toBeVisible();
    await expect(page.locator('#fileRows .media-preview[data-kind="archive"] svg')).toBeVisible();
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'complete');
    await expect(page.locator('#fileRows .media-preview[data-kind="photo"] img')).toBeVisible();
    await expect(page.locator('#uploadBtn')).toBeHidden();
    await expect(page.locator('#resultMetrics')).toContainText('Average speed');
    await expect(page.locator('#startAnother')).toBeVisible();
});
test('new preview work waits until active uploads terminate', async ({ page }, testInfo) => {
    await open(page);
    await selected(page, [await photo()]);
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route('**/upload_single', async (route) => { await hold; await route.fulfill({ json: { success: true } }); });
    await page.evaluate(() => { const original = window.MediaPreviews.decode.bind(window.MediaPreviews); window.syntheticPreviewStarts = 0; window.MediaPreviews.decode = (...args) => { window.syntheticPreviewStarts++; return original(...args); }; });
    await page.locator('#uploadBtn').click();
    await page.locator('#fileDetails > summary').click();
    await expect(page.locator('.file-item')).toHaveCount(1);
    expect(await page.evaluate(() => window.syntheticPreviewStarts)).toBe(0);
    try { await page.screenshot({ path: testInfo.outputPath('active-transfer.png'), fullPage: true }); }
    finally { release(); }
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'complete');
    await page.locator('#fileRows .media-preview').scrollIntoViewIfNeeded();
    await expect(page.locator('#fileRows .media-preview img')).toBeVisible();
    expect(await page.evaluate(() => window.syntheticPreviewStarts)).toBe(1);
    await page.locator('#startAnother').click();
    expect(await page.evaluate(() => ({ cache: window.MediaPreviews.cache.size, bindings: window.MediaPreviews.bindings.size, rows: window.ProgressTracker.rows.size }))).toEqual({ cache: 0, bindings: 0, rows: 0 });
});
test('native video preview is static, unsupported and corrupt media retain icons', async ({ page, browserName }) => {
    await open(page);
    await selected(page, [path.join(__dirname, 'fixtures/synthetic-video.mp4')]);
    await page.locator('#fileDetails > summary').click();
    await page.locator('#fileRows .media-preview').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.MediaPreviews.cache.size + window.MediaPreviews.failed.size)).toBe(1);
    if (browserName !== 'webkit')
        await expect(page.locator('#fileRows .media-preview img')).toBeVisible();
    // This Windows WebKit distribution advertises H.264 but an independent
    // native-video probe returns MEDIA_ERR_SRC_NOT_SUPPORTED (4). Verify fallback.
    else if (await page.locator('#fileRows .media-preview img').count() === 0)
        await expect(page.locator('#fileRows .media-preview[data-kind="video"] svg')).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
    await page.locator('#resetBtn').click();
    await selected(page, { name: 'synthetic-corrupt.heic', mimeType: 'image/heic', buffer: Buffer.from('invalid synthetic media') });
    await page.locator('#fileDetails > summary').click();
    await page.locator('#fileRows .media-preview').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.MediaPreviews.failed.size)).toBe(1);
    await expect(page.locator('#fileRows .media-preview img')).toHaveCount(0);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'complete');
});
test('invalid confirmations cannot acknowledge media and results stay actionable', async ({ page }) => {
    await open(page);
    await selected(page, { name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
    await page.route('**/upload_single', route => route.fulfill({ json: { success: true, skipped: 'yes' } }));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'failed');
    expect(await page.evaluate(() => window.UploadManager.completionRates.acknowledgedMediaBytes)).toBe(0);
    await expect(page.locator('#retryFailed')).toBeHidden();
    await expect(page.locator('#startAnother')).toBeVisible();
});
test('untrusted filenames stay plain text and completion respects reduced motion', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await selected(page, { name: '<img src=x onerror=alert(1)>.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
    await page.locator('#fileDetails > summary').click();
    await expect(page.locator('.file-name img')).toHaveCount(0);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toBeVisible();
    expect(parseFloat(await page.locator('#results').evaluate(e => getComputedStyle(e).transitionDuration))).toBeLessThan(.001);
    await page.screenshot({ path: testInfo.outputPath('persistent-result.png'), fullPage: true });
});
