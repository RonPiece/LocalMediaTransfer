const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
    testDir: '.',
    testMatch: '**/*.spec.cjs',
    timeout: 30000,
    fullyParallel: true,
    workers: 2,
    retries: 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        // Requests contain credentials, even with a clean address bar. Do not record them.
        trace: 'off', video: 'off', screenshot: 'only-on-failure'
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'phone', use: { ...devices['iPhone 13'] } },
        { name: 'tablet', use: { ...devices['iPad Mini'] } }
    ]
});
