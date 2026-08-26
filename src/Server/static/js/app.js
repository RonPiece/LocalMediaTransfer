/**
 * File Transfer Hub - Application Initialization
 * Loads all required modules and initializes the application
 */

(async function initApp() {
    'use strict';

    const assetVersion = '20260813.2';
    window.LMT_FRONTEND_VERSION = assetVersion;

    // Module loading configuration
    const modules = [
        // Core utilities (no dependencies)
        'core/utils.js',
        'core/i18n.js',
        'core/security.js',
        'core/storage.js',
        
        // UI components
        'ui/icons.js',
        'ui/modals.js',
        'ui/progress.js',
        
        // Upload functionality (depends on core + ui)
        'upload/preflight.js',
        'upload/manager.js',
        'upload/workers.js',
        
        // Platform-specific features
        'ui/ios-tips.js'
    ];

    // Base path for modules
    const basePath = '/static/js/';
    
    try {
        // Load all modules sequentially to respect dependencies
        for (const module of modules) {
            await loadScript(`${basePath}${module}?v=${assetVersion}`);
            console.log(`✅ Loaded: ${module}`);
        }
        
        // Initialize application after all modules are loaded
        await initializeApplication();
        
        console.log('✅ File Transfer Hub initialized successfully');
        
    } catch (error) {
        console.error('❌ Failed to initialize application:', error);
        showFallbackError();
    }

    /**
     * Dynamically load a JavaScript module
     */
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
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

        if (window.SecurityManager) {
            await window.SecurityManager.init();
        }
        
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

        // Global error handling
        window.addEventListener('error', handleGlobalError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
    }

    /**
     * Show fallback error message if module loading fails
     */
    function showFallbackError() {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed; top: 20px; left: 20px; right: 20px;
            background: #fee; border: 1px solid #fcc; color: #c33;
            padding: 1rem; border-radius: 8px; z-index: 9999;
            font-family: system-ui, sans-serif;
        `;
        errorDiv.innerHTML = `
            <strong>⚠️ Loading Error</strong><br>
            Some application components failed to load. Please refresh the page or contact support.
        `;
        document.body.appendChild(errorDiv);
    }

    /**
     * Global error handlers
     */
    function handleGlobalError(event) {
        console.error('Global error:', event.error);
        if (window.UploadManager && typeof window.UploadManager.logClientEvent === 'function') {
            window.UploadManager.logClientEvent('ERROR', 'global_error', 'Unhandled browser error', {
                message: event?.error?.message || event?.message || 'unknown',
                filename: event?.filename || '',
                line: event?.lineno || 0,
                column: event?.colno || 0
            });
        }
    }

    function handleUnhandledRejection(event) {
        console.error('Unhandled promise rejection:', event.reason);
        if (window.UploadManager && typeof window.UploadManager.logClientEvent === 'function') {
            window.UploadManager.logClientEvent('ERROR', 'unhandled_rejection', 'Unhandled promise rejection', {
                reason: String(event?.reason || 'unknown')
            });
        }
        event.preventDefault();
    }

})();
