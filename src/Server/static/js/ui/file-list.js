/** Stable selection-order lookup, independent of mounted rows. */
class BrowserFileListModel {
    query = '';
    filter = 'all';
    page = 0;
    /** @param {readonly FileSnapshot[]} files */
    select(files) {
        const query = this.query.trim().toLocaleLowerCase();
        if (!query && this.filter === 'all') {
            this.page = Math.max(0, Math.min(this.page, Math.ceil(files.length / 100) - 1));
            return { total: files.length, start: this.page * 100, files: files.slice(this.page * 100, this.page * 100 + 100) };
        }
        const matches = files.filter(file => {
            if (this.filter !== 'all' && this.outcome(file) !== this.filter)
                return false;
            return !query || file.name.toLocaleLowerCase().includes(query) || (file.serverResult?.filename || '').toLocaleLowerCase().includes(query);
        });
        this.page = Math.max(0, Math.min(this.page, Math.ceil(matches.length / 100) - 1));
        return { total: matches.length, start: this.page * 100, files: matches.slice(this.page * 100, this.page * 100 + 100) };
    }
    /** @param {FileSnapshot} file */
    outcome(file) { return file.failed ? 'failed' : file.skipped || file.preflightSkipped ? 'skipped' : file.done ? 'uploaded' : 'pending'; }
}
class BrowserFileList {
    model = new BrowserFileListModel();
    /** @type {TransferFile[]} */
    files = [];
    revision = 0;
    /** @type {number | undefined} */
    timer;
    /** @type {number | undefined} */
    searchTimer;
    /** @type {HTMLElement | null} */
    container = null;
    signature = '';
    init() {
        const details = document.getElementById('fileDetails');
        this.container = document.getElementById('fileRows');
        details?.addEventListener('toggle', () => { if ( /** @type {HTMLDetailsElement} */(details).open)
            void this.render();
        else
            this.unmount(); });
        document.getElementById('fileSearch')?.addEventListener('input', event => {
            clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => {
                this.model.query = /** @type {HTMLInputElement} */ (event.target).value;
                this.model.page = 0;
                void this.render();
            }, 150);
        });
        document.getElementById('fileFilter')?.addEventListener('change', event => {
            this.model.filter = /** @type {HTMLSelectElement} */ (event.target).value;
            this.model.page = 0;
            void this.render();
        });
        document.getElementById('filePrevious')?.addEventListener('click', () => { this.model.page--; void this.render(); });
        document.getElementById('fileNext')?.addEventListener('click', () => { this.model.page++; void this.render(); });
    }
    /** @param {TransferFile[]} files */
    setFiles(files) { this.files = files; this.changed(0); }
    /** @param {number} delay */
    changed(delay = 500) {
        if (this.timer !== undefined)
            return;
        this.timer = setTimeout(() => { this.timer = undefined; void this.render(); }, delay);
    }
    async render() {
        const details = /** @type {HTMLDetailsElement | null} */ (document.getElementById('fileDetails'));
        if (!details || !this.container)
            return;
        details.hidden = !this.files.length;
        if (!details.open)
            return;
        // Membership is recomputed for coalesced outcome changes, never per-byte events.
        const selected = this.model.select(this.files);
        const counts = { all: this.files.length, ...window.UploadManager.getSnapshot().counts };
        for (const option of document.querySelectorAll('#fileFilter option')) {
            const key = /** @type {HTMLOptionElement} */ (option).value;
            if (key in counts)
                option.textContent = `${window.I18n.t(`files.${key}`)} (${counts[ /** @type {keyof typeof counts} */(key)]})`;
        }
        const range = document.getElementById('fileRange');
        if (range)
            range.textContent = selected.total ? window.I18n.t('files.range', { start: selected.start + 1, end: selected.start + selected.files.length, total: selected.total }) : window.I18n.t('files.empty');
        const previous = /** @type {HTMLButtonElement | null} */ (document.getElementById('filePrevious'));
        const next = /** @type {HTMLButtonElement | null} */ (document.getElementById('fileNext'));
        if (previous)
            previous.disabled = this.model.page === 0;
        if (next)
            next.disabled = selected.start + selected.files.length >= selected.total;
        const signature = selected.files.map(file => file.id).join('|');
        if (signature === this.signature)
            return;
        this.unmount();
        this.signature = signature;
        const revision = ++this.revision;
        let started = performance.now();
        for (const snapshot of selected.files) {
            if (revision !== this.revision || !details.open)
                return;
            const file = /** @type {TransferFile} */ (snapshot);
            window.ProgressTracker.renderFileItem(file, this.container);
            if (performance.now() - started >= 8) {
                await new Promise(resolve => setTimeout(resolve, 0));
                started = performance.now();
            }
        }
    }
    /** Explicit navigation from recent activity, including files hidden by a filter. */
    async showAll() {
        clearTimeout(this.searchTimer);
        this.model.query = '';
        this.model.filter = 'all';
        this.model.page = 0;
        const search = /** @type {HTMLInputElement | null} */ (document.getElementById('fileSearch'));
        const filter = /** @type {HTMLSelectElement | null} */ (document.getElementById('fileFilter'));
        const details = /** @type {HTMLDetailsElement | null} */ (document.getElementById('fileDetails'));
        if (search) search.value = '';
        if (filter) filter.value = 'all';
        if (details) details.open = true;
        await this.render();
        details?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    unmount() {
        this.revision++;
        for (const row of window.ProgressTracker.rows?.values() || [])
            window.MediaPreviews?.unbind(row.icon);
        window.ProgressTracker.rows?.clear();
        this.container?.replaceChildren();
        this.signature = '';
    }
    reset() {
        clearTimeout(this.timer);
        clearTimeout(this.searchTimer);
        this.timer = undefined;
        this.unmount();
        this.files = [];
        this.model = new BrowserFileListModel();
        const details = /** @type {HTMLDetailsElement | null} */ (document.getElementById('fileDetails'));
        if (details) {
            details.open = false;
            details.hidden = true;
        }
        const search = /** @type {HTMLInputElement | null} */ (document.getElementById('fileSearch'));
        if (search)
            search.value = '';
        const filter = /** @type {HTMLSelectElement | null} */ (document.getElementById('fileFilter'));
        if (filter)
            filter.value = 'all';
    }
}
window.BrowserFileListModel = BrowserFileListModel;
window.BrowserFileList = BrowserFileList;
