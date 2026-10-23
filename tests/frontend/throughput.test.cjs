const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function tracker() {
    const context = vm.createContext({ window: {}, performance });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Server/static/js/core/throughput.js'), 'utf8'), context);
    let now = 0;
    const rates = new context.window.BrowserThroughputTracker(0, 8 * 1024 * 1024, () => now);
    return { rates, at: time => { now = time; } };
}

test('rolling acknowledgements follow mobile window accounting independent of display frequency', () => {
    const { rates, at } = tracker();
    at(1000); rates.recordAcknowledgement(1_000_000);
    const first = rates.snapshot();
    assert.equal(first.currentMediaBytesPerSecond, 1_000_000);
    at(2000); rates.recordAcknowledgement(3_000_000);
    for (let i = 0; i < 100; i++) rates.snapshot();
    assert.equal(rates.snapshot().currentMediaBytesPerSecond, 2_000_000);
    assert.equal(first.acknowledgedMediaBytes, 1_000_000);
    at(6000); rates.recordAcknowledgement(1_000_000);
    assert.equal(rates.snapshot().currentMediaBytesPerSecond, 800_000);
    assert.equal(rates.snapshot().averageMediaBytesPerSecond, 5_000_000 / 6);
});

test('slow acknowledgements have bounded freshness, recover and terminate at exact zero', () => {
    const { rates, at } = tracker();
    at(10000); rates.recordAcknowledgement(1_000_000);
    at(25000); assert.equal(rates.snapshot().currentMediaBytesPerSecond, 200_000);
    at(40001); assert.equal(rates.snapshot().currentMediaBytesPerSecond, 0);
    at(45000); rates.recordAcknowledgement(2_000_000);
    assert.equal(rates.snapshot().currentMediaBytesPerSecond, 400_000);
    const summary = rates.finish();
    at(90000); rates.recordAcknowledgement(100_000_000);
    assert.equal(rates.snapshot().currentMediaBytesPerSecond, 0);
    assert.equal(rates.snapshot().averageMediaBytesPerSecond, summary.averageMediaBytesPerSecond);
    assert.equal(rates.snapshot().acknowledgedMediaBytes, 3_000_000);
    assert.equal(rates.samples.length, 0);
});

test('invalid acknowledgements and a backward clock cannot corrupt a session', () => {
    const { rates, at } = tracker();
    for (const bytes of [NaN, Infinity, -1, 0]) rates.recordAcknowledgement(bytes);
    at(2000); rates.recordAcknowledgement(1_000_000);
    at(1000); rates.recordAcknowledgement(1_000_000);
    assert.equal(rates.snapshot().currentMediaBytesPerSecond, 1_000_000);
    assert.equal(rates.snapshot().sampledAt, 2000);
});
