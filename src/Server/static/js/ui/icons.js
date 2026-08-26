/**
 * Local icons.
 * Prefer checked-in SVG masks, with inline SVG fallbacks for icons that do not
 * have a file asset yet.
 */

(function initLocalIcons() {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    const assets = {
        upload: '/static/icons/fontawesome/file-import-solid.svg',
        fileUpload: '/static/icons/fontawesome/file-arrow-up-solid-full.svg',
        folder: '/static/icons/fontawesome/folder-open-solid-full.svg',
        reset: '/static/icons/fontawesome/rotate-right-solid-full.svg',
        check: '/static/icons/fontawesome/circle-check-solid-full.svg',
        skipped: '/static/icons/fontawesome/check-double-solid-full.svg',
        failed: '/static/icons/fontawesome/circle-xmark-solid-full.svg',
        database: '/static/icons/fontawesome/database-solid-full.svg',
        list: '/static/icons/fontawesome/list-ul-solid-full.svg',
        file: '/static/icons/fontawesome/file-arrow-up-solid-full.svg',
        mobile: '/static/icons/fontawesome/mobile-screen-button-solid-full.svg',
        github: '/static/icons/fontawesome/github-brands-solid-full.svg',
        linkedin: '/static/icons/fontawesome/linkedin-brands-solid-full.svg'
    };

    const paths = {
        upload: [
            'M12 3v12',
            'M7 8l5-5 5 5',
            'M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'
        ],
        folder: [
            'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7z',
            'M3 10h18l-2 8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2l-2-8z'
        ],
        reset: [
            'M20 12a8 8 0 1 1-2.35-5.65',
            'M20 4v6h-6'
        ],
        check: [
            'M20 6L9 17l-5-5'
        ],
        failed: [
            'M18 6L6 18',
            'M6 6l12 12'
        ],
        database: [
            'M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3z',
            'M4 6v6c0 2 4 3 8 3s8-1 8-3V6',
            'M4 12v6c0 2 4 3 8 3s8-1 8-3v-6'
        ],
        list: [
            'M8 6h13',
            'M8 12h13',
            'M8 18h13',
            'M3 6h.01',
            'M3 12h.01',
            'M3 18h.01'
        ],
        file: [
            'M7 3h7l5 5v13H7V3z',
            'M14 3v6h5'
        ],
        chevron: [
            'M8 10l4 4 4-4'
        ],
        mobile: [
            'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z',
            'M11 18h2'
        ],
        github: [
            'M12 2a10 10 0 0 0-3 19c.5.1.7-.2.7-.5v-2c-3 .7-3.7-1.3-3.7-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.5 1.1 3.1.9.1-.7.4-1.1.7-1.4-2.4-.3-5-1.2-5-5.3 0-1.2.4-2.1 1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1A10 10 0 0 1 12 5.3c.9 0 1.8.1 2.7.4 2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.8 1 1.7 1 2.9 0 4.1-2.6 5-5 5.3.4.3.8 1 .8 2v2.9c0 .3.2.6.8.5A10 10 0 0 0 12 2z'
        ],
        linkedin: [
            'M6 9h3v10H6V9z',
            'M7.5 5a1.7 1.7 0 1 1 0 3.4A1.7 1.7 0 0 1 7.5 5z',
            'M11 9h3v1.4c.5-.8 1.4-1.6 3-1.6 3 0 4 2 4 4.7V19h-3v-5c0-1.4-.3-2.5-1.8-2.5S14 12.6 14 14v5h-3V9z'
        ]
    };

    function createIcon(name, options = {}) {
        if (assets[name]) {
            const icon = document.createElement('span');
            icon.setAttribute('aria-hidden', options.decorative === false ? 'false' : 'true');
            icon.classList.add('lmt-icon', 'lmt-svg-icon', `lmt-icon-${name}`);
            icon.style.setProperty('--lmt-icon-url', `url("${assets[name]}")`);
            if (options.className) {
                options.className.split(/\s+/).filter(Boolean).forEach(cls => icon.classList.add(cls));
            }
            return icon;
        }

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', options.decorative === false ? 'false' : 'true');
        svg.setAttribute('focusable', 'false');
        svg.classList.add('lmt-icon', `lmt-icon-${name}`);
        if (options.className) {
            options.className.split(/\s+/).filter(Boolean).forEach(cls => svg.classList.add(cls));
        }

        for (const data of paths[name] || paths.file) {
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', data);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('stroke-width', '2');
            svg.appendChild(path);
        }

        return svg;
    }

    function setIcon(target, name, options = {}) {
        if (!target) return null;
        target.textContent = '';
        while (target.firstChild) {
            target.removeChild(target.firstChild);
        }
        const icon = createIcon(name, options);
        target.appendChild(icon);
        target.dataset.icon = name;
        return icon;
    }

    function hydrate(root = document) {
        root.querySelectorAll('[data-lmt-icon]').forEach(target => {
            setIcon(target, target.getAttribute('data-lmt-icon'));
        });
    }

    window.LocalIcons = {
        createIcon,
        setIcon,
        hydrate
    };
})();

console.log('Local icons loaded');
