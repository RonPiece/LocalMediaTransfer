/**
 * Core Utilities - Formatting and helper functions
 */

// Global utility functions
window.Utils = {
    isIOSLike() {
        try {
            const ua = navigator.userAgent || '';
            const platform = navigator.platform || '';
            const maxTouchPoints = navigator.maxTouchPoints || 0;
            return /iPhone|iPad|iPod/i.test(ua) ||
                (platform === 'MacIntel' && maxTouchPoints > 1);
        } catch {
            return false;
        }
    },

    isMobileLike() {
        const ua = navigator.userAgent || '';
        return this.isIOSLike() || /Android/i.test(ua);
    },

    // Format seconds as MM:SS
    formatTime(seconds) {
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
        const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
        return `${mm}:${ss}`;
    },

    // Format bytes with units
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024, dm = 2;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    // Format speed with units
    formatSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
        const k = 1024, dm = 2;
        const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
        return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    // Generate unique file ID
    generateFileId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
};

// Make global functions available (for backwards compatibility)
window.formatTime = window.Utils.formatTime;
window.formatBytes = window.Utils.formatBytes;
window.formatSpeed = window.Utils.formatSpeed;

console.log('🔧 Core utilities loaded');
