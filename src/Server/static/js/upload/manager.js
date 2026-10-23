/** Public compatibility surface. All mutable transfer state belongs to one controller. */
const lmtManager = window.TransferController;
window.UploadManager = lmtManager;
window.__fileTransfer = {
    addFiles: lmtManager.addFiles.bind(lmtManager),
    uploadFiles: lmtManager.uploadFiles.bind(lmtManager),
    resetFiles: lmtManager.resetFiles.bind(lmtManager),
    getQueue: () => lmtManager.fileQueue.map(file => ({ ...file, presentation: { ...file.presentation }, serverResult: file.serverResult && { ...file.serverResult } })),
    getTimingSummary: lmtManager.getTimingSummary.bind(lmtManager)
};
window.addMoreFiles = () => { if (!lmtManager.isUploadInProgress) document.getElementById('fileInput')?.click(); };
window.resetAndStart = () => { if (!lmtManager.isUploadInProgress) { lmtManager.resetFiles(); document.getElementById('fileInput')?.click(); } };
window.resetForNewUpload = lmtManager.resetFiles.bind(lmtManager);
