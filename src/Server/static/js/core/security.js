/**
 * Security Manager - Token handling and verification
 */

const lmtSecurity = {
    /** @type {string|null} */
    token: null,
    isValid: false,
    /** @type {'connection'|'invalid'|'missing'|null} */
    failureReason: null,
    _initPromise: null,
    storageKey: 'lmt.browser.authorization.v1',
    AUTH_TIMEOUT_MS: 10000,

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this.initializeCredential();
        return this._initPromise;
    },

    async retry() {
        this._initPromise = null;
        this.isValid = false;
        await this.init();
        if (this.isValid) window.TransferSession?.showStartup('');
    },

    async request(url, options) {
        // Kept local so legacy consumers also get bounded authentication requests.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.AUTH_TIMEOUT_MS);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            const payload = response.ok ? await response.json() : {};
            return { ok: response.ok, status: response.status, payload };
        } finally { clearTimeout(timeout); }
    },

    async initializeCredential() {
        const urlParams = new URLSearchParams(window.location.search || '');
        const fragmentParams = new URLSearchParams(
            (window.location.hash || '').replace(/^#/, ''));
        const legacyToken = urlParams.get('token');
        const bootstrap = fragmentParams.get('bootstrap');
        this.clearCredentialFromAddressBar(urlParams);

        this.failureReason = null;
        this.token = bootstrap
            ? await this.exchangeBootstrap(bootstrap)
            : this.token || legacyToken || this.restoreBrowserAuthorization();

        if (!this.token) {
            this.failureReason = this.failureReason || (bootstrap ? 'invalid' : 'missing');
            this.showAccessError(this.failureReason);
            this.disableControls();
            return;
        }

        // Verify token with server
        const valid = await this.verifyTokenWithServer(this.token);
        if (!valid) {
            this.failureReason = this.failureReason || 'invalid';
            this.showAccessError(this.failureReason);
            this.disableControls();
            return;
        }

        this.failureReason = null;
        this.isValid = true;
        this.enableControls();
    },

    showAccessError(reason) {
        window.TransferSession?.showStartup(reason === 'connection' ? 'startup.connection' : reason === 'invalid' ? 'startup.expired' : 'startup.missing', reason === 'connection');
        if (reason === 'connection') return;
        const invalid = reason === 'invalid';
        window.Modals.showTokenModal({
            titleKey: invalid ? 'modal.invalidTokenTitle' : 'modal.securityTitle',
            messageKey: invalid ? 'modal.invalidToken' : 'modal.noToken'
        });
    },

    clearCredentialFromAddressBar(urlParams) {
        try {
            urlParams.delete('token');
            const query = urlParams.toString();
            const cleanUrl = (window.location.pathname || '/') +
                (query ? `?${query}` : '');
            window.history?.replaceState?.({}, document.title || '', cleanUrl);
        } catch (e) {}
    },

    async exchangeBootstrap(bootstrap) {
        if (!/^[a-f0-9]{64}$/.test(bootstrap || '')) return null;
        try {
            const response = await this.request('/exchange_bootstrap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                body: JSON.stringify({ bootstrap })
            });
            if (!response.ok) return null;
            const payload = response.payload;
            if (typeof payload.token !== 'string' || payload.token.length === 0)
                return null;
            this.persistBrowserAuthorization(payload.token);
            return payload.token;
        } catch (e) {
            this.failureReason = 'connection';
            return null;
        }
    },

    restoreBrowserAuthorization() {
        try {
            return typeof localStorage === 'undefined'
                ? null
                : localStorage.getItem(this.storageKey);
        } catch (e) {
            return null;
        }
    },

    persistBrowserAuthorization(token) {
        try {
            if (typeof localStorage !== 'undefined')
                localStorage.setItem(this.storageKey, token);
        } catch (e) {
        }
    },

    clearBrowserAuthorization(expectedToken) {
        try {
            if (typeof localStorage === 'undefined') return;
            const stored = localStorage.getItem(this.storageKey);
            if (!expectedToken || stored === expectedToken)
                localStorage.removeItem(this.storageKey);
        } catch (e) {}
    },

    async verifyTokenWithServer(token) {
        if (!token) return false;
        try {
            const resp = await this.request('/verify_token', {
                method: 'POST',
                cache: 'no-store',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Upload-Token': token
                },
                body: JSON.stringify({})
            });
            if (!resp.ok) {
                if (resp.status === 401 || resp.status === 403) {
                    this.failureReason = 'invalid';
                    this.clearBrowserAuthorization(token);
                } else { this.failureReason = 'connection'; }
                return false;
            }
            const j = resp.payload;
            if (j.valid === false) this.clearBrowserAuthorization(token);
            return j.valid === true;
        } catch (e) {
            this.failureReason = 'connection';
            return false;
        }
    },

    disableControls() {
        const uploadSection = document.getElementById('uploadSection') || document.body;
        uploadSection?.classList?.add('secure-locked');

        ['fileInput','chooseBtn','uploadBtn','resetBtn'].forEach(id => {
            const el = /** @type {HTMLButtonElement | HTMLInputElement} */ (document.getElementById(id));
            if (!el) return;
            try {
                el.disabled = true;
                el.setAttribute('aria-disabled', 'true');
                el.title = window.I18n?.t('security.disabledTitle') ||
                    'Disabled: secure token missing or invalid';
                el.setAttribute('data-i18n-title', 'security.disabledTitle');
            } catch (e) {}
        });

        // Add warning banner
        if (!document.getElementById('tokenBanner')) {
            const banner = document.createElement('div');
            banner.id = 'tokenBanner';
            banner.className = 'token-warning-banner';
            banner.setAttribute('data-i18n', 'security.lockedBanner');
            banner.textContent = window.I18n?.t('security.lockedBanner') ||
                'Uploads disabled: valid session token missing or rejected by server. Use the secure link / QR code provided by the host.';
            uploadSection.insertBefore(banner, uploadSection.firstChild);
        }
    },

    enableControls() {
        if (window.TransferSession && !window.TransferSession.initialized) return;
        const uploadSection = document.getElementById('uploadSection') || document.body;
        uploadSection?.classList?.remove('secure-locked');

        ['fileInput','chooseBtn','uploadBtn','resetBtn'].forEach(id => {
            const el = /** @type {HTMLButtonElement | HTMLInputElement} */ (document.getElementById(id));
            if (!el) return;
            try {
                el.disabled = false;
                el.removeAttribute('aria-disabled');
                el.removeAttribute('data-i18n-title');
                el.title = '';
            } catch (e) {}
        });
        const banner = document.getElementById('tokenBanner');
        if (banner) banner.remove();
        window.TransferSession?.renderControls();
    }
};

window.SecurityManager = lmtSecurity;
