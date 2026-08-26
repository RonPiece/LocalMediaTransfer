/**
 * Progress Tracker - File rendering and progress management
 */

window.ProgressTracker = {
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
        console.log('Progress tracker initialized');
    },

    // Render individual file item
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

        // Cache DOM references on meta for O(1) updates
        meta.ui = {
            container: item,
            progressBar: progressFill,
            progressText: progressText,
            icon: icon
        };

        parent.appendChild(item);
    },

    createGroupContainer(startIndex, endIndex, groupIndex) {
        const details = document.createElement('details');
        details.className = 'file-group';
        if (groupIndex === 0) details.open = true;

        const summary = document.createElement('summary');
        summary.className = 'file-group-summary';

        const textSpan = document.createElement('span');
        textSpan.className = 'file-group-title';
        textSpan.setAttribute('dir', 'auto');
        textSpan.textContent = window.I18n?.t('group.files', {
            start: startIndex + 1,
            end: endIndex,
            count: endIndex - startIndex
        }) || `Files ${startIndex + 1} - ${endIndex} (${endIndex - startIndex})`;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'file-group-chevron';
        iconSpan.setAttribute('aria-hidden', 'true');
        window.LocalIcons?.setIcon(iconSpan, 'chevron');

        summary.appendChild(textSpan);
        summary.appendChild(iconSpan);
        details.appendChild(summary);

        const container = document.createElement('div');
        container.className = 'file-group-inner';
        details.appendChild(container);

        const progressContainer = (this.elements && this.elements.progressContainer)
            || document.getElementById('progress');
        if (progressContainer) {
            progressContainer.appendChild(details);
        }
        return container;
    },

    resolveFileUI(fileRef) {
        if (fileRef && typeof fileRef === 'object' && fileRef.ui) {
            return fileRef.ui;
        }

        const fileId = (fileRef && typeof fileRef === 'object') ? fileRef.id : fileRef;
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
        const ui = this.resolveFileUI(fileRef);
        if (!ui || !ui.container) return;

        ui.container.className = 'file-item success small';
        if (ui.progressText) ui.progressText.textContent = text;
        if (ui.progressBar) {
            this.applyProgressTransform(ui.progressBar, 100);
            ui.progressBar.setAttribute('aria-valuetext', text);
        }

        if (ui.icon) {
            ui.icon.className = 'file-icon file-icon-success';
            window.LocalIcons?.setIcon(ui.icon, 'check');
        }
    },

    // Mark file as skipped
    markFileSkipped(fileRef, text) {
        const ui = this.resolveFileUI(fileRef);
        if (!ui || !ui.container) return;

        ui.container.className = 'file-item success small';
        if (ui.progressText) ui.progressText.textContent = text;
        if (ui.progressBar) {
            this.applyProgressTransform(ui.progressBar, 100);
            ui.progressBar.setAttribute('aria-valuetext', text);
        }

        if (ui.icon) {
            ui.icon.className = 'file-icon file-icon-success';
            window.LocalIcons?.setIcon(ui.icon, 'check');
        }
    },

    // Mark file as error
    markFileError(fileRef, text) {
        const ui = this.resolveFileUI(fileRef);
        if (!ui || !ui.container) return;

        ui.container.className = 'file-item error small';
        if (ui.progressText) ui.progressText.textContent = text;
        if (ui.progressBar) ui.progressBar.setAttribute('aria-valuetext', text);

        if (ui.icon) {
            ui.icon.className = 'file-icon file-icon-error';
            window.LocalIcons?.setIcon(ui.icon, 'failed');
        }
    },

    markFileQueued(fileRef, text = null) {
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

        if (ui.icon) {
            ui.icon.className = 'file-icon';
            window.LocalIcons?.setIcon(ui.icon, 'file');
        }
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
    updateCurrentSpeedDisplay(currentInstantSpeed, displaySpeedEMA, AGG_ALPHA) {
        const safeInstantSpeed = Number.isFinite(currentInstantSpeed) && currentInstantSpeed > 0
            ? currentInstantSpeed
            : 0;

        // Apply EMA smoothing for stable display
        let newSpeedEMA;
        if (safeInstantSpeed > 0) {
            newSpeedEMA = displaySpeedEMA * (1 - AGG_ALPHA) + safeInstantSpeed * AGG_ALPHA;
        } else {
            // Decay quickly to zero when there is no fresh progress.
            newSpeedEMA = displaySpeedEMA * 0.6;
            if (newSpeedEMA < 1) {
                newSpeedEMA = 0;
            }
        }

        const el = this.elements || {};
        const currentSpeedEl = el.currentSpeed || document.getElementById('currentSpeed');
        if (currentSpeedEl) {
            currentSpeedEl.textContent = window.I18n?.t('speed.current', {
                speed: window.Utils.formatSpeed(newSpeedEMA)
            }) || `Current upload: ${window.Utils.formatSpeed(newSpeedEMA)}`;
        }

        return newSpeedEMA;
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

console.log('📊 Progress tracker loaded');
