/**
 * AetherFS – Yandex Disk Storage Provider
 * Implements the StorageProvider interface using Yandex Disk REST API
 */

import { Utils } from '../core/utils.js';
import { NodeTypes } from '../core/nodeTypes.js';
import { YandexAuth } from './YandexAuth.js';
import { StorageProvider } from './StorageProvider.js';

const API_BASE = 'https://cloud-api.yandex.net/v1/disk';
const MAX_RETRIES = 3;
const DEBUG_API = import.meta.env?.DEV === true;

export const AETHERFS_TAGS_PATH = 'disk:/aetherfs-tags.json';

export class YandexProvider extends StorageProvider {
    constructor() {
        super('yandex');
    }

    // ── Core API helper with retry & rate limiting ─────────
    async _apiCall(endpoint, options = {}) {
        const token = YandexAuth.getAccessToken();
        if (!token) throw new Error('Не авторизован в Яндекс Диске');

        let lastError;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const headers = {
                    'Authorization': `OAuth ${token}`,
                };

                // Add any extra headers from options, safely converting them to ASCII
                if (options.headers) {
                    for (const [k, v] of Object.entries(options.headers)) {
                        headers[k] = this._asciiSafeJson(v);
                    }
                }

                if (DEBUG_API && !options.isUpload) console.log(`[Yandex API] ${options.method || 'GET'} ${endpoint}`);

                const fetchOptions = {
                    method: options.method || 'GET',
                    headers,
                    body: options.body,
                };

                const res = await fetch(`${API_BASE}${endpoint}`, fetchOptions);

                // Rate limited (although Yandex usually uses other codes, 429 is standard)
                if (res.status === 429) {
                    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
                    console.warn(`Yandex rate limited, retry after ${retryAfter}s`);
                    await this._sleep(retryAfter * 1000);
                    continue;
                }

                // Server error — retry with exponential backoff
                if (res.status >= 500) {
                    await this._sleep(Math.pow(2, attempt) * 1000);
                    continue;
                }

                if (!res.ok) {
                    const errText = await res.text();
                    console.error(`[Yandex API] ${endpoint} → ${res.status}:`, errText);
                    throw new Error(`Yandex API Error ${res.status}: ${errText}`);
                }

                // For content downloads, return blob/text directly
                if (options.isContent) {
                    return res;
                }

                // Some endpoints (like delete/move) return empty body on 204/201
                const contentLength = res.headers.get('content-length');
                if (contentLength === '0' || res.status === 204 || res.status === 201) return null;

                try {
                    return await res.json();
                } catch (e) {
                    return null;
                }
            } catch (e) {
                lastError = e;
                const isNetworkError = !e.message?.includes('Yandex API Error');
                if (attempt < MAX_RETRIES - 1 && isNetworkError && e.name !== 'AbortError') {
                    await this._sleep(Math.pow(2, attempt) * 1000);
                } else {
                    throw e;
                }
            }
        }
        throw lastError;
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    _asciiSafeJson(data) {
        if (typeof data !== 'string') data = JSON.stringify(data);
        return data.replace(/[\u007F-\uFFFF]/g, chr => {
            return '\\u' + ('0000' + chr.charCodeAt(0).toString(16)).substr(-4);
        });
    }

    // ── Browse / Load ──────────────────────────────────────
    async openDirectory(onProgress) {
        this.nodes = [];
        this.edges = [];
        this._pathMap = new Map();
        this.totalFiles = 0;
        this.totalFolders = 0;

        // Root node
        const rootId = Utils.hashStr('yandex_root');
        const rootNode = {
            id: rootId,
            name: 'Яндекс Диск',
            path: '',
            type: 'folder',
            sizeBytes: 0,
            subtreeSizeBytes: 0,
            modifiedAt: new Date(),
            parentId: null,
            handle: null,
            _radius: NodeTypes.radius(0, true),
            _dbxPath: 'disk:/', // Yandex path root
        };
        this.nodes.push(rootNode);
        this._pathMap.set('disk:/', rootNode);
        this.totalFolders++;

        // Load root folder contents recursively
        // Note: Yandex Disk API has a flat file list endpoint (/resources/files) 
        // but it doesn't include empty folders. 
        // We will use standard traversal but parallelize it if possible.
        // For now, doing it via recursive /resources calls.
        await this._loadFolder('disk:/', rootId, onProgress, 0);

        this._computeSubtreeSizes();

        this.rootName = 'Яндекс Диск ☁';
        return { nodes: this.nodes, edges: this.edges };
    }

    async _loadFolder(yaPath, parentId, onProgress, depth = 0) {
        let offset = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            const endpoint = `/resources?path=${encodeURIComponent(yaPath)}&limit=${limit}&offset=${offset}`;
            const result = await this._apiCall(endpoint);

            if (!result || !result._embedded) break;

            const items = result._embedded.items;
            if (items.length === 0) break;

            // Sort folders first
            items.sort((a, b) => {
                const aIsDir = a.type === 'dir' ? 0 : 1;
                const bIsDir = b.type === 'dir' ? 0 : 1;
                return aIsDir - bIsDir;
            });

            for (const item of items) {
                const isDir = item.type === 'dir';
                const name = item.name;
                const pathDisplay = item.path; // e.g. "disk:/Folder/File.txt"
                const id = Utils.hashStr(pathDisplay);

                if (onProgress) onProgress(this.totalFiles + this.totalFolders, name);

                if (isDir) {
                    const folderNode = {
                        id, name, path: pathDisplay, type: 'folder',
                        sizeBytes: 0, subtreeSizeBytes: 0,
                        modifiedAt: item.modified ? new Date(item.modified) : new Date(),
                        parentId, handle: null,
                        _radius: 16,
                        _dbxPath: pathDisplay,
                    };
                    this.nodes.push(folderNode);
                    this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                    this._pathMap.set(pathDisplay, folderNode);
                    this.totalFolders++;

                    // Recursive call
                    await this._loadFolder(pathDisplay, id, onProgress, depth + 1);
                } else {
                    const fileSize = item.size || 0;
                    const fileNode = {
                        id, name, path: pathDisplay,
                        type: NodeTypes.infer(name, false),
                        sizeBytes: fileSize, subtreeSizeBytes: fileSize,
                        modifiedAt: item.modified ? new Date(item.modified) : new Date(),
                        parentId, handle: null,
                        _radius: NodeTypes.radius(fileSize, false),
                        _dbxPath: pathDisplay, // We use _dbxPath as the generic "remote path" for compatibility
                        _yaUrl: item.file // Temporary download URL if available directly
                    };
                    this.nodes.push(fileNode);
                    this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                    this._pathMap.set(pathDisplay, fileNode);
                    this.totalFiles++;
                }
            }

            offset += limit;
            hasMore = items.length === limit;
        }
    }

    // ── Read file content ──────────────────────────────────
    async readFileText(handle, maxBytes = 8000) {
        const node = typeof handle === 'string' ? this._pathMap.get(handle) : handle;
        if (!node || !node._dbxPath) return null;

        try {
            const url = await this._getDownloadUrl(node._dbxPath);
            if (!url) return null;

            const res = await fetch(url);
            const text = await res.text();
            return text.slice(0, maxBytes);
        } catch (_) { return null; }
    }

    async readFileURL(handle) {
        const node = typeof handle === 'string' ? this._pathMap.get(handle) : handle;
        if (!node || !node._dbxPath) return null;

        try {
            const url = await this._getDownloadUrl(node._dbxPath);
            return url;
        } catch (_) { return null; }
    }

    async getFileBlob(node) {
        if (!node || !node._dbxPath || node.type === 'folder') return null;
        try {
            const url = await this._getDownloadUrl(node._dbxPath);
            if (!url) return null;

            const res = await fetch(url);
            return await res.blob();
        } catch (e) {
            console.warn('[Yandex] getFileBlob error:', e.message);
            return null;
        }
    }

    async _getDownloadUrl(path) {
        try {
            const result = await this._apiCall(`/resources/download?path=${encodeURIComponent(path)}`);
            return result.href; // The direct download link
        } catch (e) {
            return null;
        }
    }

    // ── Tags config (file in Yandex root) ──────────────────
    async readTagsConfig() {
        try {
            const url = await this._getDownloadUrl(AETHERFS_TAGS_PATH);
            if (!url) return { pathToTag: {} };

            const res = await fetch(url);
            const text = await res.text();
            const data = JSON.parse(text);
            if (data && typeof data.pathToTag === 'object') return data;
            return { pathToTag: {} };
        } catch (e) {
            console.warn('[Yandex] readTagsConfig error:', e.message);
            return null;
        }
    }

    async writeTagsConfig(payload) {
        const body = new TextEncoder().encode(JSON.stringify(payload, null, 2));

        // 1. Get upload URL
        const uploadInfo = await this._apiCall(`/resources/upload?path=${encodeURIComponent(AETHERFS_TAGS_PATH)}&overwrite=true`);
        if (!uploadInfo || !uploadInfo.href) throw new Error('Could not get upload URL for tags config');

        // 2. Upload to that URL (no auth header needed for this specific URL)
        await fetch(uploadInfo.href, {
            method: uploadInfo.method || 'PUT',
            body: body
        });
    }

    // ── Create ─────────────────────────────────────────────
    async createFolder(parentIdOrPath, name) {
        let newPath;
        if (name === undefined) {
            newPath = parentIdOrPath;
        } else {
            const parent = this.nodes.find(n => n.id === parentIdOrPath);
            if (!parent) return null;
            newPath = (parent._dbxPath === 'disk:/' ? 'disk:/' : parent._dbxPath + '/') + name;
        }

        try {
            await this._apiCall(`/resources?path=${encodeURIComponent(newPath)}`, { method: 'PUT' });
            return { path_display: newPath, name: name };
        } catch (e) {
            console.error('Yandex createFolder error:', e);
            return null;
        }
    }

    async createFile(parentIdOrPath, name) {
        let newPath;
        if (name === undefined) {
            newPath = parentIdOrPath;
        } else {
            const parent = this.nodes.find(n => n.id === parentIdOrPath);
            if (!parent) return null;
            newPath = (parent._dbxPath === 'disk:/' ? 'disk:/' : parent._dbxPath + '/') + name;
        }

        try {
            const uploadInfo = await this._apiCall(`/resources/upload?path=${encodeURIComponent(newPath)}`);
            if (!uploadInfo || !uploadInfo.href) return null;

            await fetch(uploadInfo.href, {
                method: uploadInfo.method || 'PUT',
                body: new Uint8Array(0)
            });
            return {};
        } catch (e) {
            console.error('Yandex createFile error:', e);
            return null;
        }
    }

    // ── Move / Rename ──────────────────────────────────────
    async moveNode(sourceNode, targetFolderNode) {
        if (!sourceNode._dbxPath) throw new Error('Source node has no path');
        if (!targetFolderNode) throw new Error('Target folder is invalid');

        const targetPath = (targetFolderNode._dbxPath === 'disk:/' ? 'disk:/' : targetFolderNode._dbxPath + '/') + sourceNode.name;
        try {
            await this._apiCall(`/resources/move?from=${encodeURIComponent(sourceNode._dbxPath)}&path=${encodeURIComponent(targetPath)}`, { method: 'POST' });

            sourceNode._dbxPath = targetPath;
            sourceNode.path = targetPath;
            return true;
        } catch (e) {
            console.error('Yandex move error:', e);
            throw e;
        }
    }

    async renameNode(node, newName) {
        if (!node._dbxPath) throw new Error('Node has no path');

        const parts = node._dbxPath.split('/');
        parts[parts.length - 1] = newName;
        const newPath = parts.join('/');

        try {
            await this._apiCall(`/resources/move?from=${encodeURIComponent(node._dbxPath)}&path=${encodeURIComponent(newPath)}`, { method: 'POST' });

            node._dbxPath = newPath;
            node.path = newPath;
            node.name = newName;
            return true;
        } catch (e) {
            console.error('Yandex rename error:', e);
            throw e;
        }
    }

    // ── Delete ─────────────────────────────────────────────
    async deleteNode(node) {
        if (!node._dbxPath) throw new Error('Node has no path');

        try {
            await this._apiCall(`/resources?path=${encodeURIComponent(node._dbxPath)}&permanently=true`, { method: 'DELETE' });
            return true;
        } catch (e) {
            console.error('Yandex delete error:', e);
            throw e;
        }
    }

    // ── Copy ───────────────────────────────────────────────
    async copyNode(node, targetFolderNode) {
        if (!node._dbxPath) throw new Error('Source has no path');

        const targetPath = (targetFolderNode._dbxPath === 'disk:/' ? 'disk:/' : targetFolderNode._dbxPath + '/') + node.name;
        try {
            await this._apiCall(`/resources/copy?from=${encodeURIComponent(node._dbxPath)}&path=${encodeURIComponent(targetPath)}`, { method: 'POST' });
            return { path_display: targetPath, name: node.name };
        } catch (e) {
            console.error('Yandex copy error:', e);
            throw e;
        }
    }

    // ── Upload file ────────────────────────────────────────
    async uploadFile(path, file) {
        const uploadInfo = await this._apiCall(`/resources/upload?path=${encodeURIComponent(path)}&overwrite=true`);
        if (!uploadInfo || !uploadInfo.href) throw new Error('Could not get upload URL');

        const buffer = await file.arrayBuffer();
        await fetch(uploadInfo.href, {
            method: uploadInfo.method || 'PUT',
            body: buffer
        });
    }

    // ── Subtree computation ────────────────────────────────
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
