type SessionOutcome = 'complete' | 'mixed' | 'failed' | 'blocked';
interface TransferSummary {
    outcome: SessionOutcome;
    uploaded: number;
    skipped: number;
    failed: number;
    retryable: number;
    totalDurationMs: number;
    selectedBytes: number;
    preparationDurationMs: number;
    uploadDurationMs: number;
    acknowledgedMediaBytes: number;
    averageMediaBytesPerSecond: number;
    peakMediaBytesPerSecond: number;
}
interface TransferRunSnapshot {
    phase: string; active: boolean; selectedFiles: number; selectedBytes: number;
    selectionPending: number; summary: TransferSummary | null;
    counts: { uploaded: number; skipped: number; failed: number };
    activeFiles: number;
    activity: Readonly<FileActivitySnapshot> | null;
}
interface RunAccountingOwner {
    fileQueue: TransferFile[]; globalUploadedBytes: number; globalCompletedBytes: number;
    networkBytesUploaded: number; totalBytes: number; checkDurationMs: number; uploadDurationMs: number;
    throughput: BrowserThroughputTracker | null;
    completionRates: ReturnType<BrowserThroughputTracker['snapshot']> | null;
    summary: TransferSummary | null;
}
interface UploadConfirmation { success: true; filename?: string; skipped?: boolean; complete?: boolean; }
interface PreflightConfirmation { id: string; action: string; filename?: string; }
interface PreviewSource { id: string; file: File; name: string; size: number; }
interface FileSnapshot {
    id: string; name: string; size: number; done: boolean; failed: boolean;
    skipped?: boolean; preflightSkipped?: boolean;
    serverResult?: { filename?: string; skipped?: boolean; complete?: boolean; };
    presentation: FilePresentation;
}
interface FileActivitySnapshot extends FileSnapshot, PreviewSource {}
interface FilePresentation {
    labelKey?: string;
    labelValues?: Record<string, string|number>;
    state: 'queued' | 'success' | 'skipped' | 'error';
    text: string;
    percent: number;
}
interface FileFailure { message: string; status: number; retryable: boolean; }
interface ChunkUploadObserver {
    onRetry?: (attempt: number, error: Error) => void;
    onProgress?: (loaded: number, total: number) => void;
    onTiming?: (startedAt: number, request: XMLHttpRequest) => void;
}
interface TransportContext {
    UPLOAD_URL: string; UPLOAD_CHUNK_URL: string; SINGLE_FILE_MAX_BYTES: number; chunkSizeBytes: number;
    updateFileTransferProgress(file: TransferFile, bytes: number): {uploadDelta: number; completedDelta: number};
    recordFileAcknowledgement?(file: TransferFile, bytes: number): void;
    onSending?(percent: number, waiting: boolean): void;
    onActivity?(): void;
    onRetry?(attempt: number, index: number, error: Error): void;
    onTiming?(started: number, request: XMLHttpRequest): void;
}
interface PreflightObserver {
    onChecking(file: TransferFile, key: string): void;
    onDecision(file: TransferFile, result?: PreflightConfirmation): void;
}
interface FileUI { container: HTMLElement; progressBar: HTMLElement; progressText: HTMLElement; icon: HTMLElement; }
interface TransferFile {
    id: string; file: File; name: string; size: number;
    running: boolean; done: boolean; failed: boolean; retryable: boolean;
    skipped?: boolean; preflightSkipped?: boolean;
    uploadedBytes: number; completedBytes: number;
    acknowledgedBytes?: number;
    _lastUIUpdate?: number;
    presentation: FilePresentation;
    failure?: FileFailure;
    ui?: FileUI | null;
    serverResult?: { filename?: string; skipped?: boolean; complete?: boolean; };
    transferTiming?: Record<string, number>;
}
interface Error { status?: number; retryable?: boolean; }
interface ModalAction { label: string; action: string; primary?: boolean; labelKey?: string; }
interface DialogOptions {
    id: string; title: string; titleKey?: string; tone?: string;
    bodyBuilder?: (body: HTMLElement) => void;
    actions?: ModalAction[];
}
interface Window {
    TransferAccounting: typeof lmtRunAccounting;
    TransferContracts: typeof lmtContracts;
    TransferController: typeof lmtController;
    TransferView: typeof lmtTransferView;
    BrowserSelection: typeof BrowserSelection;
    BrowserMediaPreviews: typeof BrowserMediaPreviews;
    BrowserFileListModel: typeof BrowserFileListModel;
    BrowserFileList: typeof BrowserFileList;
    MediaPreviews: BrowserMediaPreviews;
    FileListView: BrowserFileList;
    Utils: typeof lmtUtils;
    I18n: typeof lmtI18n;
    SecurityManager: typeof lmtSecurity;
    ProgressTracker: typeof lmtProgress;
    UploadManager: typeof lmtManager;
    UploadWorkers: typeof lmtWorkers;
    DuplicatePreflight: typeof lmtPreflight;
    IOSTips: typeof lmtTips;
    TransferSession: typeof lmtSession;
    TransferTelemetry: typeof lmtTelemetry;
    BrowserThroughputTracker: typeof BrowserThroughputTracker;
    lmtFetch: typeof lmtFetch;
    UploadCacheManager: typeof lmtCache;
    uploadCacheManager: InstanceType<typeof lmtCache>;
    TransferLimits: Readonly<Record<'MaxChunksPerFile'|'MaxFileBytes'|'MaxQueuedFiles'|'NativeChunkBytes'|'CompatibilityChunkBytes'|'WholeFileBytes'|'MaxChunkBytes'|'MaxEncodedChunkBytes', number>>;
    LMT_FRONTEND_VERSION: string;
    LocalIcons: {
        createIcon(name: string, options?: { className?: string; title?: string }): HTMLElement | SVGElement;
        setIcon(target: Element, name: string, options?: { className?: string; title?: string }): Element;
        hydrate(root?: Document | Element): void;
    };
    Modals: {
        showDialog(options: DialogOptions): void;
        showTokenModal(options?: { title?: string; message?: string; titleKey?: string; messageKey?: string; btnText?: string }): void;
        showNoFilesModal(): void;
        showAlreadyUploadedModal(): void;
    };
    __fileTransfer: {
        addFiles: typeof lmtManager.addFiles;
        uploadFiles: typeof lmtManager.uploadFiles;
        resetFiles: typeof lmtManager.resetFiles;
        getQueue(): TransferFile[];
        getTimingSummary: typeof lmtManager.getTimingSummary;
    };
    addMoreFiles(): void; resetAndStart(): void; resetForNewUpload(): void;
    formatTime: typeof lmtUtils.formatTime;
    formatBytes: typeof lmtUtils.formatBytes;
    formatSpeed: typeof lmtUtils.formatSpeed;
}
