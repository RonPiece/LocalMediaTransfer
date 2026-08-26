/**
 * Security Manager - Token handling and verification
 */

window.SecurityManager = {
    token: null,
    isValid: false,
    failureReason: null,
    _initPromise: null,

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this.initializeCredential();
        return this._initPromise;
    },

    async initializeCredential() {
        const urlParams = new URLSearchParams(window.location.search || '');
        const fragmentParams = new URLSearchParams(
            (window.location.hash || '').replace(/^#/, ''));
        const legacyToken = urlParams.get('token');
        const bootstrap = fragmentParams.get('bootstrap');
        this.clearCredentialFromAddressBar(urlParams);

        this.token = bootstrap
            ? await this.exchangeBootstrap(bootstrap)
            : legacyToken;

        if (!this.token) {
            this.failureReason = bootstrap ? 'invalid' : 'missing';
            console.error(bootstrap
                ? 'One-time browser link is invalid, expired, or already used'
                : 'Secure browser link is missing');
            this.showAccessError(this.failureReason);
            this.disableControls();
            return;
        }

        // Verify token with server
        const valid = await this.verifyTokenWithServer(this.token);
        if (!valid) {
            this.failureReason = 'invalid';
            console.error('Token rejected by server');
            this.showAccessError('invalid');
            this.disableControls();
            return;
        }

        this.failureReason = null;
        this.isValid = true;
        this.enableControls();
    },

    showAccessError(reason) {
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
            const response = await fetch('/exchange_bootstrap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                body: JSON.stringify({ bootstrap })
            });
            if (!response.ok) return null;
            const payload = await response.json();
            return typeof payload.token === 'string' && payload.token.length > 0
                ? payload.token
                : null;
        } catch (e) {
            console.warn('Bootstrap exchange failed');
            return null;
        }
    },

    async verifyTokenWithServer(token) {
        if (!token) return false;
        try {
            const resp = await fetch('/verify_token', {
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
            if (!resp.ok) return false;
            const j = await resp.json();
            return !!j.valid;
        } catch (e) {
            console.warn('Token verification failed:', e);
            return false;
        }
    },

    disableControls() {
        const uploadSection = document.getElementById('uploadSection') || document.body;
        uploadSection?.classList?.add('secure-locked');

        ['fileInput','chooseBtn','uploadBtn','resetBtn'].forEach(id => {
            const el = document.getElementById(id);
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
        const uploadSection = document.getElementById('uploadSection') || document.body;
        uploadSection?.classList?.remove('secure-locked');

        ['fileInput','chooseBtn','uploadBtn','resetBtn'].forEach(id => {
            const el = document.getElementById(id);
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
    }
};

console.log('🔐 Security manager loaded');
