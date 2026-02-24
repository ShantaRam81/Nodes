/**
 * AetherFS – Dropbox Storage Provider
 * Full CRUD operations via Dropbox API v2
 */

import { Utils } from '../core/utils.js';
import { NodeTypes } from '../core/nodeTypes.js';
import { DropboxAuth } from './DropboxAuth.js';

const API_BASE = 'https://api.dropboxapi.com/2';
const CONTENT_BASE = 'https://content.dropboxapi.com/2';
const MAX_RETRIES = 3;

/** Config file in Dropbox root: stores node path → tag for persistence across reloads and devices */
export const AETHERFS_TAGS_PATH = '/aetherfs-tags.json';

export class DropboxProvider {
    constructor() {
        this.nodes = [];
        this.edges = [];
        this.rootName = '';
        this.totalFiles = 0;
        this.totalFolders = 0;
        this._pathMap = new Map(); // path -> node
    }

    // ── Core API helper with retry & rate limiting ─────────
    async _apiCall(endpoint, body = {}, { isContent = false, isUpload = false, rawBody = null } = {}) {
        const token = await DropboxAuth.getAccessToken();
        if (!token) throw new Error('Не авторизован в Dropbox');

        const base = isContent ? CONTENT_BASE : API_BASE;
        let lastError;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const headers = {
                    'Authorization': `Bearer ${token}`,
                };

                let fetchBody;
                if (isUpload) {
                    // Dropbox-API-Arg must be ASCII-safe; escape non-ASCII chars
                    headers['Dropbox-API-Arg'] = this._asciiSafeJson(body);
                    headers['Content-Type'] = 'application/octet-stream';
                    fetchBody = rawBody || new Uint8Array(0);
                } else if (isContent) {
                    headers['Dropbox-API-Arg'] = this._asciiSafeJson(body);
                    fetchBody = null;
                } else {
                    headers['Content-Type'] = 'application/json';
                    fetchBody = JSON.stringify(body);
                }

                console.log(`[Dropbox API] POST ${endpoint}`, body);

                const res = await fetch(`${base}${endpoint}`, {
                    method: 'POST',
                    headers,
                    body: fetchBody,
                });

                // Rate limited
                if (res.status === 429) {
                    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
                    console.warn(`Dropbox rate limited, retry after ${retryAfter}s`);
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
                    console.error(`[Dropbox API] ${endpoint} → ${res.status}:`, errText);
                    // Don't retry client errors (4xx)
                    throw new Error(`Dropbox API Error ${res.status}: ${errText}`);
                }

                // For content downloads, return blob/text
                if (isContent && !isUpload) {
                    return { response: res, meta: JSON.parse(res.headers.get('dropbox-api-result') || '{}') };
                }

                return await res.json();
            } catch (e) {
                lastError = e;
                // Only retry on network errors, not API errors (4xx)
                const isNetworkError = !e.message?.includes('Dropbox API Error');
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

    // Encode JSON to ASCII-safe string for Dropbox-API-Arg header
    // Dropbox requires this header to be pure ASCII; non-ASCII chars must be \uXXXX escaped
    _asciiSafeJson(obj) {
        return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (ch) => {
            return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
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
        const rootId = Utils.hashStr('dropbox_root');
        const rootNode = {
            id: rootId,
            name: 'Dropbox',
            path: '',
            type: 'folder',
            sizeBytes: 0,
            subtreeSizeBytes: 0,
            modifiedAt: new Date(),
            parentId: null,
            handle: null,
            _radius: NodeTypes.radius(0, true),
            _dbxPath: '', // Dropbox path (empty = root)
        };
        this.nodes.push(rootNode);
        this._pathMap.set('', rootNode);
        this.totalFolders++;

        // Load root folder contents
        await this._loadFolder('', rootId, onProgress);

        // Размеры папок (subtreeSizeBytes) для карты и отображения
        this._computeSubtreeSizes();

        this.rootName = 'Dropbox ☁';
        return { nodes: this.nodes, edges: this.edges };
    }

    async _loadFolder(dbxPath, parentId, onProgress, depth = 0) {
        // For root level, use recursive=true to get ALL entries in one batch
        const useRecursive = (depth === 0);

        // Collect all entries (handles pagination)
        const allEntries = [];
        let cursor = null;
        let hasMore = true;

        while (hasMore) {
            let result;
            if (cursor) {
                result = await this._apiCall('/files/list_folder/continue', { cursor });
            } else {
                result = await this._apiCall('/files/list_folder', {
                    path: dbxPath === '' ? '' : dbxPath,
                    recursive: useRecursive,
                    include_media_info: false,
                    include_deleted: false,
                    limit: 2000,
                });
            }
            allEntries.push(...result.entries);
            cursor = result.cursor;
            hasMore = result.has_more;
            if (onProgress) onProgress(allEntries.length, `${allEntries.length} элементов...`);
        }

        if (useRecursive) {
            // Sort entries: folders first, then by path depth
            allEntries.sort((a, b) => {
                const aIsDir = a['.tag'] === 'folder' ? 0 : 1;
                const bIsDir = b['.tag'] === 'folder' ? 0 : 1;
                if (aIsDir !== bIsDir) return aIsDir - bIsDir;
                return a.path_display.split('/').length - b.path_display.split('/').length;
            });

            // Process all entries with correct parent resolution
            for (const entry of allEntries) {
                const entryPath = entry.path_display;
                const name = entry.name;
                const id = Utils.hashStr(entryPath);
                const isDir = entry['.tag'] === 'folder';

                // Resolve parent from path
                const parentPath = entryPath.substring(0, entryPath.lastIndexOf('/'));
                const parentNode = this._pathMap.get(parentPath) || this._pathMap.get('');
                const pId = parentNode ? parentNode.id : parentId;

                if (onProgress) onProgress(this.totalFiles + this.totalFolders, name);

                if (isDir) {
                    if (this._pathMap.has(entryPath)) continue; // skip duplicates
                    const folderNode = {
                        id, name, path: entryPath, type: 'folder',
                        sizeBytes: 0, subtreeSizeBytes: 0,
                        modifiedAt: new Date(),
                        parentId: pId, handle: null,
                        _radius: 16,
                        _dbxPath: entryPath,
                    };
                    this.nodes.push(folderNode);
                    this.edges.push({ id: `${pId}-${id}`, source: pId, target: id });
                    this._pathMap.set(entryPath, folderNode);
                    this.totalFolders++;
                } else {
                    const fileSize = entry.size || 0;
                    const modDate = entry.client_modified ? new Date(entry.client_modified) : new Date();
                    const fileNode = {
                        id, name, path: entryPath,
                        type: NodeTypes.infer(name, false),
                        sizeBytes: fileSize, subtreeSizeBytes: fileSize,
                        modifiedAt: modDate, parentId: pId, handle: null,
                        _radius: NodeTypes.radius(fileSize, false),
                        _dbxPath: entryPath,
                    };
                    this.nodes.push(fileNode);
                    this.edges.push({ id: `${pId}-${id}`, source: pId, target: id });
                    this._pathMap.set(entryPath, fileNode);
                    this.totalFiles++;
                }
            }
        } else {
            // Non-root fallback: manual recursion (depth > 0)
            for (const entry of allEntries) {
                const entryPath = entry.path_display;
                const name = entry.name;
                const id = Utils.hashStr(entryPath);
                const isDir = entry['.tag'] === 'folder';

                if (onProgress) onProgress(this.totalFiles + this.totalFolders, name);

                if (isDir) {
                    const folderNode = {
                        id, name, path: entryPath, type: 'folder',
                        sizeBytes: 0, subtreeSizeBytes: 0,
                        modifiedAt: new Date(),
                        parentId, handle: null,
                        _radius: 16,
                        _dbxPath: entryPath,
                    };
                    this.nodes.push(folderNode);
                    this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                    this._pathMap.set(entryPath, folderNode);
                    this.totalFolders++;
                    await this._loadFolder(entryPath, id, onProgress, depth + 1);
                } else {
                    const fileSize = entry.size || 0;
                    const modDate = entry.client_modified ? new Date(entry.client_modified) : new Date();
                    const fileNode = {
                        id, name, path: entryPath,
                        type: NodeTypes.infer(name, false),
                        sizeBytes: fileSize, subtreeSizeBytes: fileSize,
                        modifiedAt: modDate, parentId, handle: null,
                        _radius: NodeTypes.radius(fileSize, false),
                        _dbxPath: entryPath,
                    };
                    this.nodes.push(fileNode);
                    this.edges.push({ id: `${parentId}-${id}`, source: parentId, target: id });
                    this._pathMap.set(entryPath, fileNode);
                    this.totalFiles++;
                }
            }
        }
    }

    // ── Read file content ──────────────────────────────────
    async readFileText(handle, maxBytes = 8000) {
        // handle is unused for Dropbox; use the node's _dbxPath
        // The caller should pass the node itself or we find by path
        const node = typeof handle === 'string' ? this._pathMap.get(handle) : handle;
        if (!node || !node._dbxPath) return null;

        try {
            const { response } = await this._apiCall('/files/download', { path: node._dbxPath }, { isContent: true });
            const text = await response.text();
            return text.slice(0, maxBytes);
        } catch (_) { return null; }
    }

    async readFileURL(handle) {
        const node = typeof handle === 'string' ? this._pathMap.get(handle) : handle;
        if (!node || !node._dbxPath) return null;

        try {
            // Get a temporary download link (valid for 4 hours)
            const result = await this._apiCall('/files/get_temporary_link', { path: node._dbxPath });
            return result.link;
        } catch (_) { return null; }
    }

    /** Download file content as Blob (for single-file download or zip). Node must be a file. */
    async getFileBlob(node) {
        if (!node || !node._dbxPath || node.type === 'folder') return null;
        try {
            const { response } = await this._apiCall('/files/download', { path: node._dbxPath }, { isContent: true });
            return await response.blob();
        } catch (e) {
            console.warn('[Dropbox] getFileBlob error:', e.message);
            return null;
        }
    }

    // ── Tags config (file in Dropbox root) ──────────────────
    /** Load tags config from /aetherfs-tags.json. Returns { pathToTag: { path: tag } } or null if missing. */
    async readTagsConfig() {
        try {
            const { response } = await this._apiCall('/files/download', { path: AETHERFS_TAGS_PATH }, { isContent: true });
            const text = await response.text();
            const data = JSON.parse(text);
            if (data && typeof data.pathToTag === 'object') return data;
            return { pathToTag: {} };
        } catch (e) {
            if (e.message && (e.message.includes('not_found') || e.message.includes('404') || e.message.includes('409'))) return null;
            console.warn('[Dropbox] readTagsConfig error:', e.message);
            return null;
        }
    }

    /** Save tags config to /aetherfs-tags.json. payload = { pathToTag: { path: tag } }. */
    async writeTagsConfig(payload) {
        const body = new TextEncoder().encode(JSON.stringify(payload, null, 2));
        await this._apiCall('/files/upload', {
            path: AETHERFS_TAGS_PATH,
            mode: 'overwrite',
            autorename: false,
            mute: true,
        }, { isContent: true, isUpload: true, rawBody: body });
    }

    // ── Create ─────────────────────────────────────────────
    async createFolder(parentIdOrPath, name) {
        let newPath;
        if (name === undefined) {
            newPath = parentIdOrPath; // passed absolute path
        } else {
            const parent = this.nodes.find(n => n.id === parentIdOrPath);
            if (!parent) return null;
            newPath = (parent._dbxPath || '') + '/' + name;
        }

        try {
            const result = await this._apiCall('/files/create_folder_v2', { path: newPath, autorename: false });
            return result.metadata;
        } catch (e) {
            console.error('Dropbox createFolder error:', e);
            return null;
        }
    }

    async createFile(parentIdOrPath, name) {
        let newPath;
        if (name === undefined) {
            newPath = parentIdOrPath; // passed absolute path
        } else {
            const parent = this.nodes.find(n => n.id === parentIdOrPath);
            if (!parent) return null;
            newPath = (parent._dbxPath || '') + '/' + name;
        }

        try {
            const result = await this._apiCall('/files/upload', {
                path: newPath,
                mode: 'add',
                autorename: false,
                mute: false,
            }, { isContent: true, isUpload: true, rawBody: new Uint8Array(0) });
            return result;
        } catch (e) {
            console.error('Dropbox createFile error:', e);
            return null;
        }
    }

    // ── Move / Rename ──────────────────────────────────────
    async moveNode(sourceNode, targetFolderNode) {
        if (!sourceNode._dbxPath) throw new Error('Source node has no Dropbox path');
        if (!targetFolderNode) throw new Error('Target folder is invalid');

        const targetPath = (targetFolderNode._dbxPath || '') + '/' + sourceNode.name;
        try {
            const result = await this._apiCall('/files/move_v2', {
                from_path: sourceNode._dbxPath,
                to_path: targetPath,
                autorename: false,
                allow_ownership_transfer: false,
            });

            // Update internal path
            sourceNode._dbxPath = result.metadata.path_display;
            sourceNode.path = result.metadata.path_display;
            return true;
        } catch (e) {
            console.error('Dropbox move error:', e);
            throw e;
        }
    }

    async renameNode(node, newName) {
        if (!node._dbxPath) throw new Error('Node has no Dropbox path');

        const parts = node._dbxPath.split('/');
        parts[parts.length - 1] = newName;
        const newPath = parts.join('/');

        try {
            const result = await this._apiCall('/files/move_v2', {
                from_path: node._dbxPath,
                to_path: newPath,
                autorename: false,
            });

            node._dbxPath = result.metadata.path_display;
            node.path = result.metadata.path_display;
            node.name = newName;
            return true;
        } catch (e) {
            console.error('Dropbox rename error:', e);
            throw e;
        }
    }

    // ── Delete ─────────────────────────────────────────────
    async deleteNode(node) {
        if (!node._dbxPath) throw new Error('Node has no Dropbox path');

        try {
            await this._apiCall('/files/delete_v2', { path: node._dbxPath });
            return true;
        } catch (e) {
            console.error('Dropbox delete error:', e);
            throw e;
        }
    }

    // ── Copy ───────────────────────────────────────────────
    async copyNode(node, targetFolderNode) {
        if (!node._dbxPath) throw new Error('Source has no Dropbox path');

        const targetPath = (targetFolderNode._dbxPath || '') + '/' + node.name;
        try {
            const result = await this._apiCall('/files/copy_v2', {
                from_path: node._dbxPath,
                to_path: targetPath,
                autorename: true,
            });
            return result.metadata;
        } catch (e) {
            console.error('Dropbox copy error:', e);
            throw e;
        }
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

    // ── Demo (not applicable for Dropbox, kept for interface compat)
    generateDemo() {
        throw new Error('Dropbox provider does not support demo mode');
    }

    // ── Upload file from desktop ──────────────────────────
    async uploadFile(path, file) {
        const buffer = await file.arrayBuffer();
        return this._apiCall('/files/upload', {
            path: path,
            mode: 'add',
            autorename: true,
            mute: false
        }, { isContent: true, isUpload: true, rawBody: buffer });
    }

    // ── File version history ──────────────────────────────
    async getRevisions(path, limit = 10) {
        try {
            return await this._apiCall('/files/list_revisions', {
                path: path,
                mode: { '.tag': 'path' },
                limit: limit
            });
        } catch (e) {
            console.warn('Dropbox getRevisions error:', e);
            return { entries: [] };
        }
    }
}
