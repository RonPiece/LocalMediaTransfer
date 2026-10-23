/** Page controls and persistent results. The controller owns all transfer state. */
const lmtTransferView = {
    /** @type {number | undefined} */
    activityTimer: undefined,
    activityFileId: '',
    /** Coalesce all file events; callbacks read the current controller snapshot. */
    scheduleActivity() {
        if (this.activityTimer !== undefined) return;
        this.activityTimer = setTimeout(() => {
            this.activityTimer = undefined;
            this.renderActivity(window.UploadManager.getSnapshot());
        }, 500);
    },
    resetActivity() {
        clearTimeout(this.activityTimer);
        this.activityTimer = undefined;
        const icon = document.getElementById('activityPreview');
        if (icon) window.MediaPreviews?.unbind(icon);
        this.activityFileId = '';
    },
    /** A single stable slot, independent of the paged list and its row bindings.
     * @param {Readonly<TransferRunSnapshot>} snapshot */
    renderActivity(snapshot) {
        const container = document.getElementById('activityRow');
        const icon = document.getElementById('activityPreview');
        const name = document.getElementById('activityName');
        const size = document.getElementById('activitySize');
        const progressText = document.getElementById('activityStatus');
        const progressBar = document.getElementById('activityProgress');
        const state = document.getElementById('activityState');
        const button = /** @type {HTMLButtonElement | null} */ (document.getElementById('activityViewFiles'));
        if (!container || !icon || !name || !size || !progressText || !progressBar || !state) return;
        if (button) button.disabled = snapshot.selectedFiles === 0;
        const stateKey = snapshot.selectionPending ? 'activity.reading'
            : snapshot.active ? (snapshot.phase === 'checking' ? 'activity.checking'
                : snapshot.activeFiles ? 'activity.active' : snapshot.phase === 'verifying' ? 'activity.finishing' : 'activity.starting')
            : snapshot.summary ? (snapshot.summary.outcome === 'blocked' || snapshot.summary.outcome === 'failed' ? 'activity.stopped' : 'activity.finished')
            : snapshot.selectedFiles ? 'activity.ready' : 'activity.idle';
        state.textContent = window.I18n.t(stateKey, { count: snapshot.activeFiles });
        const file = snapshot.activity;
        if (!file) {
            if (this.activityFileId) {
                window.MediaPreviews?.unbind(icon);
                this.activityFileId = '';
            }
            window.LocalIcons.setIcon(icon, 'file');
            icon.removeAttribute('data-kind');
            container.classList.remove('success', 'error', 'uploading');
            container.removeAttribute('data-file-id');
            name.textContent = window.I18n.t('activity.emptyName');
            name.removeAttribute('title');
            size.textContent = '\u00a0';
            progressText.textContent = window.I18n.t(snapshot.active ? stateKey : 'activity.empty');
            progressBar.setAttribute('aria-label', window.I18n.t('activity.title'));
            window.ProgressTracker.applyProgressTransform(progressBar, 0);
            progressBar.setAttribute('aria-valuetext', progressText.textContent);
            return;
        }
        if (this.activityFileId !== file.id) {
            window.MediaPreviews?.unbind(icon);
            window.MediaPreviews?.bind(icon, file);
            this.activityFileId = file.id;
        }
        container.dataset.fileId = file.id;
        name.textContent = file.name;
        name.title = file.name;
        size.textContent = window.Utils.formatBytes(file.size);
        progressBar.setAttribute('aria-label', window.I18n.t('progress.fileAria', { name: file.name }));
        window.ProgressTracker.applySnapshot({ container, icon, progressBar, progressText }, file);
    },
    clearSelectionError() { const notice = document.getElementById('selectionNotice'); if (notice)
        notice.hidden = true; },
    selectionError() {
        const notice = document.getElementById('selectionNotice');
        if (notice) {
            notice.hidden = false;
            notice.textContent = window.I18n.t('files.unreadable');
        }
    },
    phase(label) { const el = document.getElementById('totalTimer'); if (el)
        el.textContent = label; },
    elapsed(seconds, phase) { this.phase(window.I18n.t('timer.total', { phase, time: window.Utils.formatTime(seconds) })); },
    bind(controller) {
        document.getElementById('activityViewFiles')?.addEventListener('click', () => void window.FileListView.showAll());
        const input = /** @type {HTMLInputElement} */ (document.getElementById('fileInput'));
        document.getElementById('chooseBtn')?.addEventListener('click', () => input.click());
        input?.addEventListener('change', () => { if (input.files)
            void controller.addFiles(input.files); input.value = ''; });
        const zone = document.getElementById('uploadZone');
        for (const name of ['dragenter', 'dragover', 'dragleave', 'drop'])
            zone?.addEventListener(name, event => { event.preventDefault(); event.stopPropagation(); });
        zone?.addEventListener('dragover', () => { if (!controller.getSnapshot().active)
            zone.classList.add('dragover'); });
        for (const name of ['drop', 'dragleave'])
            zone?.addEventListener(name, () => zone.classList.remove('dragover'));
        zone?.addEventListener('drop', event => { if (event.dataTransfer?.files)
            void controller.addFiles(event.dataTransfer.files); });
        document.getElementById('uploadBtn')?.addEventListener('click', () => void controller.uploadFiles());
        document.getElementById('resetBtn')?.addEventListener('click', () => controller.resetFiles());
        document.getElementById('retryFailed')?.addEventListener('click', () => void controller.uploadFiles());
        document.getElementById('startAnother')?.addEventListener('click', () => controller.resetFiles());
    },
    render() {
        const controller = window.UploadManager;
        if (!controller)
            return;
        const session = window.TransferSession;
        const snapshot = controller.getSnapshot();
        const selected = snapshot.selectedFiles > 0;
        const busy = snapshot.active || snapshot.selectionPending > 0;
        const enabled = session.initialized && session.state === 'ready' && window.SecurityManager.isValid && !busy;
        const summary = snapshot.summary;
        document.querySelector('.main-card')?.classList.toggle('has-result', !!summary);
        for (const id of ['fileInput', 'chooseBtn', 'uploadBtn', 'resetBtn', 'startAnother', 'retryFailed']) {
            const control = /** @type {HTMLButtonElement | HTMLInputElement | null} */ (document.getElementById(id));
            if (control) {
                control.disabled = !enabled;
                control.setAttribute('aria-disabled', String(!enabled));
            }
        }
        const choose = document.getElementById('chooseBtn');
        if (choose) {
            choose.classList.toggle('btn-primary-modern', !selected);
            choose.classList.toggle('btn-outline-modern', selected);
            choose.textContent = window.I18n.t(selected ? 'files.add' : 'upload.choose');
            choose.setAttribute('aria-label', choose.textContent);
        }
        const upload = document.getElementById('uploadBtn');
        const reset = document.getElementById('resetBtn');
        if (upload)
            upload.hidden = !selected || !!summary;
        if (reset) {
            reset.hidden = !selected || !!summary;
            reset.textContent = window.I18n.t('files.clear');
            reset.setAttribute('aria-label', reset.textContent); /** @type {HTMLButtonElement} */
            (reset).disabled = !(session.initialized && session.state === 'ready' && window.SecurityManager.isValid && !snapshot.active);
        }
        const zone = document.getElementById('uploadZone');
        zone?.classList.toggle('upload-disabled', !enabled);
        zone?.setAttribute('aria-disabled', String(!enabled));
        document.querySelector('.main-card')?.classList.toggle('has-selection', selected);
        const selectedLabel = document.getElementById('selectionSummary');
        if (selectedLabel) {
            selectedLabel.hidden = !selected || !!summary;
            selectedLabel.textContent = window.I18n.t(snapshot.selectionPending ? 'files.reading' : 'files.selection', { count: snapshot.selectedFiles, size: window.Utils.formatBytes(snapshot.selectedBytes) });
        }
        const speed = document.getElementById('currentSpeed');
        if (speed)
            speed.hidden = !snapshot.active;
        const stats = document.getElementById('statsRow');
        if (stats)
            stats.hidden = !!summary || !snapshot.active;
        const aggregate = document.getElementById('aggregateProgress');
        if (aggregate)
            aggregate.hidden = !snapshot.active;
        const timer = document.getElementById('totalTimer');
        if (timer)
            timer.hidden = !!summary;
        const result = document.getElementById('results');
        if (result)
            result.hidden = !summary;
        if (summary)
            this.renderSummary(summary);
        window.MediaPreviews?.setPaused(busy);
        this.renderActivity(snapshot);
    },
    /** @param {TransferSummary} summary */
    renderSummary(summary) {
        const title = document.getElementById('resultTitle');
        const body = document.getElementById('resultBody');
        if (title)
            title.textContent = window.I18n.t(summary.outcome === 'complete' ? 'modal.completeTitle' : `result.${summary.outcome}Title`);
        if (body)
            body.textContent = window.I18n.t(`result.${summary.outcome}Body`);
        const list = document.getElementById('resultMetrics');
        if (list) {
            const rows = [
                ['modal.uploaded', String(summary.uploaded)], ['modal.alreadyExisted', String(summary.skipped)],
                ['stats.failed', String(summary.failed)], ['stats.totalSize', window.Utils.formatBytes(summary.selectedBytes)],
                ['modal.totalTime', window.Utils.formatTime(summary.totalDurationMs / 1000)],
                ['result.average', window.Utils.formatSpeed(summary.averageMediaBytesPerSecond)],
                ['result.peak', window.Utils.formatSpeed(summary.peakMediaBytesPerSecond)]
            ];
            list.replaceChildren(...rows.map(([key, value]) => {
                const row = document.createElement('div');
                const dt = document.createElement('dt');
                const dd = document.createElement('dd');
                dt.textContent = window.I18n.t(key);
                dd.textContent = value;
                row.append(dt, dd);
                return row;
            }));
        }
        const retry = document.getElementById('retryFailed');
        const another = document.getElementById('startAnother');
        const retryable = summary.retryable > 0 && summary.outcome !== 'blocked';
        if (retry)
            retry.hidden = !retryable;
        if (another) {
            another.hidden = summary.outcome === 'blocked';
            another.classList.toggle('btn-primary-modern', !retryable);
            another.classList.toggle('btn-outline-modern', retryable);
        }
        document.getElementById('results')?.setAttribute('data-outcome', summary.outcome);
    }
};
window.TransferView = lmtTransferView;
