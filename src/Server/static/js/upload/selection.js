/** Ordered, interruptible ingestion; no DOM, transport or application-state writes. */
class BrowserSelection {
    revision = 0;
    pending = 0;
    tail = Promise.resolve();
    /** @param {FileList | File[]} input @param {(file: File) => void} accept @param {() => void} changed */
    add(input, accept, changed) {
        const files = Array.from(input);
        const revision = this.revision;
        this.pending += files.length;
        const job = this.tail.then(async () => {
            let started = performance.now();
            let consumed = 0;
            try {
                for (const file of files) {
                    if (revision !== this.revision)
                        return;
                    try {
                        accept(file);
                    }
                    finally {
                        this.pending--;
                        consumed++;
                    }
                    if (performance.now() - started >= 8) {
                        changed();
                        await new Promise(resolve => setTimeout(resolve, 0));
                        started = performance.now();
                    }
                }
            }
            finally {
                if (revision === this.revision) {
                    this.pending -= files.length - consumed;
                    changed();
                }
            }
        });
        this.tail = job.catch(() => { });
        return job;
    }
    reset() { this.revision++; this.pending = 0; this.tail = Promise.resolve(); }
}
window.BrowserSelection = BrowserSelection;
