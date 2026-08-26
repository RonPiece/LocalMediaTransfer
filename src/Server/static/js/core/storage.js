/**
 * Storage Manager - Cache cleanup and memory management
 */

window.UploadCacheManager = class {
    constructor() {
        this.uploadedFiles = new Set();
        this.tempObjects = new Set();
        this.isEnabled = true;
        this.localStorageCleanupKeys = [
            'upload_session_data',
            'lmt.upload.session',
            'lmt.transfer.session'
        ];
        this.sessionStorageCleanupKeys = [
            'upload_session_data',
            'lmt.upload.session',
            'lmt.transfer.session'
        ];
        this.cacheCleanupNames = [
            'LocalMediaTransferUploads',
            'lmt-upload-cache'
        ];
    }
    
    trackUpload(fileId, fileName, fileSize) {
        if (this.isEnabled) {
            this.uploadedFiles.add({
                id: fileId, 
                name: fileName, 
                size: fileSize,
                timestamp: Date.now()
            });
        }
    }
    
    trackTempObject(url) {
        if (url && url.startsWith('blob:')) {
            this.tempObjects.add(url);
        }
    }
    
    async performCleanup() {
        try {
            console.log(`Starting cleanup for ${this.uploadedFiles.size} uploaded files`);
            
            this.clearFileInputs();
            this.revokeAllBlobUrls();
            this.clearDOMReferences();
            await this.clearBrowserCaches();
            
            this.uploadedFiles.clear();
            this.tempObjects.clear();
            
            console.log('Upload cleanup completed');
            
        } catch (error) {
            console.warn('Upload cleanup failed:', error);
        }
    }
    
    clearFileInputs() {
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
            try {
                input.value = '';
                input.files = null;
            } catch (e) {}
        });
    }
    
    revokeAllBlobUrls() {
        this.tempObjects.forEach(url => {
            try {
                URL.revokeObjectURL(url);
            } catch (e) {}
        });
        
        this.uploadedFiles.forEach(file => {
            if (file.tempUrl) {
                try {
                    URL.revokeObjectURL(file.tempUrl);
                } catch (e) {}
            }
        });
    }
    
    clearDOMReferences() {
        const completedItems = document.querySelectorAll('.file-item.success, .file-item.error');
        completedItems.forEach(item => {
            try {
                item.removeAttribute('data-file-data');
                item.removeAttribute('data-file-ref');
                
                const progressBars = item.querySelectorAll('.progress-bar-modern');
                progressBars.forEach(bar => {
                    bar.style.background = 'var(--primary-green)';
                });
            } catch (e) {}
        });
    }
    
    async clearBrowserCaches() {
        try {
            // Clear only known app-owned transient keys. Do not remove language
            // preference (lmt.language) or unrelated site data.
            this.localStorageCleanupKeys.forEach(key => {
                try {
                    localStorage.removeItem(key);
                } catch (e) {}
            });
            
            this.sessionStorageCleanupKeys.forEach(key => {
                try {
                    sessionStorage.removeItem(key);
                } catch (e) {}
            });
            
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                for (const cacheName of cacheNames) {
                    if (this.cacheCleanupNames.includes(cacheName)) {
                        await caches.delete(cacheName);
                    }
                }
            }
            
        } catch (error) {
            console.warn('Browser cache cleanup failed:', error);
        }
    }
};

// Global instance
window.uploadCacheManager = new window.UploadCacheManager();

console.log('💾 Storage manager loaded');
