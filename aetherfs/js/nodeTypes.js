/**
 * AetherFS – Node Type Definitions
 * Colors, icons, categories, radius calculation
 */

'use strict';

const NodeTypes = {
    CATEGORIES: {
        image: { color: '#b44fff', label: 'Image' },
        code: { color: '#39ff14', label: 'Code' },
        video: { color: '#ff3860', label: 'Video' },
        audio: { color: '#ff9f00', label: 'Audio' },
        document: { color: '#00f5ff', label: 'Document' },
        archive: { color: '#1a8fff', label: 'Archive' },
        folder: { color: '#ffffff', label: 'Folder' },
        unknown: { color: '#4a6080', label: 'Unknown' },
    },

    // Extension → Category maps
    EXT_MAP: (() => {
        const map = new Map();
        const groups = {
            image: ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.avif', '.ico', '.bmp', '.tiff', '.heic', '.raw'],
            code: ['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.cpp', '.c', '.h', '.java', '.rb', '.php', '.swift', '.kt', '.cs', '.html', '.css', '.scss', '.sass', '.less', '.json', '.yaml', '.yml', '.toml', '.xml', '.sh', '.bash', '.zsh', '.ps1', '.vue', '.svelte', '.elm', '.clj', '.ex', '.exs', '.hs', '.ml', '.r', '.jl', '.lua', '.dart'],
            video: ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.flv', '.wmv', '.ogv', '.3gp'],
            audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma'],
            document: ['.pdf', '.doc', '.docx', '.md', '.txt', '.rtf', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.epub', '.pages', '.numbers', '.key'],
            archive: ['.zip', '.tar', '.gz', '.7z', '.rar', '.bz2', '.xz', '.lz4', '.zst', '.cab'],
        };
        for (const [cat, exts] of Object.entries(groups)) {
            for (const ext of exts) map.set(ext, cat);
        }
        return map;
    })(),

    // ── Infer category ──────────────────────────────────────
    infer(name, isDir) {
        if (isDir) return 'folder';
        const dot = name.lastIndexOf('.');
        if (dot === -1) return 'unknown';
        const ext = name.slice(dot).toLowerCase();
        return NodeTypes.EXT_MAP.get(ext) || 'unknown';
    },

    // ── Get metadata for a category ─────────────────────────
    get(category) {
        return NodeTypes.CATEGORIES[category] || NodeTypes.CATEGORIES.unknown;
    },

    color(category) { return NodeTypes.get(category).color; },
    label(category) { return NodeTypes.get(category).label; },

    // ── Node visual radius based on size ────────────────────
    radius(sizeBytes, isFolder = false) {
        // Return a fixed larger collision radius for box nodes
        return isFolder ? 70 : 60;
    },

    // ── Glow shadow string ───────────────────────────────────
    glow(category, intensity = 1) {
        return 'none';
    },

    // ── Hex color to rgba ────────────────────────────────────
    hexToRgba(hex, alpha = 1) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    },

    // ── Heatmap color for a ratio 0-1 ───────────────────────
    heatColor(ratio) {
        if (ratio < 0.33) {
            const t = ratio / 0.33;
            return `rgba(0,${Math.round(245 * (1 - t))},255,${0.3 + t * 0.4})`;
        } else if (ratio < 0.66) {
            const t = (ratio - 0.33) / 0.33;
            return `rgba(${Math.round(255 * t)},${Math.round(159 * t)},0,${0.6 + t * 0.2})`;
        } else {
            const t = (ratio - 0.66) / 0.34;
            return `rgba(255,${Math.round(56 * (1 - t))},${Math.round(96 * (1 - t))},${0.7 + t * 0.3})`;
        }
    },

    // ── Group nodes by type for type-cluster layout ──────────
    typeGroups: ['image', 'code', 'video', 'audio', 'document', 'archive', 'folder', 'unknown'],
    typeGroupAngle(type) {
        const idx = NodeTypes.typeGroups.indexOf(type);
        return (idx / NodeTypes.typeGroups.length) * Math.PI * 2;
    },
};
