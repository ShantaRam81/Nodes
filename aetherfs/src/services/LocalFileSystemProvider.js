/**
 * AetherFS – Local File System Provider
 * Implements the IStorageProvider interface for local PC access
 */

import { Utils } from '../core/utils.js';
import { NodeTypes } from '../core/nodeTypes.js';

export class LocalFileSystemProvider {
    constructor() {
        this.nodes = [];
        this.edges = [];
        this.rootName = '';
        this.totalFiles = 0;
        this.totalFolders = 0;
    }

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

        for (const n of this.nodes) {
            if (n.type === 'folder') {
                n._radius = NodeTypes.radius(n.subtreeSizeBytes, true);
            } else {
                n._radius = NodeTypes.radius(n.sizeBytes, false);
            }
        }

        return { nodes: this.nodes, edges: this.edges };
    }

    async _walkDir(dirHandle, parentId, pathPrefix, onProgress) {
        let subtreeSize = 0;
        const children = [];

        try {
            for await (const [name, entry] of dirHandle.entries()) {
                if (name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN') continue;
                children.push([name, entry]);
            }
        } catch (e) {
            return 0;
        }

        children.sort(([an, ae], [bn, be]) => {
            if (ae.kind === be.kind) return an.localeCompare(bn);
            return ae.kind === 'directory' ? -1 : 1;
        });

        for (const [name, entry] of children) {
            const path = `${pathPrefix}/${name}`;
            const id = Utils.hashStr(path);
            const isDir = entry.kind === 'directory';

            if (onProgress) onProgress(this.totalFiles + this.totalFolders, name);

            if (isDir) {
                const folderNode = {
                    id, name, path, type: 'folder', sizeBytes: 0, subtreeSizeBytes: 0,
                    modifiedAt: new Date(), parentId, handle: entry, _radius: 16,
                };
                this.nodes.push(folderNode);
                this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                this.totalFolders++;

                const childSize = await this._walkDir(entry, id, path, onProgress);
                folderNode.subtreeSizeBytes = childSize;
                folderNode._radius = NodeTypes.radius(childSize, true);
                subtreeSize += childSize;

            } else {
                // OPTIMIZATION: Skip getFile() during initial scan to avoid heavy I/O
                const fileSize = 0;
                const modDate = new Date();

                const fileNode = {
                    id, name, path, type: NodeTypes.infer(name, false),
                    sizeBytes: fileSize, subtreeSizeBytes: fileSize,
                    modifiedAt: modDate, parentId, handle: entry,
                    _radius: NodeTypes.radius(fileSize, false),
                };
                this.nodes.push(fileNode);
                this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                this.totalFiles++;
                subtreeSize += fileSize;
            }
        }
        return subtreeSize;
    }

    async readFileText(handle, maxBytes = 8000) {
        try {
            const file = await handle.getFile();
            return await file.slice(0, maxBytes).text();
        } catch (_) { return null; }
    }

    async readFileURL(handle) {
        try {
            return URL.createObjectURL(await handle.getFile());
        } catch (_) { return null; }
    }

    /** Get file as Blob (for single-file download or zip). Node must be a file with handle. */
    async getFileBlob(node) {
        if (!node || !node.handle || node.type === 'folder') return null;
        try {
            return await node.handle.getFile();
        } catch (e) {
            console.warn('[LocalFS] getFileBlob error:', e.message);
            return null;
        }
    }

    async createFolder(parentId, name) {
        const parentNode = this.nodes.find(n => n.id === parentId);
        if (!parentNode || !parentNode.handle || parentNode.handle.kind !== 'directory') return null;
        try { return await parentNode.handle.getDirectoryHandle(name, { create: true }); }
        catch (e) { console.error(e); return null; }
    }

    async createFile(parentId, name) {
        const parentNode = this.nodes.find(n => n.id === parentId);
        if (!parentNode || !parentNode.handle || parentNode.handle.kind !== 'directory') return null;
        try { return await parentNode.handle.getFileHandle(name, { create: true }); }
        catch (e) { console.error(e); return null; }
    }

    // New Drag and Drop File Moving API
    async moveNode(sourceNode, targetFolderNode) {
        if (!sourceNode || !sourceNode.handle) throw new Error('Source not a valid local file');
        if (!targetFolderNode || !targetFolderNode.handle || targetFolderNode.handle.kind !== 'directory') {
            throw new Error('Target is not a valid directory');
        }

        try {
            // Chrome 114+ File System API natively supports move()
            if (typeof sourceNode.handle.move === 'function') {
                await sourceNode.handle.move(targetFolderNode.handle, sourceNode.name);
                return true;
            } else {
                throw new Error('Ваш браузер не поддерживает перемещение файлов локально.');
            }
        } catch (e) {
            console.error('Failed to move local node:', e);
            throw e;
        }
    }

    generateDemo() {
        this.nodes = [];
        this.edges = [];

        const add = (id, name, path, type, sizeBytes, parentId, modifiedAt = new Date()) => {
            const node = {
                id, name, path, type, sizeBytes,
                subtreeSizeBytes: sizeBytes,
                modifiedAt,
                parentId,
                handle: null,
                _radius: NodeTypes.radius(sizeBytes, type === 'folder'),
            };
            this.nodes.push(node);
            if (parentId) this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
            return node;
        };

        add('root', 'my-project', 'my-project', 'folder', 0, null);
        add('src', 'src', 'my-project/src', 'folder', 0, 'root');
        add('src_app', 'App.tsx', 'my-project/src/App.tsx', 'code', 8400, 'src');
        add('src_main', 'main.tsx', 'my-project/src/main.tsx', 'code', 2100, 'src');
        add('comp', 'components', 'my-project/src/components', 'folder', 0, 'src');
        add('c_btn', 'Button.tsx', 'my-project/src/components/Button.tsx', 'code', 2800, 'comp');
        add('assets', 'assets', 'my-project/src/assets', 'folder', 0, 'src');
        add('a_logo', 'logo.svg', 'my-project/src/assets/logo.svg', 'image', 12400, 'assets');
        add('pub', 'public', 'my-project/public', 'folder', 0, 'root');
        add('pub_vid', 'demo.mp4', 'my-project/public/demo.mp4', 'video', 18500000, 'pub');

        this._computeSubtreeSizes();
        this.rootName = 'my-project [DEMO]';
        return { nodes: this.nodes, edges: this.edges };
    }

    _computeSubtreeSizes() {
        const nodeMap = new Map(this.nodes.map(n => [n.id, n]));
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
    }
}
