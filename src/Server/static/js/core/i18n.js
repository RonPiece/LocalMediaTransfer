/**
 * Small local i18n loader.
 * Detects Hebrew/Russian/English and falls back to English for everything else.
 */

const lmtI18n = {
    lang: 'en',
    dir: 'ltr',
    strings: {},
    loadRevision: 0,
    REQUEST_TIMEOUT_MS: 10000,

    supported: new Set(['en', 'he', 'ru']),
    languageMeta: {
        en: { code: 'EN', flag: '/static/i18n/flags-icons/gb-eng.svg' },
        he: { code: 'HE', flag: '/static/i18n/flags-icons/il.svg' },
        ru: { code: 'RU', flag: '/static/i18n/flags-icons/ru.svg' }
    },

    detectLanguage() {
        let saved = '';
        try { saved = localStorage.getItem('lmt.language') || ''; } catch {}
        const candidates = [
            saved,
            ...(navigator.languages || []),
            navigator.language
        ].filter(Boolean);

        for (const candidate of candidates) {
            const normalized = String(candidate).toLowerCase().split('-')[0];
            if (this.supported.has(normalized)) {
                return normalized;
            }
        }

        return 'en';
    },

    async init() {
        await this.load(this.detectLanguage());
        this.bindLanguageSwitcher();
    },

    async load(lang) {
        const revision = ++this.loadRevision;
        let resolvedLanguage = this.supported.has(lang) ? lang : 'en';
        let strings = {};

        try {
            strings = await this.fetchStrings(resolvedLanguage);
        } catch (error) {
            console.warn('Local Media Transfer could not load the preferred language.');
            if (resolvedLanguage !== 'en') {
                try { strings = await this.fetchStrings('en'); } catch {}
            }
            resolvedLanguage = 'en';
        }

        // A slow earlier selection must not replace the user's latest language.
        if (revision !== this.loadRevision) return;
        this.lang = resolvedLanguage;
        this.dir = this.lang === 'he' ? 'rtl' : 'ltr';
        this.strings = strings;
        document.documentElement.lang = this.lang;
        document.documentElement.dir = this.dir;
        document.body?.setAttribute('dir', this.dir);
        document.title = this.t('app.title');
        const mobile = window.Utils?.isMobileLike?.();
        document.getElementById('uploadHeading')?.setAttribute('data-i18n', mobile ? 'upload.mobileHeading' : 'upload.heading');
        document.getElementById('uploadSub')?.setAttribute('data-i18n', mobile ? 'upload.mobileSub' : 'upload.sub');
        this.apply(document);
        this.updateLanguageSwitcher();
        window.ProgressTracker?.refreshLanguage?.();
        window.IOSTips?.refresh?.();
    },

    async fetchStrings(lang) {
        const response = await window.lmtFetch(
            `/static/i18n/${lang}.json?v=${window.LMT_FRONTEND_VERSION || '1'}`,
            {}, this.REQUEST_TIMEOUT_MS);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    },

    async setLanguage(lang) {
        const normalized = String(lang || '').toLowerCase().split('-')[0];
        if (!this.supported.has(normalized)) return;
        try { localStorage.setItem('lmt.language', normalized); } catch {}
        await this.load(normalized);
    },

    t(key, values = {}) {
        let text = this.strings[key] || key;
        for (const [name, value] of Object.entries(values)) {
            text = text.replaceAll(`{${name}}`, String(value));
        }
        return text;
    },

    apply(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(element => {
            element.textContent = this.t(element.getAttribute('data-i18n'));
        });

        root.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
            element.setAttribute(
                'aria-label',
                this.t(element.getAttribute('data-i18n-aria-label')));
        });

        root.querySelectorAll('[data-i18n-placeholder]').forEach(element => { element.setAttribute('placeholder', this.t(element.getAttribute('data-i18n-placeholder'))); });

        root.querySelectorAll('[data-i18n-title]').forEach(element => {
            element.setAttribute(
                'title',
                this.t(element.getAttribute('data-i18n-title')));
        });
    },

    bindLanguageSwitcher() {
        /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('button[data-lang]')).forEach(button => {
            if (button.dataset.boundLanguage === 'true') return;
            button.dataset.boundLanguage = 'true';
            button.addEventListener('click', () => {
                this.setLanguage(button.dataset.lang);
            });
        });

        const getElement = (id) =>
            typeof document.getElementById === 'function' ? document.getElementById(id) : null;
        const menuButton = getElement('languageMenuButton');
        const switcher = getElement('languageSwitcher');
        if (menuButton && switcher && menuButton.dataset.boundLanguageMenu !== 'true') {
            menuButton.dataset.boundLanguageMenu = 'true';
            const close = () => {
                switcher.classList.remove('open');
                menuButton.setAttribute('aria-expanded', 'false');
            };
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && switcher.classList.contains('open')) {
                    close(); menuButton.focus();
                }
            });
            document.addEventListener('click', event => {
                if (!switcher.contains(/** @type {Node} */ (event.target))) close();
            });
            menuButton.addEventListener('click', () => {
                const isOpen = switcher.classList.toggle('open');
                menuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });
        }
    },

    updateLanguageSwitcher() {
        const meta = this.languageMeta[this.lang] || this.languageMeta.en;
        const getElement = (id) =>
            typeof document.getElementById === 'function' ? document.getElementById(id) : null;
        const currentFlag = /** @type {HTMLImageElement} */ (getElement('languageCurrentFlag'));
        const currentCode = getElement('languageCurrentCode');
        const menuButton = getElement('languageMenuButton');
        const switcher = getElement('languageSwitcher');

        if (currentFlag) {
            currentFlag.src = meta.flag;
        }
        if (currentCode) {
            currentCode.textContent = meta.code;
        }
        if (switcher) {
            switcher.classList.remove('open');
        }
        if (menuButton) {
            menuButton.setAttribute('aria-expanded', 'false');
        }

        /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('button[data-lang]')).forEach(button => {
            const active = button.dataset.lang === this.lang;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }
};

window.I18n = lmtI18n;
