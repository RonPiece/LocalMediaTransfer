/**
 * File Transfer Hub - Application Initialization
 * Loads all required modules and initializes the application
 */

(async function initApp() {
    'use strict';

    const assetVersion = '20261020.3';
    window.LMT_FRONTEND_VERSION = assetVersion;

    try {
        for (const name of ['TransferSession', 'Utils', 'TransferLimits', 'I18n', 'SecurityManager', 'UploadCacheManager', 'BrowserThroughputTracker',
            'TransferAccounting', 'TransferContracts', 'BrowserSelection', 'BrowserMediaPreviews', 'BrowserFileList', 'TransferView', 'TransferController', 'LocalIcons', 'Modals', 'ProgressTracker', 'DuplicatePreflight', 'UploadManager', 'UploadWorkers', 'IOSTips']) {
            if (!window[name]) throw new Error('Required module unavailable');
        }
        await initializeApplication();
    } catch {
        if (window.TransferSession) {
            window.TransferSession.update('failed');
            window.TransferSession.showStartup('startup.failed', true);
        } else {
            // The lifecycle module itself may have failed to load. The native
            // Retry form works without JavaScript and preserves the locked UI.
            const message = document.getElementById('startupMessage');
            if (message) message.textContent = 'The page could not load. Retry to refresh it.';
            document.getElementById('startupRetry')?.addEventListener('click', event => {
                event.preventDefault();
                window.location.reload();
            });
        }
        console.error('Local Media Transfer could not initialize.');
    }

    /**
     * Initialize the application after all modules are loaded
     */
    async function initializeApplication() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve, { once: true });
            });
        }

        // Initialize modules in the correct order
        if (window.I18n) {
            await window.I18n.init();
        }

        await window.SecurityManager.init();
        
        window.MediaPreviews = new window.BrowserMediaPreviews();
        window.FileListView = new window.BrowserFileList();
        window.FileListView.init();

        if (window.UploadManager) {
            window.UploadManager.init();
        }
        
        if (window.ProgressTracker) {
            window.ProgressTracker.init();
        }

        if (window.LocalIcons) {
            window.LocalIcons.hydrate();
        }
        
        if (window.IOSTips) {
            window.IOSTips.init();
        }

        window.TransferSession.initialized = true;
        window.TransferSession.update(window.SecurityManager.isValid ? 'ready' : 'blocked');
        if (window.SecurityManager.isValid) window.TransferSession.showStartup('');

        // Global error handling
        window.addEventListener('error', handleGlobalError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
    }

    /**
     * Global error handlers
     */
    function handleGlobalError(event) {
        console.error('Local Media Transfer encountered an unexpected browser error.');
        if (window.UploadManager && typeof window.UploadManager.logClientEvent === 'function') {
            window.UploadManager.logClientEvent('ERROR', 'global_error', 'Unhandled browser error', {
                filename: event?.filename || '',
                line: event?.lineno || 0,
                column: event?.colno || 0,
                errorType: event?.error?.name || 'Error'
            });
        }
    }

    function handleUnhandledRejection(event) {
        console.error('Local Media Transfer encountered an unexpected asynchronous error.');
        if (window.UploadManager && typeof window.UploadManager.logClientEvent === 'function') {
            window.UploadManager.logClientEvent('ERROR', 'unhandled_rejection', 'Unhandled promise rejection', {
                errorType: event?.reason?.name || 'Error'
            });
        }
        event.preventDefault();
    }

})();
