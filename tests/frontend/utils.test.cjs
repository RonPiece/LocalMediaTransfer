const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('browser transfer size and speed labels use decimal units', () => {
    const source = fs.readFileSync(path.join(__dirname,
        '../../src/Server/static/js/core/utils.js'), 'utf8');
    const context = { window: {} };
    vm.runInNewContext(source, context);
    assert.equal(context.window.Utils.formatBytes(1_000_000), '1 MB');
    assert.equal(context.window.Utils.formatBytes(1_000_000_000), '1 GB');
    assert.equal(context.window.Utils.formatSpeed(1_000_000), '1 MB/s');
});
