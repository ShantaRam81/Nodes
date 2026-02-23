/**
 * AetherFS – Node Type Definitions
 * Colors, categories, radius calculation (Strict Grayscale aesthetic version)
 */

export const NodeTypes = {
    CATEGORIES: {
        image: { color: '#a0a0a0', label: 'Изображение' },
        code: { color: '#ffffff', label: 'Код' },
        video: { color: '#888888', label: 'Видео' },
        audio: { color: '#666666', label: 'Аудио' },
        document: { color: '#cccccc', label: 'Документ' },
        archive: { color: '#555555', label: 'Архив' },
        folder: { color: '#ffffff', label: 'Папка' },
        'file-group': { color: '#a0c0ff', label: 'Группа файлов' },
        unknown: { color: '#444444', label: 'Неизвестно' },
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
        return isFolder ? 70 : 60;
    },

    // ── Hex color to rgba ────────────────────────────────────
    hexToRgba(hex, alpha = 1) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    },

    // ── Heatmap color for a ratio 0-1 (Grayscale) ───────────
    heatColor(ratio) {
        const val = Math.round(255 * ratio);
        return `rgba(${val}, ${val}, ${val}, 0.8)`;
    }
};
