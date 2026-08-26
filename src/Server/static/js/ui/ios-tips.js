/**
 * iOS Tips - Platform-specific upload guidance.
 */

window.IOSTips = {
    init() {
        this.checkAndShowIOSTips();
    },

    isIOS() {
        return window.Utils?.isIOSLike?.() || false;
    },

    isSafari() {
        const ua = navigator.userAgent || '';
        return /Safari/.test(ua) && !/Chrome|CriOS|Android/.test(ua);
    },

    checkAndShowIOSTips() {
        const tipPanel = document.getElementById('iosTipAccordion');
        const tipText = document.getElementById('ios-upload-tip-text');

        if (!this.isIOS()) {
            if (tipPanel) {
                tipPanel.style.display = 'none';
            }
            return;
        }

        this.renderTipText(tipText);

        if (!tipPanel) return;

        tipPanel.style.display = '';
        tipPanel.setAttribute('aria-hidden', 'false');

        const collapseEl = document.getElementById('iosTipCollapse');
        const button = document.getElementById('iosTipButton');

        if (collapseEl) {
            collapseEl.classList.add('show');
        }

        if (button && collapseEl && !button.dataset.boundToggle) {
            button.dataset.boundToggle = 'true';
            button.setAttribute('aria-expanded', 'true');
            button.addEventListener('click', () => {
                const expanded = button.getAttribute('aria-expanded') === 'true';
                button.setAttribute('aria-expanded', String(!expanded));
                collapseEl.classList.toggle('show', !expanded);
            });
        }
    },

    refresh() {
        if (!this.isIOS()) return;
        this.renderTipText(document.getElementById('ios-upload-tip-text'));
    },

    renderTipText(container) {
        if (!container) return;

        container.textContent = '';
        container.dir = window.I18n?.dir || 'ltr';
        const fragment = document.createDocumentFragment();

        const cards = [
            {
                warning: true,
                title: 'tips.slowTitle',
                items: ['tips.slowCompressed', 'tips.slowProcessing', 'tips.slowCrash']
            },
            {
                title: 'tips.filesTitle',
                intro: 'tips.filesIntro',
                items: ['tips.filesNoConversion', 'tips.filesBatch', 'tips.filesTypes']
            },
            {
                title: 'tips.browserTitle',
                items: ['tips.browserChrome', 'tips.browserSafari']
            }
        ];

        for (const card of cards) {
            const cardElement = document.createElement('div');
            cardElement.className = card.warning ? 'tip-card tip-card-warning' : 'tip-card';

            const title = document.createElement('h5');
            title.textContent = window.I18n?.t(card.title) || card.title;
            cardElement.appendChild(title);

            if (card.intro) {
                const intro = document.createElement('p');
                intro.textContent = window.I18n?.t(card.intro) || card.intro;
                cardElement.appendChild(intro);
            }

            const list = document.createElement('ul');
            for (const key of card.items) {
                const item = document.createElement('li');
                item.textContent = window.I18n?.t(key) || key;
                list.appendChild(item);
            }
            cardElement.appendChild(list);
            fragment.appendChild(cardElement);
        }

        container.appendChild(fragment);
    }
};

console.log('iOS tips loaded');
