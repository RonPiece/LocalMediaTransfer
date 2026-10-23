/**
 * Progress Tracker - File rendering and progress management
 */

const lmtProgress = {
    /** @type {Map<string, FileUI>} */
    rows: new Map(),

    refreshLanguage() {
        for (const file of window.FileListView?.files || []) {
            const row = this.rows.get(file.id);
            if (row && file.presentation.labelKey) row.progressText.textContent = window.I18n.t(file.presentation.labelKey, file.presentation.labelValues || {});
        }
        void window.FileListView?.render();
        window.TransferView?.render();
    },
    reset() { this.rows.clear(); },

    remember(fileRef, patch) {
        if (fileRef && typeof fileRef === 'object') {
            fileRef.presentation = { percent: 0, text: '', state: 'queued', ...fileRef.presentation, ...patch };
        }
    },
    applyProgressTransform(progressBar, percent) {
        if (!progressBar) return;

        const normalizedPercent = Number.isFinite(Number(percent))
            ? Math.max(0, Math.min(100, Number(percent)))
            : 0;
        const scale = normalizedPercent / 100;
        progressBar.style.transform = `scaleX(${scale})`;
        progressBar.setAttribute('role', 'progressbar');
        progressBar.setAttribute('aria-valuemin', '0');
        progressBar.setAttribute('aria-valuemax', '100');
        progressBar.setAttribute('aria-valuenow', String(Math.round(normalizedPercent)));
    },

    init() {
        // Cache frequently-accessed DOM elements to avoid repeated queries
        this.elements = {
            statsRow: document.getElementById('statsRow'),
            successCount: document.getElementById('successCount'),
            errorCount: document.getElementById('errorCount'),
            totalSize: document.getElementById('totalSize'),
            selectedCount: document.getElementById('selectedCount'),
            currentSpeed: document.getElementById('currentSpeed'),
            progressContainer: document.getElementById('progress'),
            aggregateProgress: document.getElementById('aggregateProgress'),
            aggregateProgressBar: document.getElementById('aggregateProgressBar')
        };
    },

    // Render individual file item
    /** @param {TransferFile} meta @param {Node} parent */
    renderFileItem(meta, parent) {
        const item = document.createElement('div');
        item.className = 'file-item uploading small';
        item.id = `file-${meta.id}`;

        const top = document.createElement('div');
        top.className = 'file-item-top';

        const left = document.createElement('div');
        left.className = 'file-item-main';

        const icon = document.createElement('div');
        icon.className = 'file-icon';
        window.LocalIcons?.setIcon(icon, 'file');

        const info = document.createElement('div');
        info.className = 'file-info';

        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = meta.name;
        name.setAttribute('dir', 'auto');

        const size = document.createElement('div');
        size.className = 'file-size';
        size.textContent = window.Utils.formatBytes(meta.size);

        info.appendChild(name);
        info.appendChild(size);
        left.appendChild(icon);
        left.appendChild(info);

        const right = document.createElement('div');
        right.className = 'file-status';

        const progressText = document.createElement('div');
        progressText.className = 'progress-text';
        progressText.textContent = window.I18n?.t('file.queued') || 'Queued';

        right.appendChild(progressText);
        top.appendChild(left);
        top.appendChild(right);

        const progressWrap = document.createElement('div');
        progressWrap.style.marginTop = '0.5rem';

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-modern';
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-bar-modern';
        progressFill.setAttribute(
            'aria-label',
            window.I18n?.t('progress.fileAria', { name: meta.name }) || `Upload progress for ${meta.name}`);
        this.applyProgressTransform(progressFill, 0);
        progressBar.appendChild(progressFill);
        progressWrap.appendChild(progressBar);

        item.appendChild(top);
        item.appendChild(progressWrap);

        // The renderer owns mounted DOM references; domain files never retain them.
        const row = {
            container: item,
            progressBar: progressFill,
            progressText: progressText,
            icon: icon
        };

        this.rows.set(meta.id, row);
        if (meta.file) window.MediaPreviews?.bind(icon, meta);
        parent.appendChild(item);
        this.renderSnapshot(meta);
    },

    /** Render domain presentation without changing transfer state. @param {TransferFile} file */
    renderSnapshot(file) {
        const ui = this.rows.get(file.id);
        if (!ui) return;
        this.applySnapshot(ui, file);
    },

    /** Shared presentation for paged rows and recent activity.
     * @param {FileUI} ui @param {FileSnapshot} file */
    applySnapshot(ui, file) {
        const snapshot = file.presentation;
        if (!snapshot) return;
        const text = snapshot.labelKey ? window.I18n.t(snapshot.labelKey, snapshot.labelValues || {}) : snapshot.text;
        ui.container.classList.toggle('error', snapshot.state === 'error');
        ui.container.classList.toggle('success', ['success', 'skipped'].includes(snapshot.state));
        ui.container.classList.toggle('uploading', !['success', 'skipped', 'error'].includes(snapshot.state));
        ui.progressText.textContent = text;
        this.applyProgressTransform(ui.progressBar, snapshot.percent);
        ui.progressBar.setAttribute('aria-valuetext', text);
    },

    resolveFileUI(fileRef) {
        if (fileRef && typeof fileRef === 'object') return this.rows.get(fileRef.id) || fileRef.ui || null;

        const fileId = fileRef;
        if (!fileId) return null;

        const item = document.getElementById(`file-${fileId}`);
        if (!item) return null;

        return {
            container: item,
            progressBar: item.querySelector('.progress-bar-modern'),
            progressText: item.querySelector('.progress-text'),
            icon: item.querySelector('.file-icon')
        };
    },

    // Set progress for specific file
    setFileProgress(fileRef, percent, text) {
        this.remember(fileRef, { percent, text, ...(/^\d+%$/.test(text || '') ? { labelKey: '' } : {}) });
        const ui = this.resolveFileUI(fileRef);
        if (!ui) return;

        const normalizedPercent = Number.isFinite(Number(percent))
            ? Math.max(0, Math.min(100, Number(percent)))
            : 0;
        if (ui.progressBar) {
            this.applyProgressTransform(ui.progressBar, normalizedPercent);
            ui.progressBar.setAttribute('aria-valuetext', text || `${Math.round(normalizedPercent)}%`);
        }
        if (ui.progressText) ui.progressText.textContent = text;
    },

    // Mark file as successful
    markFileSuccess(fileRef, text) {
        this.markFileCompleted(fileRef, text, 'success', 'file.done', 'file.savedAs');
    },

    // Mark file as skipped
    markFileSkipped(fileRef, text) {
        this.markFileCompleted(fileRef, text, 'skipped', 'file.skipped', 'file.existingAs');
    },

    /** Shared success presentation for uploaded and verified duplicate files.
     * @param {TransferFile|string} fileRef
     * @param {string} text
     * @param {'success'|'skipped'} state
     * @param {string} defaultLabel
     * @param {string} renamedLabel
     */
    markFileCompleted(fileRef, text, state, defaultLabel, renamedLabel) {
        const savedName = typeof fileRef === 'object' ? fileRef.serverResult?.filename : null;
        const renamed = savedName && typeof fileRef === 'object' && savedName !== fileRef.name;
        this.remember(fileRef, {
            state,
            text,
            percent: 100,
            labelKey: renamed ? renamedLabel : defaultLabel,
            labelValues: savedName ? { name: savedName } : {}
        });
        const ui = this.resolveFileUI(fileRef);
        if (!ui || !ui.container) return;

        ui.container.className = 'file-item success small';
        if (ui.progressText) ui.progressText.textContent = text;
        if (ui.progressBar) {
            this.applyProgressTransform(ui.progressBar, 100);
            ui.progressBar.setAttribute('aria-valuetext', text);
        }


    },

    // Mark file as error
    markFileError(fileRef, text) {
        this.remember(fileRef, { state: 'error', text, labelKey: '' });
        const ui = this.resolveFileUI(fileRef);
        if (!ui || !ui.container) return;

        ui.container.className = 'file-item error small';
        if (ui.progressText) ui.progressText.textContent = text;
        if (ui.progressBar) ui.progressBar.setAttribute('aria-valuetext', text);


    },

    markFileQueued(fileRef, text = null, labelKey = 'file.queued') {
        this.remember(fileRef, { state: 'queued', percent: 0, text, labelKey });
        const ui = this.resolveFileUI(fileRef);
        if (!ui || !ui.container) return;

        ui.container.className = 'file-item uploading small';
        if (ui.progressText) ui.progressText.textContent = text || window.I18n?.t('file.queued') || 'Queued';
        if (ui.progressBar) {
            ui.progressBar.setAttribute(
                'aria-valuetext',
                text || window.I18n?.t('file.queued') || 'Queued');
        }
        this.applyProgressTransform(ui.progressBar, 0);


    },

    // Update statistics UI using cached elements
    updateStatsUI(fileQueue, successCount, errorCount, totalBytes) {
        const el = this.elements || {};
        const statsRow = el.statsRow || document.getElementById('statsRow');
        const successCountEl = el.successCount || document.getElementById('successCount');
        const errorCountEl = el.errorCount || document.getElementById('errorCount');
        const totalSizeEl = el.totalSize || document.getElementById('totalSize');
        const selectedCountEl = el.selectedCount || document.getElementById('selectedCount');

        if (statsRow) {
            statsRow.style.display = (fileQueue.length || successCount || errorCount) ? 'grid' : 'none';
        }
        if (successCountEl) successCountEl.textContent = String(successCount);
        if (errorCountEl) errorCountEl.textContent = String(errorCount);
        if (totalSizeEl) totalSizeEl.textContent = window.Utils.formatBytes(totalBytes);
        if (selectedCountEl) selectedCountEl.textContent = String(fileQueue.length);
    },

    // Update current speed display
    updateCurrentSpeedDisplay(currentInstantSpeed) {
        const safeInstantSpeed = Number.isFinite(currentInstantSpeed) && currentInstantSpeed > 0
            ? currentInstantSpeed
            : 0;

        const el = this.elements || {};
        const currentSpeedEl = el.currentSpeed || document.getElementById('currentSpeed');
        if (currentSpeedEl) {
            currentSpeedEl.textContent = window.I18n?.t('speed.current', {
                speed: window.Utils.formatSpeed(safeInstantSpeed)
            }) || `Current upload: ${window.Utils.formatSpeed(safeInstantSpeed)}`;
        }

        return safeInstantSpeed;
    },

    updateAggregateProgress(completedBytes, totalBytes) {
        const el = this.elements || {};
        const aggregateWrap = el.aggregateProgress || document.getElementById('aggregateProgress');
        const aggregateBar = el.aggregateProgressBar || document.getElementById('aggregateProgressBar');
        if (!aggregateWrap || !aggregateBar) {
            return;
        }

        const safeTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0
            ? totalBytes
            : 0;

        if (!safeTotalBytes || safeTotalBytes <= 0) {
            aggregateWrap.style.display = 'none';
            this.applyProgressTransform(aggregateBar, 0);
            return;
        }

        const safeCompletedBytes = Number.isFinite(completedBytes) && completedBytes > 0
            ? Math.min(completedBytes, safeTotalBytes)
            : 0;
        const percent = Math.max(0, Math.min(100, Math.round((safeCompletedBytes / safeTotalBytes) * 100)));
        aggregateWrap.style.display = 'block';
        this.applyProgressTransform(aggregateBar, percent);
    }
};

window.ProgressTracker = lmtProgress;
