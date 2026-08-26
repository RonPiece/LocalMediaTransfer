/**
 * Accessible, dependency-free modal dialogs.
 * All content is created with DOM APIs to avoid HTML injection risks.
 */

(function initModals() {
    'use strict';

    const allowedActions = new Set([
        'close',
        'add-more',
        'reset-start',
        'reset-upload'
    ]);

    function t(key, fallback, values = {}) {
        const translated = window.I18n?.t(key, values);
        return translated && translated !== key ? translated : fallback;
    }

    function appendText(parent, tag, text, className = '', i18nKey = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (i18nKey) element.setAttribute('data-i18n', i18nKey);
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function appendList(parent, items) {
        const list = document.createElement('ul');
        for (const itemText of items) {
            appendText(list, 'li', itemText);
        }
        parent.appendChild(list);
        return list;
    }

    function appendSummaryRow(list, label, value) {
        const row = document.createElement('div');
        appendText(row, 'dt', label);
        appendText(row, 'dd', value);
        list.appendChild(row);
    }

    function runAction(action) {
        if (action === 'add-more') window.addMoreFiles?.();
        if (action === 'reset-start') window.resetAndStart?.();
        if (action === 'reset-upload') window.resetForNewUpload?.();
    }

    function getFocusableElements(dialog) {
        return Array.from(dialog.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    }

    window.Modals = {
        showDialog({
            id,
            title,
            titleKey = '',
            bodyBuilder,
            tone = 'success',
            actions = [{ label: t('modal.done', 'Done'), action: 'close', primary: true }]
        }) {
            if (!id || document.getElementById(id)) return;

            const previouslyFocused = document.activeElement;

            const overlay = document.createElement('div');
            overlay.id = id;
            overlay.className = 'lmt-modal-overlay';
            overlay.setAttribute('role', 'presentation');

            const dialog = document.createElement('section');
            dialog.className = 'lmt-modal';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', `${id}-title`);

            const header = document.createElement('header');
            header.className = 'lmt-modal-header';

            const titleElement = appendText(
                header,
                'h2',
                title,
                `lmt-modal-title ${tone}`,
                titleKey);
            titleElement.id = `${id}-title`;

            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'lmt-modal-close';
            closeButton.dataset.modalAction = 'close';
            closeButton.setAttribute('aria-label', t('modal.close', 'Close'));
            closeButton.setAttribute('data-i18n-aria-label', 'modal.close');
            closeButton.textContent = 'x';
            header.appendChild(closeButton);

            const body = document.createElement('div');
            body.className = 'lmt-modal-body';
            if (typeof bodyBuilder === 'function') {
                bodyBuilder(body);
            }

            const footer = document.createElement('footer');
            footer.className = 'lmt-modal-actions';
            for (const action of actions) {
                const actionName = allowedActions.has(action.action) ? action.action : 'close';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `lmt-modal-button ${action.primary ? 'primary' : 'secondary'}`;
                button.dataset.modalAction = actionName;
                button.textContent = action.label;
                if (action.labelKey) {
                    button.setAttribute('data-i18n', action.labelKey);
                }
                footer.appendChild(button);
            }

            dialog.appendChild(header);
            dialog.appendChild(body);
            dialog.appendChild(footer);
            overlay.appendChild(dialog);

            const backgroundElements = Array.from(document.body.children)
                .filter(element => element !== overlay);
            const backgroundState = backgroundElements.map(element => ({
                element,
                hadAriaHidden: element.hasAttribute('aria-hidden'),
                ariaHidden: element.getAttribute('aria-hidden'),
                inert: element.inert
            }));

            const restoreBackground = () => {
                for (const state of backgroundState) {
                    state.element.inert = state.inert;
                    if (state.hadAriaHidden) {
                        state.element.setAttribute('aria-hidden', state.ariaHidden);
                    } else {
                        state.element.removeAttribute('aria-hidden');
                    }
                }
            };

            const close = () => {
                document.removeEventListener('keydown', onKeyDown);
                overlay.remove();
                restoreBackground();
                if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
                    previouslyFocused.focus();
                }
            };

            const onKeyDown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    close();
                    return;
                }

                if (event.key !== 'Tab') return;

                const focusable = getFocusableElements(dialog);
                if (focusable.length === 0) {
                    event.preventDefault();
                    dialog.focus();
                    return;
                }

                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            };

            overlay.addEventListener('click', event => {
                if (event.target === overlay) close();
            });

            overlay.querySelectorAll('[data-modal-action]').forEach(button => {
                button.addEventListener('click', () => {
                    const action = button.getAttribute('data-modal-action');
                    close();
                    runAction(action);
                });
            });

            document.body.appendChild(overlay);
            for (const element of backgroundElements) {
                element.inert = true;
                element.setAttribute('aria-hidden', 'true');
            }
            document.addEventListener('keydown', onKeyDown);
            overlay.querySelector('.lmt-modal-button, .lmt-modal-close')?.focus();
        },

        showTokenModal({
            title,
            message,
            titleKey = 'modal.securityTitle',
            messageKey = 'modal.securityDefault',
            btnText
        } = {}) {
            const invalid = titleKey === 'modal.invalidTokenTitle';
            const resolvedTitle = title || t(
                titleKey,
                invalid ? 'Link expired or already used' : 'Secure link required');
            const resolvedMessage = message || t(
                messageKey,
                invalid
                    ? 'This one-time link is invalid, expired, or has already been used. Create a new link in Local Media Transfer on Windows and open it again.'
                    : 'This page was opened without a valid one-time access link. Open it again from Local Media Transfer on Windows.');
            const resolvedButtonText = btnText || t('modal.close', 'Close');
            this.showDialog({
                id: 'tokenModal',
                title: resolvedTitle,
                titleKey: title ? '' : titleKey,
                tone: 'error',
                bodyBuilder(body) {
                    appendText(
                        body,
                        'p',
                        resolvedMessage,
                        '',
                        message ? '' : messageKey);
                    appendText(
                        body,
                        'p',
                        t('modal.securityNote', 'Upload actions remain disabled until a valid link is used.'),
                        'lmt-modal-note',
                        'modal.securityNote');
                },
                actions: [{
                    label: resolvedButtonText,
                    labelKey: btnText ? '' : 'modal.close',
                    action: 'close',
                    primary: true
                }]
            });
        },

        showNoFilesModal() {
            this.showDialog({
                id: 'noFilesModal',
                title: t('modal.noFilesTitle', 'No Files Selected'),
                bodyBuilder(body) {
                    appendText(body, 'p', t('modal.noFilesBody', 'Select files before starting an upload.'));
                    appendList(body, [
                        t('modal.noFilesPhone', 'Use Choose Files on a phone or tablet.'),
                        t('modal.noFilesDesktop', 'Drag files into the upload area on a desktop.')
                    ]);
                }
            });
        },

        showAlreadyUploadedModal() {
            this.showDialog({
                id: 'alreadyUploadedModal',
                title: t('modal.alreadyTitle', 'Files Already Processed'),
                bodyBuilder(body) {
                    appendText(
                        body,
                        'p',
                        t('modal.alreadyBody', 'All files in this list have already been processed.'));
                },
                actions: [
                    { label: t('modal.addMore', 'Add More Files'), action: 'add-more' },
                    { label: t('modal.resetStart', 'Reset and Start Over'), action: 'reset-start', primary: true }
                ]
            });
        },

        showUploadCompleteModal(processedCount, skippedCount = 0, totalDurationMs = null) {
            const uploadedCount = Math.max(0, processedCount - skippedCount);
            const durationSeconds = Number.isFinite(totalDurationMs)
                ? Math.max(0, totalDurationMs / 1000)
                : null;

            this.showDialog({
                id: 'uploadCompleteModal',
                title: t('modal.completeTitle', 'Transfer Complete'),
                bodyBuilder(body) {
                    appendText(body, 'div', '✓', 'lmt-complete-mark')
                        .setAttribute('aria-hidden', 'true');
                    appendText(
                        body,
                        'p',
                        t(
                            'modal.completeFiles',
                            `${processedCount} file${processedCount === 1 ? '' : 's'} processed successfully.`,
                            {
                                count: processedCount,
                                plural: processedCount === 1 ? '' : 's'
                            }));

                    const list = document.createElement('dl');
                    list.className = 'lmt-summary-list';
                    appendSummaryRow(list, t('modal.uploaded', 'Uploaded'), String(uploadedCount));
                    appendSummaryRow(list, t('modal.alreadyExisted', 'Already existed'), String(skippedCount));
                    if (durationSeconds !== null) {
                        appendSummaryRow(
                            list,
                            t('modal.totalTime', 'Total time'),
                            window.Utils?.formatTime?.(durationSeconds) || `${Math.round(durationSeconds)}s`);
                    }
                    body.appendChild(list);
                },
                actions: [
                    { label: t('modal.uploadMore', 'Upload More'), action: 'reset-upload' },
                    { label: t('modal.done', 'Done'), action: 'close', primary: true }
                ]
            });
        }
    };
})();

console.log('UI modals loaded');
