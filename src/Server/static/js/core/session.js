/** Browser lifecycle ownership. Transport modules register only requests they own. */
const lmtSession = {
    /** @type {'loading'|'ready'|'blocked'|'failed'} */
    state: 'loading',
    initialized: false,
    /** @type {Set<() => void>} */
    aborters: new Set(),

    update(state) {
        this.state = state;
        this.renderControls();
    },

    renderControls() {
        window.TransferView?.render();
    },

    showStartup(key, retry = false) {
        const panel = document.getElementById('startupStatus');
        const message = document.getElementById('startupMessage');
        const button = document.getElementById('startupRetry');
        if (panel) panel.hidden = !key;
        if (message) {
            message.dataset.i18n = key;
            const translated = window.I18n?.t(key);
            const fallback = key === 'startup.failed' ? 'The page could not load. Retry to refresh it.' : 'Connecting to receiver...';
            message.textContent = translated && translated !== key ? translated : fallback;
        }
        if (button) button.hidden = !retry;
    },

    authenticationLost() {
        if (this.state === 'blocked') return;
        window.SecurityManager.isValid = false;
        window.SecurityManager.failureReason = 'invalid';
        window.SecurityManager.clearBrowserAuthorization(window.SecurityManager.token);
        this.update('blocked');
        for (const abort of [...this.aborters]) abort();
        this.showStartup('startup.expired');
    },

    reset() {
        for (const abort of [...this.aborters]) abort();
        this.aborters.clear();
    }
};
window.TransferSession = lmtSession;

/** @param {string} url @param {RequestInit} options @param {number} timeoutMs */
async function lmtFetch(url, options, timeoutMs) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    lmtSession.aborters.add(abort);
    const timeout = setTimeout(abort, timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        // Consume the body within the same deadline (headers alone may arrive promptly).
        const text = await response.text();
        return { ok: response.ok, status: response.status, json: () => JSON.parse(text || '{}') };
    } finally {
        clearTimeout(timeout);
        lmtSession.aborters.delete(abort);
    }
}
window.lmtFetch = lmtFetch;

// Resource failures do not bubble, so capture script errors during startup.
window.addEventListener('error', event => {
    if (event.target instanceof HTMLScriptElement && !lmtSession.initialized) {
        lmtSession.update('failed');
        lmtSession.showStartup('startup.failed', true);
    }
}, true);

document.getElementById('startupRetry')?.addEventListener('click', async event => {
    event.preventDefault();
    if (!lmtSession.initialized || window.SecurityManager?.failureReason !== 'connection') {
        window.location.reload();
        return;
    }
    lmtSession.update('loading');
    lmtSession.showStartup('startup.loading');
    await window.SecurityManager.retry();
    lmtSession.update(window.SecurityManager.isValid ? 'ready' : 'blocked');
});
