const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.className = '';
        this.id = '';
        this.textContent = '';
        this.innerHTML = '';
        this.style = {};
        this.children = [];
        this._selectors = new Map();
        this.attributes = {};
        this.dataset = {};
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelector(selector) {
        return this._selectors.get(selector) || null;
    }

    setQuery(selector, value) {
        this._selectors.set(selector, value);
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }
}

function loadProgressTracker() {
    const idMap = new Map();
    const document = {
        createElement() {
            return new MockElement();
        },
        getElementById(id) {
            return idMap.get(id) || null;
        }
    };

    const context = {
        window: {
            LocalIcons: {
                setIcon(target, name) {
                    target.dataset.icon = name;
                    target.textContent = '';
                    return target;
                }
            },
            Utils: {
                formatBytes(value) {
                    return `${value} B`;
                }
            }
        },
        document,
        console
    };

    vm.createContext(context);
    const scriptPath = path.resolve(__dirname, '../../src/Server/static/js/ui/progress.js');
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');
    vm.runInContext(scriptSource, context, { filename: scriptPath });

    return {
        tracker: context.window.ProgressTracker,
        document,
        idMap
    };
}

test('updateAggregateProgress hides progress when there is no total', () => {
    const { tracker } = loadProgressTracker();
    const wrap = new MockElement();
    const bar = new MockElement();

    tracker.elements = {
        aggregateProgress: wrap,
        aggregateProgressBar: bar
    };

    tracker.updateAggregateProgress(0, 0);

    assert.equal(wrap.style.display, 'none');
    assert.equal(bar.style.transform, 'scaleX(0)');
    assert.equal(bar.attributes.role, 'progressbar');
    assert.equal(bar.attributes['aria-valuenow'], '0');
});

test('updateAggregateProgress uses uploaded bytes and clamps percentage', () => {
    const { tracker } = loadProgressTracker();
    const wrap = new MockElement();
    const bar = new MockElement();

    tracker.elements = {
        aggregateProgress: wrap,
        aggregateProgressBar: bar
    };

    tracker.updateAggregateProgress(950, 1000);

    assert.equal(wrap.style.display, 'block');
    assert.equal(bar.style.transform, 'scaleX(0.95)');
    assert.equal(bar.attributes.role, 'progressbar');
    assert.equal(bar.attributes['aria-valuenow'], '95');
});

test('updateAggregateProgress uses completed bytes from O(1) manager counters', () => {
    const { tracker } = loadProgressTracker();
    const wrap = new MockElement();
    const bar = new MockElement();

    tracker.elements = {
        aggregateProgress: wrap,
        aggregateProgressBar: bar
    };

    tracker.updateAggregateProgress(650, 1000);

    assert.equal(wrap.style.display, 'block');
    assert.equal(bar.style.transform, 'scaleX(0.65)');
    assert.equal(bar.attributes['aria-valuenow'], '65');
});

test('speed and aggregate progress APIs do not scan file queues', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/js/ui/progress.js'),
        'utf8');
    const speedFunction = source.slice(
        source.indexOf('updateCurrentSpeedDisplay('),
        source.indexOf('updateAggregateProgress('));
    const aggregateFunction = source.slice(
        source.indexOf('updateAggregateProgress('),
        source.indexOf('};', source.indexOf('updateAggregateProgress(')));

    assert.equal(speedFunction.includes('.filter('), false);
    assert.equal(speedFunction.includes('.reduce('), false);
    assert.equal(aggregateFunction.includes('.filter('), false);
    assert.equal(aggregateFunction.includes('.reduce('), false);
    assert.equal(speedFunction.includes('fileQueue'), false);
    assert.equal(aggregateFunction.includes('fileQueue'), false);
});

test('setFileProgress uses cached UI when meta object is provided', () => {
    const { tracker, document } = loadProgressTracker();

    const meta = {
        id: 'abc',
        ui: {
            progressBar: new MockElement(),
            progressText: new MockElement()
        }
    };

    document.getElementById = () => {
        throw new Error('setFileProgress should not query document when meta.ui exists');
    };

    tracker.setFileProgress(meta, 40, '40%');

    assert.equal(meta.ui.progressBar.style.transform, 'scaleX(0.4)');
    assert.equal(meta.ui.progressText.textContent, '40%');
    assert.equal(meta.ui.progressBar.attributes['aria-valuenow'], '40');
    assert.equal(meta.ui.progressBar.attributes['aria-valuetext'], '40%');
});

test('renderFileItem uses local icons and auto filename direction', () => {
    const { tracker } = loadProgressTracker();
    const parent = new MockElement();
    const meta = {
        id: 'mixed',
        name: 'מערכתשעות.pdf',
        size: 128
    };

    tracker.renderFileItem(meta, parent);

    const item = parent.children[0];
    const top = item.children[0];
    const left = top.children[0];
    const icon = left.children[0];
    const info = left.children[1];
    const name = info.children[0];

    assert.equal(icon.dataset.icon, 'file');
    assert.equal(name.attributes.dir, 'auto');
    assert.equal(name.textContent, 'מערכתשעות.pdf');
    assert.equal(meta.ui.icon, icon);
    assert.equal(meta.ui.progressBar.attributes.role, 'progressbar');
    assert.equal(meta.ui.progressBar.attributes['aria-label'].startsWith('Upload progress for '), true);
});

test('markFileQueued resets visual state for retries', () => {
    const { tracker } = loadProgressTracker();
    const container = new MockElement();
    const progressText = new MockElement();
    const progressBar = new MockElement();
    const icon = new MockElement();

    icon.className = 'file-icon file-icon-error';
    icon.dataset.icon = 'failed';

    const meta = {
        id: 'q1',
        ui: { container, progressText, progressBar, icon }
    };

    tracker.markFileQueued(meta, 'Queued');

    assert.equal(container.className, 'file-item uploading small');
    assert.equal(progressText.textContent, 'Queued');
    assert.equal(progressBar.style.transform, 'scaleX(0)');
    assert.equal(icon.className, 'file-icon');
    assert.equal(icon.dataset.icon, 'file');
});

test('createGroupContainer does not throw when progress container is unavailable', () => {
    const { tracker, document } = loadProgressTracker();
    tracker.elements = undefined;
    document.getElementById = () => null;

    const container = tracker.createGroupContainer(0, 10, 0);
    assert.ok(container);
    assert.equal(container.className, 'file-group-inner');
});

test('createGroupContainer uses a CSS chevron instead of visible icon text', () => {
    const { tracker, idMap } = loadProgressTracker();
    const progress = new MockElement();
    idMap.set('progress', progress);
    tracker.elements = undefined;

    const container = tracker.createGroupContainer(0, 10, 0);
    const details = progress.children[0];
    const summary = details.children[0];
    const title = summary.children[0];
    const chevron = summary.children[1];

    assert.ok(container);
    assert.equal(title.className, 'file-group-title');
    assert.equal(title.attributes.dir, 'auto');
    assert.equal(chevron.className, 'file-group-chevron');
    assert.equal(chevron.textContent, '');
    assert.equal(chevron.attributes['aria-hidden'], 'true');
    assert.equal(chevron.dataset.icon, 'chevron');
});
