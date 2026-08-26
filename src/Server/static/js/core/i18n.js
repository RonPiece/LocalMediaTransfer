/**
 * Small local i18n loader.
 * Detects Hebrew/Russian/English and falls back to English for everything else.
 */

window.I18n = {
    lang: 'en',
    dir: 'ltr',
    strings: {},

    supported: new Set(['en', 'he', 'ru']),
    languageMeta: {
        en: { code: 'EN', flag: '/static/i18n/flags-icons/gb-eng.svg' },
        he: { code: 'HE', flag: '/static/i18n/flags-icons/il.svg' },
        ru: { code: 'RU', flag: '/static/i18n/flags-icons/ru.svg' }
    },

    detectLanguage() {
        const candidates = [
            localStorage.getItem('lmt.language'),
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
        this.lang = this.supported.has(lang) ? lang : 'en';
        this.dir = this.lang === 'he' ? 'rtl' : 'ltr';

        try {
            const response = await fetch(`/static/i18n/${this.lang}.json?v=${window.LMT_FRONTEND_VERSION || '1'}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.strings = await response.json();
        } catch (error) {
            console.warn('Failed to load language file, falling back to English', error);
            this.lang = 'en';
            this.dir = 'ltr';
            const response = await fetch(`/static/i18n/en.json?v=${window.LMT_FRONTEND_VERSION || '1'}`);
            this.strings = response.ok ? await response.json() : {};
        }

        document.documentElement.lang = this.lang;
        document.documentElement.dir = this.dir;
        document.body?.setAttribute('dir', this.dir);
        document.title = this.t('app.title');
        this.apply(document);
        this.updateLanguageSwitcher();
        window.IOSTips?.refresh?.();
    },

    async setLanguage(lang) {
        const normalized = String(lang || '').toLowerCase().split('-')[0];
        if (!this.supported.has(normalized)) return;
        localStorage.setItem('lmt.language', normalized);
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

        root.querySelectorAll('[data-i18n-title]').forEach(element => {
            element.setAttribute(
                'title',
                this.t(element.getAttribute('data-i18n-title')));
        });
    },

    bindLanguageSwitcher() {
        document.querySelectorAll('[data-lang]').forEach(button => {
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
        const currentFlag = getElement('languageCurrentFlag');
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

        document.querySelectorAll('[data-lang]').forEach(button => {
            const active = button.dataset.lang === this.lang;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }
};

console.log('i18n loader available');
