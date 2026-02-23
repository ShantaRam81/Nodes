/**
 * AetherFS – File System Ingestion
 * Reads local directories via File System Access API
 * and builds a unified FileNode graph.
 */

'use strict';

const FileSystem = {
    nodes: [],
    edges: [],
    rootName: '',
    totalFiles: 0,
    totalFolders: 0,

    // ── Open a directory picker ─────────────────────────────
    async openDirectory(onProgress) {
        let dirHandle;
        try {
            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            if (e.name === 'AbortError') return null;
            throw e;
        }

        this.nodes = [];
        this.edges = [];
        this.totalFiles = 0;
        this.totalFolders = 0;
        this.rootName = dirHandle.name;

        const rootId = Utils.hashStr(dirHandle.name);
        const rootNode = {
            id: rootId,
            name: dirHandle.name,
            path: dirHandle.name,
            type: 'folder',
            sizeBytes: 0,
            subtreeSizeBytes: 0,
            modifiedAt: new Date(),
            parentId: null,
            handle: dirHandle,
            _radius: NodeTypes.radius(0, true),
        };
        this.nodes.push(rootNode);
        this.totalFolders++;

        const subtreeSize = await this._walkDir(dirHandle, rootId, dirHandle.name, onProgress);
        rootNode.subtreeSizeBytes = subtreeSize;
        rootNode._radius = NodeTypes.radius(subtreeSize, true);

        // Update all folder radii based on subtree sizes
        for (const n of this.nodes) {
            if (n.type === 'folder') {
                n._radius = NodeTypes.radius(n.subtreeSizeBytes, true);
            } else {
                n._radius = NodeTypes.radius(n.sizeBytes, false);
            }
        }

        return { nodes: this.nodes, edges: this.edges };
    },

    // ── Recursively walk a directory ────────────────────────
    async _walkDir(dirHandle, parentId, pathPrefix, onProgress) {
        let subtreeSize = 0;
        const children = [];

        try {
            for await (const [name, entry] of dirHandle.entries()) {
                // Skip hidden files/system dirs
                if (name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN') continue;
                children.push([name, entry]);
            }
        } catch (e) {
            return 0; // Permission denied for subdirectory
        }

        // Sort: folders first, then files
        children.sort(([an, ae], [bn, be]) => {
            if (ae.kind === be.kind) return an.localeCompare(bn);
            return ae.kind === 'directory' ? -1 : 1;
        });

        for (const [name, entry] of children) {
            const path = `${pathPrefix}/${name}`;
            const id = Utils.hashStr(path);
            const isDir = entry.kind === 'directory';

            if (onProgress) {
                onProgress(this.totalFiles + this.totalFolders, name);
            }

            if (isDir) {
                const folderNode = {
                    id,
                    name,
                    path,
                    type: 'folder',
                    sizeBytes: 0,
                    subtreeSizeBytes: 0,
                    modifiedAt: new Date(),
                    parentId,
                    handle: entry,
                    _radius: 16,
                };
                this.nodes.push(folderNode);
                this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                this.totalFolders++;

                const childSize = await this._walkDir(entry, id, path, onProgress);
                folderNode.subtreeSizeBytes = childSize;
                folderNode._radius = NodeTypes.radius(childSize, true);
                subtreeSize += childSize;

            } else {
                let fileSize = 0;
                let modDate = new Date();
                try {
                    const file = await entry.getFile();
                    fileSize = file.size;
                    modDate = new Date(file.lastModified);
                } catch (_) { /* ignore */ }

                const fileNode = {
                    id,
                    name,
                    path,
                    type: NodeTypes.infer(name, false),
                    sizeBytes: fileSize,
                    subtreeSizeBytes: fileSize,
                    modifiedAt: modDate,
                    parentId,
                    handle: entry,
                    _radius: NodeTypes.radius(fileSize, false),
                };
                this.nodes.push(fileNode);
                this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                this.totalFiles++;
                subtreeSize += fileSize;
            }
        }

        return subtreeSize;
    },

    // ── Demo data (fallback when FS API unavailable) ────────
    generateDemo() {
        this.nodes = [];
        this.edges = [];

        const rootId = 'root';
        const now = new Date();

        const add = (id, name, path, type, sizeBytes, parentId, modifiedAt = now) => {
            const isFolder = type === 'folder';
            const node = {
                id, name, path, type, sizeBytes,
                subtreeSizeBytes: sizeBytes,
                modifiedAt,
                parentId,
                handle: null,
                _radius: NodeTypes.radius(sizeBytes, isFolder),
            };
            this.nodes.push(node);
            if (parentId) this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
            return node;
        };

        // Root
        add('root', 'my-project', 'my-project', 'folder', 0, null);

        // Src dir
        add('src', 'src', 'my-project/src', 'folder', 0, 'root');
        add('src_app', 'App.tsx', 'my-project/src/App.tsx', 'code', 8400, 'src', new Date(Date.now() - 86400000));
        add('src_main', 'main.tsx', 'my-project/src/main.tsx', 'code', 2100, 'src');
        add('src_index', 'index.css', 'my-project/src/index.css', 'code', 3200, 'src', new Date(Date.now() - 172800000));

        // Components
        add('comp', 'components', 'my-project/src/components', 'folder', 0, 'src');
        add('c_nav', 'Navbar.tsx', 'my-project/src/components/Navbar.tsx', 'code', 5600, 'comp');
        add('c_btn', 'Button.tsx', 'my-project/src/components/Button.tsx', 'code', 2800, 'comp');
        add('c_card', 'Card.tsx', 'my-project/src/components/Card.tsx', 'code', 4200, 'comp');
        add('c_modal', 'Modal.tsx', 'my-project/src/components/Modal.tsx', 'code', 6800, 'comp');
        add('c_hero', 'Hero.tsx', 'my-project/src/components/Hero.tsx', 'code', 7200, 'comp');

        // Assets
        add('assets', 'assets', 'my-project/src/assets', 'folder', 0, 'src');
        add('a_logo', 'logo.svg', 'my-project/src/assets/logo.svg', 'image', 12400, 'assets');
        add('a_bg', 'hero-bg.webp', 'my-project/src/assets/hero-bg.webp', 'image', 482000, 'assets');
        add('a_thumb1', 'thumb1.jpg', 'my-project/src/assets/thumb1.jpg', 'image', 124000, 'assets');
        add('a_thumb2', 'thumb2.jpg', 'my-project/src/assets/thumb2.jpg', 'image', 98000, 'assets');
        add('a_thumb3', 'thumb3.png', 'my-project/src/assets/thumb3.png', 'image', 214000, 'assets');
        add('a_font', 'font.woff2', 'my-project/src/assets/font.woff2', 'unknown', 48000, 'assets');

        // Public
        add('pub', 'public', 'my-project/public', 'folder', 0, 'root');
        add('pub_vid', 'demo.mp4', 'my-project/public/demo.mp4', 'video', 18500000, 'pub', new Date(Date.now() - 604800000));
        add('pub_music', 'bg-music.mp3', 'my-project/public/bg-music.mp3', 'audio', 5400000, 'pub');
        add('pub_pdf', 'spec.pdf', 'my-project/public/spec.pdf', 'document', 1240000, 'pub');

        // Docs
        add('docs', 'docs', 'my-project/docs', 'folder', 0, 'root');
        add('d_readme', 'README.md', 'my-project/docs/README.md', 'document', 8400, 'docs');
        add('d_api', 'API.md', 'my-project/docs/API.md', 'document', 24000, 'docs');
        add('d_change', 'CHANGELOG.md', 'my-project/docs/CHANGELOG.md', 'document', 12000, 'docs');
        add('d_arch', 'architecture.pdf', 'my-project/docs/architecture.pdf', 'document', 880000, 'docs');

        // Config files
        add('pkg', 'package.json', 'my-project/package.json', 'code', 3200, 'root');
        add('tsconf', 'tsconfig.json', 'my-project/tsconfig.json', 'code', 1800, 'root');
        add('vite', 'vite.config.ts', 'my-project/vite.config.ts', 'code', 2400, 'root');
        add('eslint', '.eslintrc.json', 'my-project/.eslintrc.json', 'code', 1200, 'root');
        add('gitignore', '.gitignore', 'my-project/.gitignore', 'unknown', 800, 'root');
        add('env', '.env.example', 'my-project/.env.example', 'code', 600, 'root');

        // Dist
        add('dist', 'dist', 'my-project/dist', 'folder', 0, 'root');
        add('dist_zip', 'build.zip', 'my-project/dist/build.zip', 'archive', 8200000, 'dist');
        add('dist_gz', 'bundle.tar.gz', 'my-project/dist/bundle.tar.gz', 'archive', 4100000, 'dist');
        add('dist_js', 'main.js', 'my-project/dist/main.js', 'code', 380000, 'dist');
        add('dist_css', 'styles.css', 'my-project/dist/styles.css', 'code', 84000, 'dist');

        // Recalculate subtree sizes
        this._computeSubtreeSizes();
        this.rootName = 'my-project';
        this.totalFiles = this.nodes.filter(n => n.type !== 'folder').length;
        this.totalFolders = this.nodes.filter(n => n.type === 'folder').length;

        return { nodes: this.nodes, edges: this.edges };
    },

    _computeSubtreeSizes() {
        const nodeMap = new Map(this.nodes.map(n => [n.id, n]));
        // Leaf files propagate upwards
        const getSubtree = (id, visited = new Set()) => {
            if (visited.has(id)) return 0;
            visited.add(id);
            const n = nodeMap.get(id);
            if (!n) return 0;
            if (n.type !== 'folder') return n.sizeBytes;
            const children = this.edges.filter(e => e.source === id).map(e => e.target);
            let total = 0;
            for (const cid of children) total += getSubtree(cid, visited);
            n.subtreeSizeBytes = total;
            n._radius = NodeTypes.radius(total, true);
            return total;
        };
        const root = this.nodes.find(n => !n.parentId);
        if (root) getSubtree(root.id);
    },

    // ── Get a file's raw text content (for preview) ────────
    async readFileText(handle, maxBytes = 8000) {
        try {
            const file = await handle.getFile();
            const slice = file.slice(0, maxBytes);
            return await slice.text();
        } catch (_) { return null; }
    },

    // ── Get a file's object URL (for image/video/audio) ───
    async readFileURL(handle) {
        try {
            const file = await handle.getFile();
            return URL.createObjectURL(file);
        } catch (_) { return null; }
    },

    // ── Create Folder / File ───────────────────────────────
    async createFolder(parentId, name) {
        const parentNode = this.nodes.find(n => n.id === parentId);
        if (!parentNode || !parentNode.handle || parentNode.handle.kind !== 'directory') return null;
        try {
            const handle = await parentNode.handle.getDirectoryHandle(name, { create: true });
            return handle;
        } catch (e) {
            console.error(e);
            return null;
        }
    },

    async createFile(parentId, name) {
        const parentNode = this.nodes.find(n => n.id === parentId);
        if (!parentNode || !parentNode.handle || parentNode.handle.kind !== 'directory') return null;
        try {
            const handle = await parentNode.handle.getFileHandle(name, { create: true });
            return handle;
        } catch (e) {
            console.error(e);
            return null;
        }
    }
};
