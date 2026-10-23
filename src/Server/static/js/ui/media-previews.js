/** Local, optional preview work. Uploads never await this service. */
class BrowserMediaPreviews {
    /** @type {Map<string, {url: string, bytes: number}>} */
    cache = new Map();
    /** @type {Map<HTMLElement, {source: PreviewSource, visible: boolean, attempted: boolean}>} */
    bindings = new Map();
    failed = new Set();
    bytes = 0;
    generation = 0;
    paused = false;
    running = false;
    /** @type {AbortController | null} */
    active = null;
    activeSourceId = '';
    observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const binding = this.bindings.get(/** @type {HTMLElement} */ (entry.target));
            if (binding)
                binding.visible = entry.isIntersecting;
        }
        void this.pump();
    });
    /** @param {PreviewSource} source */
    kind(source) {
        const extension = source.name.split('.').pop()?.toLowerCase() || '';
        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(extension))
            return 'archive';
        if (source.file.type.startsWith('image/') || /^(jpg|jpeg|png|webp|gif|avif|heic|heif|bmp)$/.test(extension))
            return 'photo';
        if (source.file.type.startsWith('video/') || /^(mp4|mov|webm|mkv|avi|m4v)$/.test(extension))
            return 'video';
        if (source.file.type.startsWith('audio/') || /^(mp3|wav|aac|flac|m4a|ogg)$/.test(extension))
            return 'audio';
        if (/^(pdf|docx?|xlsx?|pptx?|txt|csv|rtf)$/.test(extension))
            return 'document';
        return 'file';
    }
    /** @param {HTMLElement} target @param {PreviewSource} source */
    bind(target, source) {
        target.className = 'media-preview';
        target.dataset.kind = this.kind(source);
        window.LocalIcons.setIcon(target, target.dataset.kind);
        this.bindings.set(target, { source, visible: false, attempted: false });
        const cached = this.cache.get(source.id);
        if (cached)
            this.show(target, source, cached.url);
        this.observer.observe(target);
    }
    /** @param {HTMLElement} target @param {PreviewSource} source @param {string} url */
    show(target, source, url) {
        const img = document.createElement('img');
        img.alt = '';
        img.width = img.height = 64;
        img.src = url;
        target.replaceChildren(img);
        if (this.kind(source) === 'video') {
            const badge = document.createElement('span');
            badge.className = 'media-video-badge';
            window.LocalIcons.setIcon(badge, 'video');
            target.appendChild(badge);
        }
        const cached = this.cache.get(source.id);
        if (cached) {
            this.cache.delete(source.id);
            this.cache.set(source.id, cached);
        }
    }
    /** @param {HTMLElement} target */
    unbind(target) {
        const binding = this.bindings.get(target);
        this.observer.unobserve(target);
        this.bindings.delete(target);
        if (binding?.source.id === this.activeSourceId && ![...this.bindings.values()].some(value => value.source.id === this.activeSourceId))
            this.active?.abort();
    }
    /** @param {boolean} paused */
    setPaused(paused) {
        if (this.paused === paused)
            return;
        this.paused = paused;
        if (paused) {
            this.generation++;
            this.active?.abort();
        }
        else
            void this.pump();
    }
    async pump() {
        if (this.paused || this.running)
            return;
        const next = [...this.bindings].find(([, b]) => b.visible && !b.attempted && !this.cache.has(b.source.id) && !this.failed.has(b.source.id) && ['photo', 'video'].includes(this.kind(b.source)));
        if (!next)
            return;
        const [, binding] = next;
        const { source } = binding;
        binding.attempted = true;
        this.running = true;
        const generation = this.generation;
        const controller = new AbortController();
        this.active = controller;
        this.activeSourceId = source.id;
        try {
            if (source.file.type === 'image/svg+xml' || (this.kind(source) === 'photo' && source.size > 32 * 1024 * 1024))
                throw new Error('Use type icon');
            const blob = await this.decode(source, controller.signal);
            if (generation !== this.generation || controller.signal.aborted)
                return;
            const entry = { url: URL.createObjectURL(blob), bytes: blob.size };
            this.cache.set(source.id, entry);
            this.bytes += entry.bytes;
            while (this.cache.size > 100 || this.bytes > 8 * 1024 * 1024) {
                const oldest = this.cache.entries().next().value;
                if (!oldest)
                    break;
                this.cache.delete(oldest[0]);
                this.bytes -= oldest[1].bytes;
                URL.revokeObjectURL(oldest[1].url);
            }
            if (this.cache.has(source.id))
                for (const [target, b] of this.bindings)
                    if (b.source.id === source.id)
                        this.show(target, source, entry.url);
        }
        catch {
            if (controller.signal.aborted)
                binding.attempted = false;
            if (!controller.signal.aborted && generation === this.generation)
                this.failed.add(source.id);
        }
        finally {
            this.running = false;
            this.active = null;
            this.activeSourceId = '';
            void this.pump();
        }
    }
    /** @param {PreviewSource} source @param {AbortSignal} signal @returns {Promise<Blob>} */
    decode(source, signal) {
        return new Promise((resolve, reject) => {
            const video = this.kind(source) === 'video';
            const media = video ? document.createElement('video') : new Image();
            const url = URL.createObjectURL(source.file);
            let settled = false;
            /** @type {HTMLCanvasElement | null} */
            let canvas = null;
            const cleanup = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', cancel);
                media.onload = media.onerror = null;
                if (media instanceof HTMLVideoElement) {
                    media.onloadedmetadata = media.onloadeddata = media.onseeked = null;
                    media.pause();
                }
                media.removeAttribute('src');
                if (media instanceof HTMLVideoElement)
                    media.load();
                if (canvas) canvas.width = canvas.height = 0;
                URL.revokeObjectURL(url);
            };
            /** @param {Blob | null} blob */
            const finish = blob => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                if (blob)
                    resolve(blob);
                else
                    reject(new Error('Preview unavailable'));
            };
            const cancel = () => finish(null);
            const timer = setTimeout(cancel, 5000);
            signal.addEventListener('abort', cancel, { once: true });
            const capture = () => {
                if (settled || signal.aborted)
                    return;
                const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
                const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
                if (!width || !height) {
                    finish(null);
                    return;
                }
                canvas = document.createElement('canvas');
                canvas.width = canvas.height = 128;
                const context = canvas.getContext('2d');
                if (!context) {
                    finish(null);
                    return;
                }
                try {
                    const side = Math.min(width, height);
                    context.drawImage(media, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 128, 128);
                    canvas.toBlob(blob => { finish(blob); }, 'image/jpeg', 0.8);
                }
                catch {
                    canvas.width = canvas.height = 0;
                    finish(null);
                }
            };
            media.onerror = cancel;
            if (media instanceof HTMLVideoElement) {
                media.muted = true;
                media.playsInline = true;
                media.preload = 'metadata';
                media.onloadedmetadata = () => {
                    if (Number.isFinite(media.duration) && media.duration > 0)
                        media.currentTime = Math.min(1, media.duration / 2);
                    else
                        capture();
                };
                media.onseeked = capture;
            }
            else {
                media.decoding = 'async';
                media.onload = capture;
            }
            media.src = url;
            if (signal.aborted)
                cancel();
        });
    }
    reset() {
        this.generation++;
        this.active?.abort();
        this.observer.disconnect();
        this.bindings.clear();
        for (const entry of this.cache.values())
            URL.revokeObjectURL(entry.url);
        this.cache.clear();
        this.failed.clear();
        this.bytes = 0;
    }
}
window.BrowserMediaPreviews = BrowserMediaPreviews;
