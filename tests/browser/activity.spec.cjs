const { test, expect } = require('@playwright/test');
const { startFixture } = require('./fixture.cjs');

let fixture;
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture.close(); });

async function open(page) {
    await page.goto(fixture.url + '/?token=synthetic-activity');
    await expect(page.locator('#chooseBtn')).toBeEnabled();
}
async function select(page, names) {
    await page.locator('#fileInput').setInputFiles(names.map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('synthetic') })));
    await page.waitForFunction(() => window.UploadManager.selection.pending === 0);
}

test('one permanent row retains out-of-order outcomes without rotating between active files', async ({ page }, testInfo) => {
    // Hold three parallel requests in every viewport; production defaults are unchanged.
    await page.route('**/config', route => route.fulfill({ json: { browser: {
        desktop: { parallelFiles: 3 }, mobile: { parallelFiles: 3 }
    } } }));
    await open(page);
    const row = page.locator('#activityRow');
    await expect(row).toBeVisible();
    await expect(page.locator('#activityViewFiles')).toBeDisabled();
    const height = (await row.boundingBox()).height;
    await row.evaluate(element => { window.syntheticActivityNode = element; });
    const held = new Map();
    await page.route('**/upload_single', async route => {
        const name = decodeURIComponent(route.request().headers()['x-filename']);
        const result = await new Promise(resolve => held.set(name, resolve));
        await route.fulfill(result);
    });
    await select(page, ['synthetic-first.txt', 'synthetic-second.txt', 'synthetic-third.txt']);
    await page.locator('#uploadBtn').click();
    try {
        await expect.poll(() => held.size).toBe(3);
        await expect(page.locator('#activityState')).toHaveText('3 uploading');
        await page.locator('#recentActivity').screenshot({ path: testInfo.outputPath('recent-active.png') });
        held.get('synthetic-second.txt')({ json: { success: true, filename: 'synthetic-second.txt' } });
        await expect(page.locator('#activityName')).toHaveText('synthetic-second.txt');
        await expect(page.locator('#activityStatus')).toHaveText('Done');
        await page.evaluate(() => {
            const controller = window.UploadManager;
            controller.transportObserver(controller.fileQueue[0]).onSending(42, false);
        });
        await expect(page.locator('#activityName')).toHaveText('synthetic-second.txt');
        await expect(page.locator('#activityState')).toHaveText('2 uploading');
        held.get('synthetic-first.txt')({ json: { success: true, filename: 'synthetic-first-renamed.txt' } });
        await expect(page.locator('#activityName')).toHaveText('synthetic-first.txt');
        await expect(page.locator('#activityStatus')).toContainText('synthetic-first-renamed.txt');
        held.get('synthetic-third.txt')({ status: 503, json: { error: 'Synthetic receiver unavailable' } });
        await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'mixed');
        await expect(page.locator('#activityName')).toHaveText('synthetic-third.txt');
        await expect(row).toHaveClass(/error/);
        await expect(page.locator('#activityStatus')).toHaveText('Synthetic receiver unavailable');
        expect(await row.evaluate(element => element === window.syntheticActivityNode)).toBe(true);
        expect((await row.boundingBox()).height).toBeCloseTo(height, 2);
        await expect(page.locator('#fileDetails')).not.toHaveAttribute('open', '');
        await page.locator('#recentActivity').screenshot({ path: testInfo.outputPath('recent-mixed.png') });
        await page.locator('#startAnother').click();
        await expect(page.locator('#activityName')).toHaveText('No recent file');
        expect(await row.evaluate(element => element === window.syntheticActivityNode)).toBe(true);
        expect((await row.boundingBox()).height).toBeCloseTo(height, 2);
        await expect(page.locator('#activityViewFiles')).toBeDisabled();
        await expect.poll(() => page.evaluate(() => window.TransferView.activityTimer)).toBeUndefined();
    } finally {
        for (const release of held.values()) release({ status: 503, json: {} });
    }
});

test('verified skips and retry results persist while View all files clears obsolete filters', async ({ page }) => {
    await open(page);
    await page.route('**/upload/preflight', route => {
        const files = route.request().postDataJSON().files;
        return route.fulfill({ json: { files: files.map(file => ({ id: file.id, action: 'hash_required' })) } });
    });
    await page.route('**/upload/preflight/verify', route => {
        const files = route.request().postDataJSON().files;
        return route.fulfill({ json: { files: files.map(file => ({ id: file.id, action: 'skip', filename: file.name })) } });
    });
    await select(page, ['synthetic-skip-1.txt', 'synthetic-skip-2.txt']);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'complete');
    await expect(page.locator('#activityName')).toHaveText('synthetic-skip-2.txt');
    await expect(page.locator('#activityStatus')).toHaveText('Already exists');
    await expect(page.locator('#activityState')).toHaveText('Transfer finished');
    expect(await page.evaluate(() => window.UploadManager.completionRates.acknowledgedMediaBytes)).toBe(0);
    await page.locator('#activityViewFiles').click();
    await page.locator('#fileFilter').selectOption('failed');
    await expect(page.locator('.file-item')).toHaveCount(0);
    await page.locator('#activityViewFiles').click();
    await expect(page.locator('#fileFilter')).toHaveValue('all');
    await expect(page.locator('.file-item')).toHaveCount(2);
    await page.locator('#startAnother').click();
    await page.unroute('**/upload/preflight');
    let rejected = true;
    await page.route('**/upload_single', route => route.fulfill(rejected
        ? { status: 503, json: { error: 'Synthetic retryable error' } }
        : { json: { success: true, filename: 'synthetic-retry.txt' } }));
    await select(page, ['synthetic-retry.txt']);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#activityRow')).toHaveClass(/error/);
    rejected = false;
    await page.locator('#retryFailed').click();
    await expect(page.locator('#activityStatus')).toHaveText('Done');
    await expect(page.locator('#activityRow')).not.toHaveClass(/error/);
    await page.locator('#startAnother').click();
    await select(page, ['synthetic-new.txt']);
    await expect(page.locator('#activityName')).toHaveText('No recent file');
    expect(await page.evaluate(() => window.UploadManager.getSnapshot().activity)).toBe(null);
});

test('checking and expired authentication stay truthful without hiding the row', async ({ page }) => {
    await open(page);
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/upload/preflight', async route => { await held; await route.fulfill({ status: 401, json: {} }); });
    await select(page, ['synthetic-auth.txt']);
    await page.locator('#uploadBtn').click();
    try {
        await expect(page.locator('#activityState')).toHaveText('Checking files');
        await expect(page.locator('#activityStatus')).toHaveText('Checking files');
    } finally { release(); }
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'blocked');
    await expect(page.locator('#activityRow')).toBeVisible();
    await expect(page.locator('#activityState')).toHaveText('Transfer stopped');
    await expect(page.locator('#activityStatus')).toContainText('Not sent');
});

test('long names and translated statuses fit a stable row without entrance animation', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await select(page, ['<img src=x onerror=alert(1)>-' + 'synthetic-'.repeat(35) + '.txt']);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'complete');
    await expect(page.locator('#activityRow img')).toHaveCount(0);
    for (const language of ['he', 'ru', 'en']) {
        await page.evaluate(value => window.I18n.setLanguage(value), language);
        await expect(page.locator('#recentActivity h2')).toHaveText(await page.evaluate(() => window.I18n.t('activity.title')));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (language === 'he') await page.locator('#recentActivity').screenshot({ path: testInfo.outputPath('recent-rtl.png') });
    }
    expect(await page.locator('#recentActivity').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await page.locator('#recentActivity').screenshot({ path: testInfo.outputPath('recent-long-name.png') });
});

test('activity previews wait for uploads, share the cache, and release bindings on reset', async ({ page }) => {
    await open(page);
    await page.locator('#fileInput').setInputFiles({ name: 'synthetic-photo.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    await page.waitForFunction(() => window.UploadManager.selection.pending === 0);
    await page.evaluate(() => {
        const decode = window.MediaPreviews.decode.bind(window.MediaPreviews);
        window.syntheticPreviewStarts = 0;
        window.MediaPreviews.decode = (...args) => { window.syntheticPreviewStarts++; return decode(...args); };
    });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/upload_single', async route => { await held; await route.fulfill({ json: { success: true } }); });
    await page.locator('#uploadBtn').click();
    try {
        await expect(page.locator('#activityName')).toHaveText('synthetic-photo.png');
        await page.locator('#recentActivity').scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => window.syntheticPreviewStarts)).toBe(0);
        await expect(page.locator('#activityPreview img')).toHaveCount(0);
    } finally { release(); }
    await expect(page.locator('#results')).toHaveAttribute('data-outcome', 'complete');
    await page.locator('#recentActivity').scrollIntoViewIfNeeded();
    await expect(page.locator('#activityPreview img')).toBeVisible();
    await expect(page.locator('#activityStatus')).toHaveText('Done');
    await page.locator('#activityViewFiles').click();
    await page.locator('#fileRows').scrollIntoViewIfNeeded();
    await expect(page.locator('#fileRows .media-preview img')).toBeVisible();
    expect(await page.evaluate(() => window.syntheticPreviewStarts)).toBe(1);
    await page.locator('#startAnother').click();
    expect(await page.evaluate(() => ({ cache: window.MediaPreviews.cache.size, bindings: window.MediaPreviews.bindings.size })))
        .toEqual({ cache: 0, bindings: 0 });
    await expect(page.locator('#activityPreview img')).toHaveCount(0);
});
