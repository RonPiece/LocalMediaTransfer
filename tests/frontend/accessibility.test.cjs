const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MockElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentElement = null;
        this.attributes = {};
        this.dataset = {};
        this.className = '';
        this.id = '';
        this.textContent = '';
        this.inert = false;
        this.isConnected = false;
        this.listeners = new Map();
    }

    appendChild(child) {
        child.parentElement = this;
        child.setConnected(this.isConnected);
        this.children.push(child);
        return child;
    }

    setConnected(value) {
        this.isConnected = value;
        for (const child of this.children) child.setConnected(value);
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }
        this.setConnected(false);
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    focus() { this.ownerDocument.activeElement = this; }

    descendants() {
        return this.children.flatMap(child => [child, ...child.descendants()]);
    }

    querySelectorAll(selector) {
        const descendants = this.descendants();
        if (selector === '[data-modal-action]') {
            return descendants.filter(element => element.dataset.modalAction);
        }
        if (selector.includes('button:not([disabled])')) {
            return descendants.filter(element => element.tagName === 'BUTTON' && !element.disabled);
        }
        return [];
    }

    querySelector(selector) {
        const descendants = this.descendants();
        if (selector.includes('.lmt-modal-button') || selector.includes('.lmt-modal-close')) {
            return descendants.find(element =>
                element.className.split(/\s+/).some(name =>
                    name === 'lmt-modal-button' || name === 'lmt-modal-close')) || null;
        }
        return null;
    }
}

function loadModals() {
    const listeners = new Map();
    const document = {
        activeElement: null,
        createElement(tagName) { return new MockElement(tagName, document); },
        getElementById(id) {
            return [document.body, ...document.body.descendants()]
                .find(element => element.id === id) || null;
        },
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (listeners.get(type) === listener) listeners.delete(type);
        }
    };
    document.body = new MockElement('body', document);
    document.body.setConnected(true);

    const context = { window: {}, document, console };
    vm.createContext(context);
    const scriptPath = path.resolve(__dirname, '../../src/Server/static/js/ui/modals.js');
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
    return { document, listeners, modals: context.window.Modals };
}

function keyEvent(key, shiftKey = false) {
    return {
        key,
        shiftKey,
        prevented: false,
        preventDefault() { this.prevented = true; }
    };
}

test('upload chooser uses a native keyboard control without a nested button role', () => {
    const html = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/index.html'),
        'utf8');
    const uploadZoneTag = html.match(/<div id="uploadZone"[^>]*>/)?.[0] || '';

    assert.equal(uploadZoneTag.includes('role="button"'), false);
    assert.equal(uploadZoneTag.includes('tabindex='), false);
    assert.match(html, /<button type="button" id="chooseBtn"/);
});

test('modal traps focus, isolates the background, and restores focus on close', () => {
    const { document, listeners, modals } = loadModals();
    const background = document.createElement('main');
    const invoker = document.createElement('button');
    background.appendChild(invoker);
    document.body.appendChild(background);
    invoker.focus();

    modals.showNoFilesModal();

    const overlay = document.getElementById('noFilesModal');
    const buttons = overlay.querySelectorAll('[data-modal-action]');
    assert.ok(overlay);
    assert.equal(background.inert, true);
    assert.equal(background.getAttribute('aria-hidden'), 'true');
    assert.equal(document.activeElement, buttons[0]);

    buttons.at(-1).focus();
    const forwardTab = keyEvent('Tab');
    listeners.get('keydown')(forwardTab);
    assert.equal(forwardTab.prevented, true);
    assert.equal(document.activeElement, buttons[0]);

    const reverseTab = keyEvent('Tab', true);
    listeners.get('keydown')(reverseTab);
    assert.equal(reverseTab.prevented, true);
    assert.equal(document.activeElement, buttons.at(-1));

    const escape = keyEvent('Escape');
    listeners.get('keydown')(escape);
    assert.equal(escape.prevented, true);
    assert.equal(document.getElementById('noFilesModal'), null);
    assert.equal(background.inert, false);
    assert.equal(background.hasAttribute('aria-hidden'), false);
    assert.equal(document.activeElement, invoker);
});

test('stylesheet honors the reduced-motion preference', () => {
    const css = fs.readFileSync(
        path.resolve(__dirname, '../../src/Server/static/style.css'),
        'utf8');
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    assert.notEqual(start, -1);
    const reducedMotion = css.slice(start, css.indexOf('\n}', start) + 2);

    assert.match(reducedMotion, /animation-duration:\s*0\.01ms\s*!important/);
    assert.match(reducedMotion, /animation-iteration-count:\s*1\s*!important/);
    assert.match(reducedMotion, /transition-duration:\s*0\.01ms\s*!important/);
});
