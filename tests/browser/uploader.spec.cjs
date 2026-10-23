const { test, expect } = require('@playwright/test');
const { startFixture } = require('./fixture.cjs');
let fixture;
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture.close(); });
async function open(page) {
    await page.goto(fixture.url + '/?token=synthetic-browser-test');
    await expect(page.locator('#chooseBtn')).toBeEnabled();
}
async function select(page, count = 1) {
    await page.locator('#fileInput').setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `synthetic-${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`synthetic content ${i}`) })));
    await page.waitForFunction(() => window.UploadManager.selection.pending === 0);
    if (!(await page.locator('#fileDetails').evaluate(e => e.open))) await page.locator('#fileDetails > summary').click();
}

test('startup, selection, successful transfer and reset', async ({ page }) => {
    await open(page);
    await select(page);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Transfer Complete');
    await expect(page.locator('.file-item')).toContainText('Done');
    await page.getByRole('button', { name: 'Start another transfer', exact: true }).click();
    await expect(page.locator('.file-item')).toHaveCount(0);
    await expect(page.locator('#chooseBtn')).toBeEnabled();
});

test('large selection pages lazily and reset cancels late rendering', async ({ page }) => {
    await open(page); await select(page, 1000);
    await expect(page.locator('.file-item')).toHaveCount(100);
    await expect(page.locator('#fileDetails')).toHaveCount(1);
    await page.locator('#fileNext').click();
    await expect(page.locator('#fileRange')).toContainText('101');
    await expect(page.locator('.file-item')).toHaveCount(100);
    await page.locator('#fileDetails > summary').click();
    await expect(page.locator('.file-item')).toHaveCount(0);
    await page.locator('#resetBtn').click();
    await expect(page.locator('.file-item')).toHaveCount(0);
    await expect(page.locator('#fileDetails')).toBeHidden();
});

test('blocked language storage does not prevent startup', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Unavailable', 'SecurityError'); } }));
    await open(page);
    await select(page);
    await expect(page.locator('.file-item')).toHaveCount(1);
});

for (const reason of ['missing', 'rejected']) {
    test(`${reason} authentication keeps uploader locked`, async ({ page }) => {
        if (reason === 'rejected') await page.route('**/verify_token', route => route.fulfill({ status: 403, json: {} }));
        await page.goto(fixture.url + (reason === 'missing' ? '/' : '/?token=synthetic-invalid'));
        await expect(page.locator('#tokenModal')).toBeVisible();
        await expect(page.locator('#chooseBtn')).toBeDisabled();
        await expect(page.locator('#uploadBtn')).toBeDisabled();
    });
}

test('authentication is bounded and a retained credential can retry', async ({ page }) => {
    await page.clock.install();
    let observed;
    const requested = new Promise(resolve => { observed = resolve; });
    await page.route('**/verify_token', async () => { observed(); });
    await page.goto(fixture.url + '/?token=synthetic-timeout');
    await requested;
    await expect(page.locator('#chooseBtn')).toBeDisabled();
    await page.clock.fastForward(10001);
    await expect(page.locator('#startupMessage')).toContainText('could not be reached');
    await page.unroute('**/verify_token');
    await page.locator('#startupRetry').click();
    await expect(page.locator('#chooseBtn')).toBeEnabled();
});

for (const resource of ['upload/workers', 'core/session', 'core/throughput', 'app']) {
test(`required resource failure (${resource}) exposes a working reload action`, async ({ page }) => {
    const resourceUrl = `**/js/${resource}.js?*`;
    await page.route(resourceUrl, route => route.abort());
    await page.goto(fixture.url + '/?token=synthetic-resource');
    await expect(page.locator('#startupMessage')).toContainText('could not load');
    await expect(page.locator('#chooseBtn')).toBeDisabled();
    await page.unroute(resourceUrl);
    await page.locator('#startupRetry').click();
    await expect(page.locator('#chooseBtn')).toBeEnabled();
});
}

test('stalled language loading cannot hold initialization indefinitely', async ({ page }) => {
    await page.clock.install();
    let observed;
    const requested = new Promise(resolve => { observed = resolve; });
    await page.route('**/i18n/en.json?*', () => { observed(); });
    await page.goto(fixture.url + '/?token=synthetic-language');
    await requested;
    await page.clock.fastForward(10001);
    await expect(page.locator('#chooseBtn')).toBeEnabled();
});

test('latest language choice wins over a slower previous response', async ({ page }) => {
    await open(page);
    let release, observed;
    const held = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { observed = resolve; });
    await page.route('**/i18n/he.json?*', async route => { observed(); await held; await route.continue(); });
    await page.evaluate(() => { window.slowLanguage = window.I18n.setLanguage('he'); });
    await requested;
    await page.evaluate(() => window.I18n.setLanguage('ru'));
    release();
    await page.evaluate(() => window.slowLanguage);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('#chooseBtn')).toHaveText(require('../../src/Server/static/i18n/ru.json')['upload.choose']);
});

test('failed upload recovered as an exact duplicate has no stale errors', async ({ page }) => {
    let checks = 0, uploads = 0;
    await page.route('**/upload_single', route => { uploads++; return route.fulfill({ status: 503, json: {} }); });
    await page.route('**/upload/preflight', route => {
        const { files } = route.request().postDataJSON();
        checks++;
        return route.fulfill({ json: { files: checks === 1 ? [] : files.map(file => ({ id: file.id, action: 'hash_required' })) } });
    });
    await page.route('**/upload/preflight/verify', route => {
        const { files } = route.request().postDataJSON();
        return route.fulfill({ json: { files: files.map(file => ({ id: file.id, action: 'skip' })) } });
    });
    await open(page); await select(page); await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Transfer failed');
    await page.getByRole('button', { name: 'Retry failed files', exact: true }).click();
    await expect(page.locator('#results')).toContainText('Transfer Complete');
    await expect(page.locator('#errorCount')).toHaveText('0');
    await expect(page.locator('.file-item.error')).toHaveCount(0);
    expect(uploads).toBe(1);
});

test('mixed result retries only eligible failed files', async ({ page }) => {
    let calls = 0;
    await page.route('**/upload_single', async route => {
        calls++;
        return route.fulfill({ status: calls === 1 ? 503 : 200, json: calls === 1 ? { error: 'Temporary receiver failure' } : { success: true } });
    });
    await open(page);
    await select(page, 2);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Some files need attention');
    await expect(page.locator('#results')).toContainText('Failed');
    await page.getByRole('button', { name: 'Retry failed files', exact: true }).click();
    await expect(page.locator('#results')).toContainText('Transfer Complete');
    expect(calls).toBe(3);
    await expect(page.locator('.file-item.error')).toHaveCount(0);
});

test('terminal failure has honest results without an unsupported retry', async ({ page }) => {
    await page.route('**/upload_single', route => route.fulfill({ status: 409, json: { code: 'filename_conflict', filename: 'synthetic.txt' } }));
    await open(page); await select(page);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Transfer failed');
    await expect(page.getByRole('button', { name: 'Retry failed files', exact: true })).toHaveCount(0);
});

test('authentication loss stops queued work and keeps controls locked', async ({ page }) => {
    let calls = 0;
    await page.route('**/upload_single', route => { calls++; return route.fulfill({ status: 401, json: {} }); });
    await open(page); await select(page, 10);
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Session expired');
    await expect(page.locator('#results')).toBeVisible();
    await expect(page.locator('#uploadBtn')).toBeDisabled();
    expect(calls).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => window.UploadManager.getSnapshot().counts.failed)).toBe(10);
    await page.locator('#fileFilter').selectOption('failed');
    await expect(page.locator('.file-item')).toHaveCount(10);
});

test('optional history and cleanup cannot hold completion or a later selection', async ({ page }) => {
    await page.route('**/transfer_history', async () => {});
    await open(page);
    await page.evaluate(() => { window.uploadCacheManager.performCleanup = () => new Promise(() => {}); });
    await select(page); await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Transfer Complete');
    await page.getByRole('button', { name: 'Start another transfer', exact: true }).click();
    await select(page, 2);
    await expect(page.locator('.file-item')).toHaveCount(2);
});

for (const hashFailure of [false, true]) {
    test(`candidate verification ${hashFailure ? 'recovers from hash failure' : 'skips exact duplicates'}`, async ({ page }) => {
        await page.route('**/upload/preflight', route => {
            const { files } = route.request().postDataJSON();
            return route.fulfill({ json: { files: files.map(f => ({ id: f.id, action: 'hash_required' })) } });
        });
        await page.route('**/upload/preflight/verify', route => {
            const { files } = route.request().postDataJSON();
            return route.fulfill({ json: { files: files.map(f => ({ id: f.id, action: 'skip', filename: f.name })) } });
        });
        if (hashFailure) await page.route('**/hash-worker.js?*', route => route.abort());
        await open(page); await select(page); await page.locator('#uploadBtn').click();
        await expect(page.locator('#results')).toContainText('Transfer Complete');
        await expect(page.locator('.progress-text')).toContainText(hashFailure ? 'Done' : 'Already exists');
    });
}

test('preflight timeout falls back and expired preflight never starts uploads', async ({ page }) => {
    await open(page); await select(page);
    await page.evaluate(() => { window.DuplicatePreflight.REQUEST_TIMEOUT_MS = 50; });
    await page.route('**/upload/preflight', async () => {});
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Transfer Complete');
    await page.getByRole('button', { name: 'Start another transfer', exact: true }).click();
    await page.unroute('**/upload/preflight');
    await page.evaluate(() => { window.DuplicatePreflight.REQUEST_TIMEOUT_MS = 30000; });
    await page.route('**/upload/preflight', route => route.fulfill({ status: 401, json: {} }));
    let uploads = 0;
    page.on('request', request => { if (request.url().endsWith('/upload_single')) uploads++; });
    await select(page); await page.locator('#uploadBtn').click();
    await expect(page.locator('#startupMessage')).toContainText('session is unavailable');
    await expect(page.locator('#uploadBtn')).toBeDisabled();
    expect(uploads).toBe(0);
});

test('hash inactivity replaces a stuck worker and releases pending work', async ({ page }) => {
    await open(page);
    await page.route('**/upload/preflight', route => {
        const { files } = route.request().postDataJSON();
        return route.fulfill({ json: { files: files.map(f => ({ id: f.id, action: 'hash_required' })) } });
    });
    await page.evaluate(() => {
        window.DuplicatePreflight.HASH_IDLE_MS = 50;
        window.Worker = class {
            postMessage() {}
            terminate() {}
        };
    });
    await select(page); await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toContainText('Transfer Complete');
    expect(await page.evaluate(() => window.DuplicatePreflight.requests.size)).toBe(0);
});

test('desktop drop and repeated selection preserve the visible queue', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['synthetic'], 'synthetic-drop.txt'));
        document.getElementById('uploadZone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    await select(page);
    await expect.poll(() => page.evaluate(() => window.__fileTransfer.getQueue().length)).toBe(2);
    await page.locator('#resetBtn').click();
    await page.evaluate(() => window.__fileTransfer.uploadFiles());
    await expect(page.locator('#noFilesModal')).toBeVisible();
});

test('hidden rows reconstruct terminal state and active queues reject mutation', async ({ page }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/upload_single', async route => { await held; await route.fulfill({ json: { success: true } }); });
    await open(page); await select(page, 101); await page.locator('#uploadBtn').click();
    await expect(page.locator('#resetBtn')).toBeDisabled();
    const length = await page.evaluate(() => {
        window.__fileTransfer.addFiles([new File(['extra'], 'synthetic-extra.txt')]);
        window.__fileTransfer.resetFiles();
        return window.__fileTransfer.getQueue().length;
    });
    expect(length).toBe(101);
    release();
    await expect(page.locator('#results')).toBeVisible();
    await expect(page.locator('#results')).toBeVisible();
    await page.locator('#fileNext').click();
    await expect(page.locator('#fileRows .progress-text')).toHaveText('Done');
});

test('visual states preserve readable layout, translations and restrained motion', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.locator('#fileInput').setInputFiles({ name: 'synthetic-long-name-'.repeat(12) + '.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') });
    await page.locator('#fileDetails > summary').click();
    await expect(page.locator('.file-name')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('selection.png'), fullPage: true });
    await page.evaluate(() => window.I18n.setLanguage('he'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('button[data-lang="he"]')).toHaveClass(/active/);
    await expect(page.locator('#fileRange')).toContainText('מתוך');
    await expect(page.locator('.progress-text')).toHaveText(await page.evaluate(() => window.I18n.t('file.queued')));
    await expect(page.locator('#fileDetails > summary')).toHaveText(await page.evaluate(() => window.I18n.t('files.title')));
    await page.screenshot({ path: testInfo.outputPath('hebrew.png'), fullPage: true });
    await page.evaluate(() => window.I18n.setLanguage('ru'));
    await page.screenshot({ path: testInfo.outputPath('russian.png'), fullPage: true });
    await page.evaluate(() => window.I18n.setLanguage('en'));
    await page.locator('#uploadBtn').click();
    await expect(page.locator('#results')).toBeVisible();
    const duration = await page.locator('#results').evaluate(element => getComputedStyle(element).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
    await page.screenshot({ path: testInfo.outputPath('complete.png'), fullPage: true });
});
