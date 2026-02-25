/**
 * AetherFS – Main Application Controller
 * Phase 4 Modular Version
 */

import { Utils } from '../core/utils.js';
import { NodeTypes } from '../core/nodeTypes.js';
import { graphStore } from '../core/graphStore.js';
import { ForceLayout } from '../render/forceLayout.js';
import { Renderer } from '../render/renderer.js';
import { Search } from './search.js';
import { ActivityLog } from './activityLog.js';
import { Upload } from './upload.js';
import { Timeline } from './timeline.js';
import { Sidebar } from './sidebar.js';
import { LocalFileSystemProvider } from '../services/LocalFileSystemProvider.js';
import { DropboxProvider } from '../services/DropboxProvider.js';
import { DropboxAuth } from '../services/DropboxAuth.js';
import JSZip from 'jszip';

let storage = new LocalFileSystemProvider();
let isDropboxMode = false;

const App = {
    getStorage() { return storage; },
    isDropboxMode() { return isDropboxMode; },
    _nodes: [],
    _edges: [],
    _nodeMap: new Map(),
    _selectedNode: null,
    _heatmapOn: false,
    _revokableURLs: [],
    _ctxTargetId: null,
    _clusterMode: 'strict',
    _filesVisible: false,
    _groupingEnabled: true,
    _groupedFolders: new Set(),    // Per-folder grouping: set of folder IDs to group
    _nodeComments: new Map(),      // nodeId -> comment string
    _favorites: new Set(),         // Set of favored node IDs
    _theme: 'dark',

    init() {
        window.AetherApp = this; // Export to global for inline HTML handlers
        const appHooks = {
            onNodeSelect: (id) => this.onNodeSelect(id),
            onContextMenu: (x, y, id) => this.showContextMenu(x, y, id),
            onConnectionDrop: (srcNode, cx, cy, wx, wy) => this.onConnectionDrop(srcNode, cx, cy, wx, wy),
            onNodeMoveAttempt: (srcNode, tgtFolder) => this.handleNodeMove(srcNode, tgtFolder),
            getFavorites: () => this._favorites,
            onShowMoveCopyMenu: (nodes, targetFolder, clientX, clientY) => this.showMoveCopyMenu(nodes, targetFolder, clientX, clientY),
        };

        Renderer.init('aether-canvas', 'minimap-canvas', appHooks);
        Renderer.setFilesVisible(this._filesVisible);
        this.bindEvents();

        // Restore theme from localStorage
        const savedTheme = localStorage.getItem('aetherfs-theme') || 'dark';
        this._theme = savedTheme;
        document.documentElement.dataset.theme = this._theme;
        const themeBtn = Utils.el('btn-toggle-theme');
        if (themeBtn) themeBtn.textContent = this._theme === 'dark' ? '☀' : '🌙';

        // Handle Dropbox OAuth callback if returning from authorization
        this._handleDropboxCallback();

        // Load saved comments from localStorage
        this._loadComments();

        // Load favorites
        this._loadFavorites();

        // Activity log panel (таймер времени только когда панель открыта)
        Utils.el('btn-close-activity-log')?.addEventListener('click', () => this.toggleActivityLog());
        this._logTimeInterval = null;
    },

    toggleActivityLog() {
        ActivityLog.togglePanel();
        const visible = ActivityLog.isPanelVisible();
        const btn = Utils.el('btn-activity-log');
        if (btn) btn.classList.toggle('active', visible);
        if (visible && !this._logTimeInterval) {
            this._logTimeInterval = setInterval(() => {
                if (!ActivityLog.isPanelVisible()) return;
                const el = Utils.el('activity-log-time');
                if (el) el.textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            }, 1000);
        } else if (!visible && this._logTimeInterval) {
            clearInterval(this._logTimeInterval);
            this._logTimeInterval = null;
        }
    },

    async _handleDropboxCallback() {
        const params = new URLSearchParams(window.location.search);
        if (params.has('code')) {
            this._showLoading('АВТОРИЗАЦИЯ DROPBOX…');
            const success = await DropboxAuth.handleCallback();
            if (success) {
                Utils.toast('Dropbox подключен!', 'success', 2000);
                await this._openDropbox();
            } else {
                this._hideLoading();
                Utils.toast('Ошибка авторизации Dropbox', 'error', 3000);
            }
        }
    },

    bindEvents() {
        document.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT') return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); this.openSearch(); }
            if (e.key === 'Escape') {
                this.closeSearch(null);
                this.closePreview();
                Utils.hide(Utils.el('context-menu'));
                Utils.hide(Utils.el('create-menu'));
            }
            if (e.key === 'h' || e.key === 'H') this.toggleHeatmap();
            if (e.key === 'f' || e.key === 'F') Renderer.fitView();
        });

        // Click outside context menu to close
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                Utils.hide(Utils.el('context-menu'));
                Utils.hide(Utils.el('create-menu'));
        // Layout Buttons
        document.querySelectorAll('.cluster-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                document.querySelectorAll('.cluster-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.setLayoutMode(mode);
            });
        });

        // Layout Buttons
        document.querySelectorAll('.cluster-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                document.querySelectorAll('.cluster-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.setLayoutMode(mode);
            });
        });

        // Layout Buttons
        document.querySelectorAll('.cluster-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                document.querySelectorAll('.cluster-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.setLayoutMode(mode);
            });
        });

            }
        });

        // Canvas Handlers
        Renderer.canvas?.addEventListener('dblclick', (e) => {
            const w = Renderer.screenToWorld(e.offsetX, e.offsetY);
            const hit = Renderer.hitTest(w.x, w.y);
            if (hit && hit.type === 'folder') this.toggleCollapse(hit.id);
        });

        // Search Handlers
        Utils.el('search-input')?.addEventListener('input', (e) => this._onSearchInput(e.target.value));
        Utils.el('search-overlay')?.addEventListener('click', (e) => this.closeSearch(e));
        Utils.el('btn-search')?.addEventListener('click', () => this.openSearch());

        // UI Buttons
        Utils.el('btn-open-dir')?.addEventListener('click', () => this.openDirectory());
        Utils.el('btn-load-demo')?.addEventListener('click', () => this.loadDemo());
        Utils.el('btn-go-home')?.addEventListener('click', () => this.goHome());
        Utils.el('btn-close-app')?.addEventListener('click', () => this.goHome());
        Utils.el('btn-heatmap')?.addEventListener('click', () => this.toggleHeatmap());
        Utils.el('btn-fit')?.addEventListener('click', () => Renderer.fitView());
        Utils.el('btn-reset-layout')?.addEventListener('click', () => this.resetLayoutToStrict());
        Utils.el('btn-toggle-files')?.addEventListener('click', () => this.toggleFilesVisibility());
        Utils.el('btn-connect-dropbox')?.addEventListener('click', () => this.connectDropbox());

        // Zoom
        Utils.el('btn-zoom-in')?.addEventListener('click', () => Renderer.zoom(1.3));
        Utils.el('btn-zoom-out')?.addEventListener('click', () => Renderer.zoom(0.77));
        Utils.el('btn-zoom-fit')?.addEventListener('click', () => Renderer.fitView());

        // Preview
        Utils.el('btn-close-preview')?.addEventListener('click', () => this.closePreview());

        // ── Hotkeys ──────────────────────────────────────
        window.addEventListener('keydown', (e) => {
            // Delete selected nodes
            if (e.key === 'Delete' && (Renderer._selectedId || Renderer._selectedIds.size > 0)) {
                const ids = new Set(Renderer._selectedIds);
                if (Renderer._selectedId) ids.add(Renderer._selectedId);
                if (ids.size === 0) return;
                const names = [...ids].map(id => this._nodeMap.get(id)?.name).filter(Boolean).join(', ');
                if (!confirm(`Удалить ${ids.size} элемент(ов)?\n${names}`)) return;
                for (const id of ids) {
                    const node = this._nodeMap.get(id);
                    if (!node) continue;
                    const descendants = new Set();
                    const collect = (nid) => { descendants.add(nid); this._edges.filter(e2 => e2.source === nid).forEach(e2 => collect(e2.target)); };
                    collect(node.id);
                    this._nodes = this._nodes.filter(n => !descendants.has(n.id));
                    this._edges = this._edges.filter(e2 => !descendants.has(e2.source) && !descendants.has(e2.target));
                    this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));
                    if (isDropboxMode && storage.deleteNode) storage.deleteNode(node).catch(() => { });
                }
                Renderer._selectedIds.clear();
                Renderer._selectedId = null;
                this._applyGraph(0.4);
                Utils.toast(`Удалено: ${ids.size} элемент(ов)`, 'success');
                e.preventDefault();
            }
            // Ctrl+A: select all
            if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                Renderer._selectedIds.clear();
                for (const n of this._nodes) Renderer._selectedIds.add(n.id);
                Renderer.markDirty();
                Utils.toast(`Выделено: ${this._nodes.length}`, 'info', 1000);
            }
            // Ctrl+E: export graph
            if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.exportGraph();
            }
            if (e.key === 'b' && (e.ctrlKey || e.metaKey) && Renderer._selectedId) {
                e.preventDefault();
                const node = this._nodeMap.get(Renderer._selectedId);
                if (node) {
                    this._ctxTargetId = node.id; // ctx_toggleFavorite uses this._ctxTargetId
                    this.ctx_toggleFavorite();
                }
            }
            // Escape: clear path highlight, upload picker, close timeline
            if (e.key === 'Escape') {
                Renderer._pathHighlightIds.clear();
                Renderer._selectedId = null;
                Renderer._selectedIds.clear();
                Renderer.markDirty();
                if (this._uploadPickerMode) Upload.cancelUploadPicker(this);
                if (this._timelineOpen) Timeline.close(this);
            }
        });

        // ── Desktop file drag-drop (overlay mode) ─────────────
        const canvas = Renderer.canvas;
        let dragCounter = 0;
        if (canvas) {
            canvas.addEventListener('dragenter', (e) => {
                e.preventDefault();
                dragCounter++;
                Utils.show(Utils.el('upload-overlay'));
            });
            canvas.addEventListener('dragleave', (e) => {
                e.preventDefault();
                dragCounter--;
                if (dragCounter <= 0) { dragCounter = 0; Utils.hide(Utils.el('upload-overlay')); }
            });
            canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
            canvas.addEventListener('drop', (e) => {
                e.preventDefault();
                dragCounter = 0;
                Utils.hide(Utils.el('upload-overlay'));
                const files = e.dataTransfer.files;
                if (!files || files.length === 0) return;
                this._pendingUploadFiles = [...files];
                Upload.enterUploadPickerMode(this);
            });
        }

        // Context menu Handlers (Only those that exist with IDs)
    },

    goHome() {
        location.reload();
    },

    loadDemo() {
        this._showLoading('ГЕНЕРАЦИЯ ДЕМО…');
        setTimeout(() => {
            const r = storage.generateDemo();
            this._loadGraph(r.nodes, r.edges, 'мой-проект [ДЕМО]');
        }, 300);
    },

    setLayoutMode(mode) {
        this._clusterMode = mode;
        ForceLayout.setMode(mode);
        // В strict не сбрасываем позиции — только пересчёт глубины; сброс только по кнопке «Вернуть в норму»
        this._applyGraph(mode === 'strict' ? 0 : 0.8);
    },

    /** Вернуть раскладку к строгому дереву (по кнопке «Вернуть в норму»). */
    resetLayoutToStrict() {
        if (this._clusterMode !== 'strict') {
            Utils.toast('Доступно только в режиме «Строгий»', 'info', 2000);
            return;
        }
        ForceLayout.applyStrictLayout();
        this._nodes = ForceLayout.nodes;
        this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));
        Renderer.loadGraph(this._nodes, this._edges);
        Renderer.markDirty();
        Utils.toast('Раскладка сброшена в строгий вид', 'success', 1500);
    },

    async openDirectory() {
        if (!('showDirectoryPicker' in window)) {
            Utils.toast('File System Access API не поддерживается вашим браузером', 'error', 3000);
            return;
        }
        this._showLoading('ОТКРЫТИЕ ПАПКИ…');
        this._showProgress('Сканирование файловой системы…');
        this._scanCount = 0;
        let result;
        try {
            result = await storage.openDirectory((count, name) => {
                this._scanCount = count;
                Utils.el('loading-text').textContent = 'СКАНИРОВАНИЕ СИСТЕМЫ…';
                Utils.el('loading-sub').textContent = `${count} элементов · ${name}`;
                // Аппроксимация прогресса до 80% от количества обнаруженных элементов
                const approxTotal = this._scanCount + 100;
                const progress = Math.min(0.8, 0.8 * (count / approxTotal));
                this._setLoadingProgress(progress);
            });
            if (!result) {
                this._hideLoading();
                return;
            }
            this._loadGraph(result.nodes, result.edges, storage.rootName);
        } catch (e) {
            this._hideLoading();
            if (e.name !== 'AbortError') Utils.toast(`Ошибка: ${e.message}`, 'error');
        }
    },

    _groupFiles(nodes, edges) {
        if (!this._groupingEnabled && this._groupedFolders.size === 0) return { nodes, edges };
        const threshold = 5;
        const childrenMap = new Map(); // parentId -> list of file child nodes
        const nodeMap = new Map(nodes.map(n => [n.id, n]));

        for (const e of edges) {
            const tgt = nodeMap.get(e.target);
            if (tgt && tgt.type !== 'folder') {
                if (!childrenMap.has(e.source)) childrenMap.set(e.source, []);
                childrenMap.get(e.source).push(tgt);
            }
        }

        const nodesToHide = new Set();
        const newNodes = [];
        const newEdges = [];

        for (const [parentId, files] of childrenMap.entries()) {
            // Group if: global grouping ON and above threshold, OR per-folder grouping for this folder
            const globalGroup = this._groupingEnabled && files.length > threshold;
            const perFolderGroup = this._groupedFolders.has(parentId) && files.length > 1;
            if (globalGroup || perFolderGroup) {
                const totalSize = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
                const groupId = parentId + '_filegroup';

                newNodes.push({
                    id: groupId,
                    name: `[ 📄 ${files.length} файлов ]`,
                    type: 'file-group',
                    sizeBytes: totalSize,
                    parentId: parentId,
                    _hiddenFiles: files,
                    x: 0, y: 0
                });
                newEdges.push({
                    id: `${parentId}->${groupId}`,
                    source: parentId,
                    target: groupId
                });

                for (const f of files) nodesToHide.add(f.id);
            }
        }

        const filteredNodes = nodes.filter(n => !nodesToHide.has(n.id)).concat(newNodes);
        const filteredEdges = edges.filter(e => !nodesToHide.has(e.target)).concat(newEdges);
        return { nodes: filteredNodes, edges: filteredEdges };
    },

    _loadGraph(rawNodes, rawEdges, rootName) {
        const { nodes, edges } = this._groupFiles(rawNodes, rawEdges);
        this._rawNodes = rawNodes;
        this._rawEdges = rawEdges; // Always keep original edges for ungrouping

        // Make GraphStore the single source of truth from the start
        this._nodes = nodes;
        this._edges = edges;
        graphStore.loadGraph(this._nodes, this._edges);
        this._nodeMap = graphStore.nodeMap;

        Search.load(this._nodes); // Note: we search only visible nodes for simplicity now

        Utils.hide(Utils.el('landing-screen'));
        Utils.show(Utils.el('graph-screen'));
        Renderer.resize();

        Utils.el('toolbar-path').textContent = rootName || '';
        this._updateStats(this._nodes);
        this._renderSidebarTree(this._nodes);

        ForceLayout.init(this._nodes, this._edges, this._clusterMode, (laidNodes, done) => {
            this._nodes = laidNodes;
            graphStore.refreshGraph(this._nodes, this._edges);
            this._nodeMap = graphStore.nodeMap;
            Renderer.loadGraph(this._nodes, this._edges);
            Renderer.markDirty();
            if (done) {
                this._setLoadingProgress(1);
                setTimeout(() => this._hideLoading(), 120);
                setTimeout(() => this._hideProgress(), 180);
            }
        });

        this._nodes = ForceLayout.nodes;
        graphStore.refreshGraph(this._nodes, this._edges);
        this._nodeMap = graphStore.nodeMap;
        Renderer.loadGraph(this._nodes, this._edges);
        Renderer.markDirty();
        ForceLayout.start();

        // Auto-zoom disabled: user controls zoom manually via F key or FIT button
        Utils.el('loading-text').textContent = 'РАСЧЕТ ГРАФА…';
        Utils.el('loading-sub').textContent = `${this._nodes.length} узлов — симуляция…`;
    },

    showMoveCopyMenu(srcNode, targetFolder, x, y) {
        // srcNode can be a single node or an array of nodes for multi-drag
        this._pendingMoveCopy = { srcNode, targetFolder };
        const menu = Utils.el('move-copy-menu');
        menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - 150)}px`;
        // Update label for multi-node
        const count = Array.isArray(srcNode) ? srcNode.length : 1;
        const header = menu.querySelector('.move-copy-header');
        if (header) header.textContent = count > 1 ? `${count} элемент(ов) → ${targetFolder.name}` : `${srcNode.name || ''} → ${targetFolder.name}`;
        Utils.show(menu);
    },

    async executeMoveCopy(action) {
        Utils.hide(Utils.el('move-copy-menu'));
        if (!this._pendingMoveCopy || action === 'cancel') {
            this._pendingMoveCopy = null;
            return;
        }

        const { srcNode, targetFolder } = this._pendingMoveCopy;
        this._pendingMoveCopy = null;

        // Handle single or multi-node
        const nodes = Array.isArray(srcNode) ? srcNode : [srcNode];
        for (const node of nodes) {
            if (action === 'move') {
                await this.handleNodeMove(node, targetFolder);
            } else if (action === 'copy') {
                await this.handleNodeCopy(node, targetFolder);
            }
        }
    },

    async handleNodeMove(srcNode, targetFolder) {
        const oldPath = srcNode._dbxPath ?? srcNode.path;
        // OPTIMISTIC: Update graph topology immediately
        const oldParentId = srcNode.parentId;
        // Remove ALL incoming edges to srcNode (not just parentId match — bulletproof)
        const removedEdges = this._edges.filter(e => e.target === srcNode.id);
        this._edges = this._edges.filter(e => e.target !== srcNode.id);

        const newEdge = { id: `${targetFolder.id}->${srcNode.id}`, source: targetFolder.id, target: srcNode.id };
        this._edges.push(newEdge);
        srcNode.parentId = targetFolder.id;
        srcNode.parent = targetFolder.id;
        // Clear position so strict layout places the node next to the new parent immediately
        srcNode.x = undefined;
        srcNode.y = undefined;

        this._applyGraph(0.6);
        Utils.toast(`Перемещено: ${srcNode.name} в ${targetFolder.name}`, 'success');
        ActivityLog.add({
            type: 'move',
            title: `Перемещение в «${targetFolder.name}»`,
            status: 'success',
            tags: [srcNode.name, targetFolder.name, (oldPath || '').replace(/^\//, '')],
        });

        // BACKGROUND: API call
        try {
            await storage.moveNode(srcNode, targetFolder);
            if (srcNode._tag) await this._persistTagsConfigPathMove(oldPath, srcNode._dbxPath ?? srcNode.path, srcNode._tag);
            this._syncDropboxNow();
        } catch (e) {
            // ROLLBACK
            this._edges = this._edges.filter(e => e.id !== newEdge.id);
            removedEdges.forEach(re => this._edges.push(re));
            srcNode.parentId = oldParentId;
            srcNode.parent = oldParentId;
            this._applyGraph(0);
            Utils.toast(`Ошибка перемещения: ${e.message}`, 'error', 3000);
            ActivityLog.add({ type: 'move', title: `Ошибка перемещения: ${srcNode.name}`, status: 'error', tags: [e.message] });
        }
    },

    async handleNodeCopy(srcNode, targetFolder) {
        try {
            await storage.copyNode(srcNode, targetFolder);
            Utils.toast(`Скопировано: ${srcNode.name} в ${targetFolder.name}`, 'success');
            ActivityLog.add({
                type: 'copy',
                title: `Копирование в «${targetFolder.name}»`,
                status: 'success',
                tags: [srcNode.name, targetFolder.name],
            });
            this._syncDropboxNow(); // Event-driven sync to refresh graph
        } catch (e) {
            Utils.toast(e.message, 'error', 3000);
            ActivityLog.add({ type: 'copy', title: `Ошибка копирования: ${srcNode.name}`, status: 'error', tags: [e.message] });
        }
    },


    onConnectionDrop(srcNode, cx, cy, wx, wy) {
        // Only folders can create children
        if (!srcNode || srcNode.type !== 'folder') {
            Utils.toast('Создание доступно только из папки', 'info', 1500);
            return;
        }
        this._pendingCreate = { srcNode, wx, wy };
        setTimeout(() => {
            const m = Utils.el('create-menu');
            m.style.left = `${Math.min(cx, window.innerWidth - 150)}px`;
            m.style.top = `${Math.min(cy, window.innerHeight - 100)}px`;
            Utils.show(m);
        }, 10);
    },

    async createNode(type) {
        Utils.hide(Utils.el('create-menu'));
        if (!this._pendingCreate) return;
        const { srcNode, wx, wy } = this._pendingCreate;
        this._pendingCreate = null;

        const isFolder = type === 'folder';
        const placeholder = isFolder ? 'Имя папки...' : 'Имя файла.txt';

        // Use inline input instead of browser prompt
        Renderer.showInlineInput(wx, wy, placeholder, (name) => {
            if (!name) return;
            this._doCreateNode(srcNode, name, isFolder, wx, wy);
        });
    },

    async _doCreateNode(srcNode, name, isFolder, wx, wy) {
        const parentPath = srcNode._dbxPath || srcNode.path || '';
        const newPath = parentPath + '/' + name;
        const actualPath = newPath;
        const id = Utils.hashStr(actualPath);
        const inferredType = isFolder ? 'folder' : NodeTypes.infer(name, false);

        // OPTIMISTIC: add node to graph immediately
        const newNode = {
            id, name, path: actualPath, type: inferredType,
            sizeBytes: isFolder ? 0 : 1024,
            subtreeSizeBytes: isFolder ? 0 : 1024,
            modifiedAt: new Date(), parentId: srcNode.id,
            handle: null,
            x: wx, y: wy, vx: 0, vy: 0,
            _radius: NodeTypes.radius(1024, isFolder),
            _dbxPath: actualPath,
        };

        const newEdge = { id: srcNode.id + '->' + id, source: srcNode.id, target: id };
        this._nodes.push(newNode);
        this._edges.push(newEdge);
        this._nodeMap.set(id, newNode);
        Renderer._nodeMap.set(id, newNode);

        this._renderSidebarTree(this._nodes);
        Search.load(this._nodes);

        if (ForceLayout) {
            ForceLayout.nodes.push(newNode);
            ForceLayout.edges.push(newEdge);
            ForceLayout._calcTreeDepths(ForceLayout.nodes, ForceLayout.edges);
            ForceLayout.reheat(this._clusterMode === 'strict' ? 0 : 0.5);
            Renderer.nodes = ForceLayout.nodes;
            Renderer.edges = ForceLayout.edges;
        } else {
            Renderer.nodes = this._nodes;
            Renderer.edges = this._edges;
        }

        Renderer.selectNode(id);
        Renderer.markDirty();
        this._syncRawData();
        Utils.toast(`Создано: ${name}`, 'success');
        ActivityLog.add({
            type: 'create',
            title: isFolder ? `Создана папка «${name}»` : `Создан файл «${name}»`,
            status: 'success',
            tags: [name, srcNode.name || ''],
        });

        // BACKGROUND: API call (fire-and-forget with error rollback)
        try {
            if (isDropboxMode) {
                const apiResult = isFolder
                    ? await storage.createFolder(newPath)
                    : await storage.createFile(newPath);
                if (apiResult?.path_display) {
                    newNode._dbxPath = apiResult.path_display;
                    newNode.path = apiResult.path_display;
                }
                this._syncDropboxNow();
            } else if (srcNode.handle) {
                await (isFolder
                    ? storage.createFolder(srcNode.id, name)
                    : storage.createFile(srcNode.id, name));
            }
        } catch (e) {
            // ROLLBACK: remove optimistic node
            this._nodes = this._nodes.filter(n => n.id !== id);
            this._edges = this._edges.filter(e => e.id !== newEdge.id);
            this._nodeMap.delete(id);
            if (ForceLayout) {
                ForceLayout.nodes = this._nodes;
                ForceLayout.edges = this._edges;
                ForceLayout._calcTreeDepths(this._nodes, this._edges);
            }
            Renderer.loadGraph(this._nodes, this._edges);
            Renderer.markDirty();
            this._renderSidebarTree(this._nodes);
            Utils.toast(`Ошибка: ${e.message}`, 'error', 3000);
            ActivityLog.add({ type: 'create', title: `Ошибка создания: ${name}`, status: 'error', tags: [e.message] });
        }
    },

    _updateStats(nodes) {
        const n = nodes || this._nodes;
        Utils.el('stat-nodes').textContent = n.length;
        Utils.el('stat-files').textContent = n.filter(x => x.type !== 'folder').length;
        Utils.el('stat-size').textContent = Utils.formatSize(
            n.filter(x => x.type !== 'folder').reduce((s, x) => s + (x.sizeBytes || 0), 0)
        );
    },

    // ══════════════════════════════════════════════════════════
    // GRAPH INTEGRITY ENGINE — single source of truth
    // ══════════════════════════════════════════════════════════

    /**
     * Delegate graph integrity checks to the centralized GraphStore.
     * Keeps local aliases (_nodes, _edges, _nodeMap) in sync with the store.
     */
    _ensureGraphIntegrity() {
        const result = graphStore.refreshGraph(this._nodes, this._edges);
        this._nodes = graphStore.nodes;
        this._edges = graphStore.edges;
        this._nodeMap = graphStore.nodeMap;
        return result;
    },

    /**
     * Single atomic function to sync ALL data stores after any graph mutation.
     * Call this instead of manually updating ForceLayout/Renderer/raw separately.
     * @param {number} reheat — ForceLayout reheat value (0 = no physics, 0.5 = medium)
     */
    _applyGraph(reheat = 0.3) {
        // 1) Run integrity check via GraphStore
        this._ensureGraphIntegrity();

        // 2) Sync ForceLayout (reheat больше не сбрасывает позиции в strict; только пересчёт _depth)
        if (ForceLayout) {
            ForceLayout.nodes = this._nodes;
            ForceLayout.edges = this._edges;
            ForceLayout.reheat(this._clusterMode === 'strict' ? 0 : reheat);
            // В строгом режиме позиционируем только новые ноды (без сброса уже расставленных)
            if (this._clusterMode === 'strict') {
                ForceLayout.applyStrictLayout({ onlyUnpositioned: true });
            }
        }

        // 3) Sync Renderer
        Renderer.loadGraph(this._nodes, this._edges);
        Renderer.markDirty();

        // 4) Sync raw data (for grouping toggle)
        this._syncRawData();

        // 5) Rebuild sidebar & stats
        this._renderSidebarTree(this._nodes);
        this._updateStats(this._nodes);
    },

    // Keep _rawNodes/_rawEdges in sync with current graph state
    _syncRawData() {
        const realNodes = [];
        const realEdges = [];

        for (const n of this._nodes) {
            if (n.type !== 'file-group') {
                realNodes.push(n);
            } else if (n._hiddenFiles) {
                // Restore hidden files correctly into the raw representation
                for (const hf of n._hiddenFiles) {
                    realNodes.push(hf);
                    realEdges.push({
                        id: `${hf.parentId}->${hf.id}`,
                        source: hf.parentId,
                        target: hf.id
                    });
                }
            }
        }

        // Restore real edges that don't belong to a filegroup
        for (const e of this._edges) {
            if (!(e.id && e.id.includes('_filegroup'))) {
                realEdges.push(e);
            }
        }

        this._rawNodes = realNodes;
        this._rawEdges = realEdges;
    },

    exportGraph() {
        const c = Renderer.canvas;
        if (!c) return;
        const link = document.createElement('a');
        link.download = `aetherfs-graph-${Date.now()}.png`;
        link.href = c.toDataURL('image/png');
        link.click();
        Utils.toast('Граф экспортирован как PNG', 'success');
    },

    _pendingUploadFiles: null,
    _uploadPickerMode: false,

    _enterUploadPickerMode() { Upload.enterUploadPickerMode(this); },
    cancelUploadPicker() { Upload.cancelUploadPicker(this); },
    _exitUploadPickerMode() { Upload.exitUploadPickerMode(this); },

    _timelineOpen: false,

    openTimeline() { Timeline.open(this); },
    closeTimeline() { Timeline.close(this); },

    _showLoading(text) {
        Utils.el('loading-text').textContent = text || 'ЗАГРУЗКА…';
        Utils.el('loading-sub').textContent = '';
        Utils.show(Utils.el('loading-overlay'));
    },

    _hideLoading() { Utils.hide(Utils.el('loading-overlay')); },

    _setLoadingProgress(value) {
        const strip = Utils.el('progress-strip');
        if (!strip) return;
        const v = Math.max(0, Math.min(1, value ?? 0));
        const fill = Utils.el('progress-track-fill');
        const knob = Utils.el('progress-track-knob');
        const label = Utils.el('progress-label-percent');
        const pct = Math.round(v * 100);
        if (fill) fill.style.width = `${v * 100}%`;
        if (knob) knob.style.left = `${v * 100}%`;
        if (label) label.textContent = `${pct}%`;
        strip.classList.remove('hidden');
    },

    _showProgress(label) {
        const strip = Utils.el('progress-strip');
        if (!strip) return;
        const textEl = Utils.el('progress-label-text');
        const pctEl = Utils.el('progress-label-percent');
        const fill = Utils.el('progress-track-fill');
        const knob = Utils.el('progress-track-knob');
        if (textEl) textEl.textContent = label || 'Загрузка…';
        if (pctEl) pctEl.textContent = '0%';
        if (fill) fill.style.width = '0%';
        if (knob) knob.style.left = '0%';
        strip.classList.remove('hidden');
    },

    _hideProgress() {
        const strip = Utils.el('progress-strip');
        if (strip) strip.classList.add('hidden');
    },

    _renderSidebarTree(nodes) {
        Sidebar.renderTree(this, nodes);
    },

    onNodeSelect(id) {
        const node = this._nodeMap.get(id);
        if (!node) return;
        this._selectedNode = node;
        this._openPreview(node);
        document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
        const treeEl = document.querySelector(`.tree-item[data-id="${id}"]`);
        if (treeEl) {
            treeEl.classList.add('selected');
            treeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    async _openPreview(node) {
        const panel = Utils.el('preview-panel');
        for (const url of this._revokableURLs) URL.revokeObjectURL(url);
        this._revokableURLs = [];

        Utils.el('panel-node-icon').textContent = '';
        Utils.el('panel-node-icon').style.background = NodeTypes.hexToRgba(NodeTypes.color(node.type), 0.4);
        Utils.el('panel-node-icon').style.borderColor = NodeTypes.color(node.type);
        Utils.el('panel-filename').textContent = node.name;
        Utils.el('panel-filename').style.color = NodeTypes.color(node.type);
        Utils.el('panel-path').textContent = node.path;

        const ext = node.name.includes('.') ? node.name.slice(node.name.lastIndexOf('.')) : '';
        Utils.el('meta-type').textContent = NodeTypes.label(node.type) + (ext ? ` (${ext})` : '');
        Utils.el('meta-size').textContent = node.type === 'folder' ? `${Utils.formatSize(node.subtreeSizeBytes)} всего` : Utils.formatSize(node.sizeBytes);
        Utils.el('meta-modified').textContent = Utils.formatDate(node.modifiedAt);
        const pathEl = Utils.el('meta-path');
        pathEl.textContent = node.path; pathEl.title = node.path;

        const previewArea = Utils.el('panel-preview-area');
        previewArea.innerHTML = '';

        if (node.type === 'file-group') {
            const list = document.createElement('div');
            list.style.padding = '10px';
            list.style.display = 'flex';
            list.style.flexDirection = 'column';
            list.style.gap = '5px';
            list.style.overflowY = 'auto';
            list.style.maxHeight = '100%';
            list.style.width = '100%';

            for (const f of node._hiddenFiles || []) {
                const item = document.createElement('div');
                item.style.padding = '8px';
                item.style.background = '#222';
                item.style.borderRadius = '4px';
                item.style.borderLeft = `3px solid ${NodeTypes.color(f.type)}`;
                item.style.cursor = 'pointer';
                item.innerHTML = `
                    <div style="font-size: 13px; font-weight: bold; color: ${NodeTypes.color(f.type)}">${Utils.escapeHtml(f.name)}</div>
                    <div style="font-size: 11px; color: #888">${Utils.formatSize(f.sizeBytes)}</div>
                `;
                item.addEventListener('mouseenter', () => item.style.background = '#333');
                item.addEventListener('mouseleave', () => item.style.background = '#222');
                item.addEventListener('click', () => this._openPreview(f));
                list.appendChild(item);
            }
            previewArea.appendChild(list);
        } else if (node.handle || node._dbxPath) {
            // Local: node.handle; Dropbox: провайдер принимает node (по _dbxPath)
            const handleArg = node.handle || node;

            if (node.type === 'image') {
                const url = await storage.readFileURL(handleArg).catch(() => null);
                if (url) { this._revokableURLs.push(url); const img = document.createElement('img'); img.src = url; previewArea.appendChild(img); }
                else this._placeholderPreview(previewArea, node);
            } else if (node.type === 'code' || node.type === 'document') {
                const text = await storage.readFileText(handleArg).catch(() => null);
                if (text !== null) { const pre = document.createElement('pre'); pre.className = 'preview-code'; pre.textContent = text.slice(0, 3000); previewArea.appendChild(pre); }
                else this._placeholderPreview(previewArea, node);
            } else if (node.type === 'video') {
                const url = await storage.readFileURL(handleArg).catch(() => null);
                if (url) { this._revokableURLs.push(url); const v = document.createElement('video'); v.src = url; v.controls = true; v.style.maxHeight = '220px'; previewArea.appendChild(v); }
                else this._placeholderPreview(previewArea, node);
            } else if (node.type === 'audio') {
                const url = await storage.readFileURL(handleArg).catch(() => null);
                if (url) { this._revokableURLs.push(url); const a = document.createElement('audio'); a.src = url; a.controls = true; a.style.width = '90%'; previewArea.appendChild(a); }
                else this._placeholderPreview(previewArea, node);
            } else this._placeholderPreview(previewArea, node);
        } else this._placeholderPreview(previewArea, node);

        // ── Comment / Note section ──────────────────────────
        const existingComment = Utils.el('panel-comment-area');
        if (existingComment) existingComment.remove();

        const commentWrap = document.createElement('div');
        commentWrap.id = 'panel-comment-area';
        commentWrap.style.cssText = 'padding:12px 16px; border-top:1px solid rgba(255,255,255,0.08);';
        commentWrap.innerHTML = `
            <div style="font-size:11px; color:#888; margin-bottom:6px; text-transform:uppercase; letter-spacing:1px;">Заметка</div>
            <textarea id="panel-comment-text" placeholder="Добавить заметку к этому элементу..."
                style="width:100%; min-height:64px; max-height:150px; resize:vertical;
                background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1);
                border-radius:8px; padding:10px 12px; color:#e0e8ff; font-size:13px;
                font-family:'Inter Tight',sans-serif; outline:none;
                transition:border-color 0.2s, box-shadow 0.2s;"
                onfocus="this.style.borderColor='rgba(100,180,255,0.4)';this.style.boxShadow='0 0 0 3px rgba(100,180,255,0.08)'"
                onblur="this.style.borderColor='rgba(255,255,255,0.1)';this.style.boxShadow='none'"
            ></textarea>
        `;
        // Insert before the buttons row or at the end of the panel content
        const panelContent = panel.querySelector('.panel-content') || panel;
        panelContent.appendChild(commentWrap);

        const commentTextarea = Utils.el('panel-comment-text');
        const savedComment = this._nodeComments.get(node.id) || '';
        commentTextarea.value = savedComment;

        // Auto-save on blur
        commentTextarea.addEventListener('blur', () => {
            this.saveComment(node.id, commentTextarea.value);
        });
        // Also save on Enter+Ctrl
        commentTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.saveComment(node.id, commentTextarea.value);
                Utils.toast('Заметка сохранена', 'success', 1000);
                e.preventDefault();
            }
        });

        Utils.show(panel);
    },

    _placeholderPreview(container, node) {
        container.innerHTML = `<div class="preview-placeholder"><div style="background:${NodeTypes.color(node.type)}; width:32px; height:32px; display:inline-block; margin-bottom:12px;"></div><p style="color:${NodeTypes.hexToRgba(NodeTypes.color(node.type), 0.6)}">${NodeTypes.label(node.type).toUpperCase()}</p></div>`;
    },

    closePreview() { Utils.hide(Utils.el('preview-panel')); this._selectedNode = null; Renderer.deselect(); },

    toggleFilesVisibility() {
        this._filesVisible = !this._filesVisible;
        const btn = Utils.el('btn-toggle-files');
        if (btn) btn.classList.toggle('active', this._filesVisible);
        Renderer.setFilesVisible(this._filesVisible);
        this._applyGraph(0.5);
    },

    toggleGrouping() {
        this._groupingEnabled = !this._groupingEnabled;
        const btn = Utils.el('btn-toggle-grouping');
        if (btn) btn.classList.toggle('active', this._groupingEnabled);

        // ALWAYS use deep-cloned raw data to avoid mutation/duplication
        if (!this._rawNodes || !this._rawEdges) this._syncRawData();
        const rawNodes = this._rawNodes.map(n => ({ ...n }));
        const rawEdges = this._rawEdges.map(e => ({ ...e }));
        const { nodes, edges } = this._groupFiles(rawNodes, rawEdges);
        this._nodes = nodes;
        this._edges = edges;

        this._applyGraph(0.3);
        Utils.toast(this._groupingEnabled ? 'Группировка ВКЛ' : 'Группировка ВЫКЛ', 'info', 1500);
    },

    toggleTheme() {
        this._theme = this._theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = this._theme;
        localStorage.setItem('aetherfs-theme', this._theme);
        const btn = Utils.el('btn-toggle-theme');
        if (btn) btn.textContent = this._theme === 'dark' ? '☀' : '🌙';
        Renderer.markDirty();
    },

    toggleCollapse(nodeId) {
        const n = this._nodeMap.get(nodeId);
        if (!n || n.type !== 'folder') return;
        n.collapsed = !n.collapsed;
        if (ForceLayout) ForceLayout.reheat(0.4);
        Renderer.markDirty();
        // Update sidebar if needed
        this._renderSidebarTree(this._nodes);
    },

    showContextMenu(x, y, id) {
        this._ctxTargetId = id;
        const menu = Utils.el('context-menu');
        if (!menu) return;
        const node = this._nodeMap.get(id);
        const isFolder = node && node.type === 'folder';
        // Show/hide folder-only items
        menu.querySelectorAll('.ctx-folder-only').forEach(el => {
            el.style.display = isFolder ? '' : 'none';
        });
        menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - 300)}px`;
        Utils.show(menu);
    },

    ctx_open() { Utils.toast('Открытие доступно напрямую через File System Access API', 'info'); },
    ctx_copyPath() { const n = this._nodeMap.get(this._ctxTargetId); if (n) Utils.copyText(n.path); },

    async ctx_download() {
        Utils.hide(Utils.el('context-menu'));
        const node = this._nodeMap.get(this._ctxTargetId);
        if (!node || !storage.getFileBlob) return;

        if (node.type === 'folder') {
            const descendants = new Set();
            const collect = (id) => {
                descendants.add(id);
                this._edges.filter(e => e.source === id).forEach(e => collect(e.target));
            };
            collect(node.id);
            const fileNodes = this._nodes.filter(n => n.type !== 'folder' && descendants.has(n.id));
            if (fileNodes.length === 0) {
                Utils.toast('В папке нет файлов для скачивания', 'info');
                return;
            }
            this._showProgress(`Скачивание… ${fileNodes.length} файл(ов)`);
            try {
                const zip = new JSZip();
                const basePath = ((node._dbxPath ?? node.path) || '').replace(/\/+$/, '') || node.name;
                for (let i = 0; i < fileNodes.length; i++) {
                    const fn = fileNodes[i];
                    const fullPath = fn._dbxPath ?? fn.path ?? fn.name;
                    const rel = fullPath.startsWith(basePath) ? fullPath.slice(basePath.length).replace(/^\/+/, '') : fn.name;
                    const zipPath = rel ? `${node.name}/${rel}` : `${node.name}/${fn.name}`;
                    const blob = await storage.getFileBlob(fn);
                    if (blob) zip.file(zipPath, blob);
                    if (fileNodes.length > 3) {
                        Utils.el('loading-sub').textContent = `${i + 1} / ${fileNodes.length}`;
                        this._setLoadingProgress((i + 1) / fileNodes.length);
                    }
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                this._triggerDownload(zipBlob, `${node.name}.zip`);
                Utils.toast(`Скачано: ${node.name}.zip`, 'success', 2000);
            } catch (e) {
                console.error(e);
                Utils.toast(`Ошибка: ${e.message}`, 'error', 3000);
            } finally {
                this._hideProgress();
            }
        } else {
            this._showProgress('Скачивание…');
            try {
                const blob = await storage.getFileBlob(node);
                if (!blob) throw new Error('Не удалось прочитать файл');
                this._triggerDownload(blob, node.name);
                Utils.toast(`Скачано: ${node.name}`, 'success', 2000);
            } catch (e) {
                Utils.toast(`Ошибка: ${e.message}`, 'error', 3000);
            } finally {
                this._hideProgress();
            }
        }
    },

    _triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },
    ctx_focusType() {
        const n = this._nodeMap.get(this._ctxTargetId); if (!n) return;
        Renderer.setDimMode(true, n.type);
        Utils.toast(`Показ только: ${NodeTypes.label(n.type)}`, 'info', 2000);
        setTimeout(() => Renderer.setDimMode(false), 4000);
    },
    ctx_expandCluster() {
        // "Only Children" - Isolation feature
        const n = this._nodeMap.get(this._ctxTargetId); if (!n) return;

        // Find all descendants
        const descendants = new Set();
        const stack = [n.id];
        while (stack.length > 0) {
            const id = stack.pop();
            descendants.add(id);
            this._edges.filter(e => e.source === id).forEach(e => stack.push(e.target));
        }

        const nodesToHide = this._nodes.filter(node => !descendants.has(node.id));
        nodesToHide.forEach(node => node._tempHidden = true);

        Utils.toast(`Изолировано: ${n.name}`, 'info', 3000);
        Renderer.markDirty();

        // Auto revert after 8 sec or on click
        setTimeout(() => {
            this._nodes.forEach(node => delete node._tempHidden);
            Renderer.markDirty();
        }, 8000);
    },
    ctx_collapseAll() {
        const rootId = this._nodes.find(n => !n.parentId)?.id;
        this._nodes.forEach(n => {
            if (n.type === 'folder' && n.id !== rootId) n.collapsed = true;
        });
        if (ForceLayout) ForceLayout.reheat(0.4);
        Renderer.markDirty();
        this._renderSidebarTree(this._nodes);
        Utils.toast('Все папки свернуты', 'info');
    },
    toggleHeatmap() {
        this._heatmapOn = !this._heatmapOn;
        Renderer.heatmapMode = this._heatmapOn;
        Renderer.markDirty();
        const hbtn = Utils.el('btn-heatmap'), legend = Utils.el('heatmap-legend');
        if (this._heatmapOn) {
            hbtn.classList.add('active'); Utils.show(legend); this._buildHeatmapLegend();
            Utils.toast('Тепловая карта ВКЛ', 'info', 1500);
        } else {
            hbtn.classList.remove('active'); Utils.hide(legend);
            Utils.toast('Тепловая карта ВЫКЛ', 'info', 1500);
        }
    },

    _buildHeatmapLegend() {
        const folders = this._nodes.filter(n => n.type === 'folder')
            .sort((a, b) => (b.subtreeSizeBytes || 0) - (a.subtreeSizeBytes || 0)).slice(0, 5);
        const maxSize = folders[0] ? folders[0].subtreeSizeBytes : 1;
        Utils.el('legend-entries').innerHTML = folders.map(f => {
            const ratio = (f.subtreeSizeBytes || 0) / maxSize;
            const color = NodeTypes.heatColor(ratio);
            return `<div class="legend-entry"><div class="legend-entry-dot" style="background:${color}"></div><div class="legend-entry-name">${Utils.escapeHtml(f.name)}</div><div class="legend-entry-size">${Utils.formatSize(f.subtreeSizeBytes)}</div></div>`;
        }).join('');
    },

    /** Load tags from Dropbox config and apply to current nodes by path. Only in Dropbox mode. */
    async _applyTagsFromConfig() {
        if (!isDropboxMode || !storage.readTagsConfig) return;
        try {
            const data = await storage.readTagsConfig();
            if (!data || !data.pathToTag) return;
            for (const n of this._nodes) {
                const path = n._dbxPath ?? n.path;
                if (path && data.pathToTag[path] !== undefined) n._tag = data.pathToTag[path];
            }
        } catch (e) {
            console.warn('[Tags] Failed to load config:', e.message);
        }
    },

    openSearch() {
        Utils.show(Utils.el('search-overlay'));
        const inp = Utils.el('search-input'); inp.value = ''; inp.focus();
        Utils.el('search-results').innerHTML = '<div class="search-empty">Начните вводить текст...</div>';
    },
    closeSearch(e) { if (!e || e.target === Utils.el('search-overlay')) Utils.hide(Utils.el('search-overlay')); },
    _onSearchInput(value) {
        const results = Search.query(value);
        Search.renderResults(Utils.el('search-results'), results, value, (id) => {
            Utils.hide(Utils.el('search-overlay'));
            Renderer.selectNode(id);
            Renderer.highlightNode(id);
            Renderer.panTo(id, 1.8);
            Renderer.setDimMode(true, null);
            setTimeout(() => Renderer.setDimMode(false), 3000);
        });
    },

    // ── Dropbox Integration ────────────────────────────────
    async connectDropbox() {
        if (DropboxAuth.isLoggedIn()) {
            this._showLoading('ЗАГРУЗКА DROPBOX…');
            await this._openDropbox();
        } else {
            DropboxAuth.login(); // Redirects to Dropbox
        }
    },

    async _openDropbox() {
        this._showLoading('СКАНИРОВАНИЕ DROPBOX…');
        this._showProgress('Сканирование Dropbox…');
        this._scanCount = 0;
        storage = new DropboxProvider();
        isDropboxMode = true;
        try {
            const result = await storage.openDirectory((count, name) => {
                Utils.el('loading-text').textContent = 'СКАНИРОВАНИЕ DROPBOX…';
                Utils.el('loading-sub').textContent = `${count} элементов · ${name}`;
                this._scanCount = count;
                const approxTotal = this._scanCount + 200;
                const progress = Math.min(0.8, 0.8 * (count / approxTotal));
                this._setLoadingProgress(progress);
            });
            if (!result) {
                this._hideLoading();
                return;
            }
            this._loadGraph(result.nodes, result.edges, storage.rootName);
            await this._applyTagsFromConfig();
            Renderer.markDirty();
            Utils.show(Utils.el('btn-sync-dropbox'));

            // Start auto-refresh polling (every 30 seconds)
            this._startDropboxSync();
        } catch (e) {
            this._hideLoading();
            Utils.toast(`Ошибка Dropbox: ${e.message}`, 'error', 4000);
        }
    },

    _startDropboxSync() {
        // No polling — sync is now event-driven via _syncDropboxNow()
        if (this._dropboxSyncInterval) clearInterval(this._dropboxSyncInterval);
        this._dropboxSyncInterval = null;
    },

    async forceSyncDropbox() {
        if (!isDropboxMode) return;
        this._showLoading('СИНХРОНИЗАЦИЯ DROPBOX…');
        try {
            const freshStorage = new DropboxProvider();
            const result = await freshStorage.openDirectory(() => { });
            if (!result) return;

            // Preserve positions
            for (const n of result.nodes) {
                const existing = this._nodeMap?.get(n.id);
                if (existing) {
                    n.x = existing.x; n.y = existing.y;
                    n.vx = existing.vx || 0; n.vy = existing.vy || 0;
                }
            }

            this._loadGraph(result.nodes, result.edges, freshStorage.rootName);
            await this._applyTagsFromConfig();
            Renderer.markDirty();
            Utils.toast('☁ Dropbox: синхронизировано', 'success', 2000);
        } catch (e) {
            Utils.toast(`Ошибка Dropbox: ${e.message}`, 'error', 4000);
            this._hideLoading();
        }
    },

    // Event-driven sync: called after any CRUD operation with 2s debounce
    _syncDropboxNow() {
        if (!isDropboxMode) return;
        if (this._syncDebounce) clearTimeout(this._syncDebounce);
        this._syncDebounce = setTimeout(async () => {
            try {
                const freshStorage = new DropboxProvider();
                const result = await freshStorage.openDirectory(() => { });
                if (!result) return;

                const existingIds = new Set((this._rawNodes || []).map(n => n.id));
                const freshIds = new Set(result.nodes.map(n => n.id));
                let changed = false;
                if (existingIds.size !== freshIds.size) {
                    changed = true;
                } else {
                    for (const id of freshIds) {
                        if (!existingIds.has(id)) { changed = true; break; }
                    }
                }

                if (changed) {
                    storage = freshStorage;
                    // Preserve tags by path so they don't disappear after move/sync (config may not have new path yet)
                    const pathToTag = new Map();
                    for (const n of this._nodes) {
                        if (n._tag) {
                            const p = n._dbxPath ?? n.path;
                            if (p) pathToTag.set(p, n._tag);
                        }
                    }
                    for (const n of result.nodes) {
                        const existing = this._nodeMap?.get(n.id);
                        if (existing) {
                            n.x = existing.x; n.y = existing.y;
                            n.vx = existing.vx || 0; n.vy = existing.vy || 0;
                        }
                    }
                    const { nodes, edges } = this._groupFiles(result.nodes, result.edges);
                    this._rawNodes = result.nodes;
                    this._rawEdges = result.edges;
                    for (const n of nodes) {
                        if (n.type === 'file-group') {
                            const existing = this._nodeMap?.get(n.id);
                            if (existing) { n.x = existing.x; n.y = existing.y; }
                        } else {
                            const p = n._dbxPath ?? n.path;
                            if (p && pathToTag.has(p)) n._tag = pathToTag.get(p);
                        }
                    }
                    this._nodes = nodes;
                    this._edges = edges;
                    this._nodeMap = new Map(nodes.map(n => [n.id, n]));
                    ForceLayout.nodes = this._nodes;
                    ForceLayout.edges = this._edges;
                    ForceLayout._calcTreeDepths(this._nodes, this._edges);
                    ForceLayout.reheat(this._clusterMode === 'strict' ? 0 : 0.3);
                    if (this._clusterMode === 'strict') {
                        ForceLayout.applyStrictLayout({ onlyUnpositioned: true });
                    }
                    Renderer.loadGraph(this._nodes, this._edges);
                    Renderer.markDirty();
                    this._renderSidebarTree(this._nodes);
                    this._updateStats(this._nodes);
                    Search.load(this._nodes);
                    await this._applyTagsFromConfig();
                    Renderer.markDirty();
                    Utils.toast('☁ Dropbox: синхронизировано', 'info', 1500);
                }
            } catch (e) {
                console.warn('[Dropbox Sync] Error:', e.message);
            }
        }, 2000);
    },

    disconnectDropbox() {
        DropboxAuth.logout();
        storage = new LocalFileSystemProvider();
        isDropboxMode = false;
        Utils.hide(Utils.el('btn-sync-dropbox'));
        this.goHome();
    },

    // ── CRUD context menu actions ──────────────────────────
    async ctx_delete() {
        Utils.hide(Utils.el('context-menu'));
        const node = this._nodeMap.get(this._ctxTargetId);
        if (!node) return;

        const confirmed = confirm(`Удалить «${node.name}»?\n\nЭто действие необратимо!`);
        if (!confirmed) return;

        const pathToRemoveFromTags = node._dbxPath ?? node.path;
        // OPTIMISTIC: remove from graph immediately
        const descendants = new Set();
        const collectDescendants = (id) => {
            descendants.add(id);
            this._edges.filter(e => e.source === id).forEach(e => collectDescendants(e.target));
        };
        collectDescendants(node.id);

        const backupNodes = [...this._nodes];
        const backupEdges = [...this._edges];

        this._nodes = this._nodes.filter(n => !descendants.has(n.id));
        this._edges = this._edges.filter(e => !descendants.has(e.source) && !descendants.has(e.target));

        this._applyGraph(0.4);
        Utils.toast(`Удалено: ${node.name}`, 'success');
        ActivityLog.add({
            type: 'delete',
            title: `Удаление «${node.name}»`,
            status: 'success',
            tags: [node.name, (pathToRemoveFromTags || node.path || '').replace(/^\//, '')],
        });

        // BACKGROUND: API call
        try {
            if (isDropboxMode && storage.deleteNode) {
                await storage.deleteNode(node);
                if (pathToRemoveFromTags) await this._persistTagsConfig(pathToRemoveFromTags, null);
                this._syncDropboxNow();
            }
        } catch (e) {
            if (e.message && e.message.includes('not_found')) {
                console.warn('[Delete] Already deleted on server, ignoring:', e.message);
            } else {
                // ROLLBACK
                this._nodes = backupNodes;
                this._edges = backupEdges;
                this._applyGraph(0);
                Utils.toast(`Ошибка удаления: ${e.message}`, 'error', 3000);
                ActivityLog.add({ type: 'delete', title: `Ошибка удаления: ${node.name}`, status: 'error', tags: [e.message] });
            }
        }
    },

    async ctx_copyNode() {
        Utils.hide(Utils.el('context-menu'));
        const node = this._nodeMap.get(this._ctxTargetId);
        if (!node) return;

        if (!isDropboxMode || !storage.copyNode) {
            Utils.toast('Дублирование доступно только для Dropbox', 'info', 3000);
            return;
        }

        const parent = this._nodeMap.get(node.parentId);
        if (!parent) return;

        this._showLoading('КОПИРОВАНИЕ…');
        try {
            const meta = await storage.copyNode(node, parent);
            const newPath = meta.path_display;
            const newId = Utils.hashStr(newPath);

            const newNode = {
                id: newId, name: meta.name, path: newPath,
                type: node.type, sizeBytes: node.sizeBytes, subtreeSizeBytes: node.sizeBytes,
                modifiedAt: new Date(), parentId: node.parentId, handle: null,
                _radius: node._radius, _dbxPath: newPath,
            };
            const newEdge = { id: `${node.parentId}-${newId}`, source: node.parentId, target: newId };

            this._nodes.push(newNode);
            this._edges.push(newEdge);
            this._nodeMap.set(newId, newNode);

            Renderer.loadGraph(this._nodes, this._edges);
            ForceLayout.nodes = this._nodes;
            ForceLayout.edges = this._edges;
            ForceLayout._calcTreeDepths(this._nodes, this._edges);
            ForceLayout.reheat(0.5);
            Renderer.markDirty();
            this._renderSidebarTree(this._nodes);

            Utils.toast(`Скопировано: ${meta.name}`, 'success');
        } catch (e) {
            Utils.toast(`Ошибка копирования: ${e.message}`, 'error', 3000);
        } finally {
            this._hideLoading();
        }
    },

    async ctx_rename() {
        Utils.hide(Utils.el('context-menu'));
        const node = this._nodeMap.get(this._ctxTargetId);
        if (!node) return;

        // Use inline input at node position instead of browser prompt
        Renderer.showInlineInput(node.x, node.y, node.name, async (newName) => {
            if (!newName || newName === node.name) return;

            if (isDropboxMode && storage.renameNode) {
                const oldPath = node._dbxPath ?? node.path;
                this._showLoading('ПЕРЕИМЕНОВАНИЕ…');
                try {
                    await storage.renameNode(node, newName);
                    if (node._tag) await this._persistTagsConfigPathMove(oldPath, node._dbxPath ?? node.path, node._tag);
                    this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));
                    Renderer.markDirty();
                    this._renderSidebarTree(this._nodes);
                    Utils.toast(`Переименовано в: ${newName}`, 'success');
                    ActivityLog.add({
                        type: 'rename',
                        title: 'Переименование',
                        status: 'success',
                        tags: [node.name, newName],
                    });
                } catch (e) {
                    Utils.toast(`Ошибка: ${e.message}`, 'error', 3000);
                    ActivityLog.add({ type: 'rename', title: `Ошибка переименования: ${node.name}`, status: 'error', tags: [e.message] });
                } finally {
                    this._hideLoading();
                }
            } else {
                Utils.toast('Переименование доступно только для Dropbox', 'info', 3000);
            }
        });
    },

    // ── Tags system (persisted in Dropbox /aetherfs-tags.json) ──
    _tagColors: {
        urgent: '#ff4444',
        review: '#ffaa00',
        wip: '#44aaff',
        done: '#44cc44',
        important: '#cc44ff',
    },

    /** Persist one path→tag change to Dropbox config. tag=null removes path. */
    async _persistTagsConfig(path, tag) {
        if (!isDropboxMode || !storage.readTagsConfig || !storage.writeTagsConfig) return;
        try {
            const data = await storage.readTagsConfig() || { pathToTag: {} };
            if (!data.pathToTag) data.pathToTag = {};
            if (tag) data.pathToTag[path] = tag; else delete data.pathToTag[path];
            await storage.writeTagsConfig(data);
        } catch (e) {
            console.warn('[Tags] Failed to persist:', e.message);
            Utils.toast('Не удалось сохранить теги в Dropbox', 'error', 2000);
        }
    },

    /** Update config when a node is moved/renamed: oldPath → newPath, keep tag. */
    async _persistTagsConfigPathMove(oldPath, newPath, tag) {
        if (!tag || !isDropboxMode || !storage.readTagsConfig || !storage.writeTagsConfig) return;
        try {
            const data = await storage.readTagsConfig() || { pathToTag: {} };
            if (!data.pathToTag) data.pathToTag = {};
            delete data.pathToTag[oldPath];
            data.pathToTag[newPath] = tag;
            await storage.writeTagsConfig(data);
        } catch (e) {
            console.warn('[Tags] Failed to update path:', e.message);
        }
    },

    async ctx_setTag(tag) {
        Utils.hide(Utils.el('context-menu'));
        const node = this._nodeMap.get(this._ctxTargetId);
        if (!node) return;
        if (node._tag === tag) {
            node._tag = null;
        } else {
            node._tag = tag;
        }
        Renderer.markDirty();
        const path = node._dbxPath ?? node.path;
        if (path && isDropboxMode) await this._persistTagsConfig(path, node._tag);
        Utils.toast(node._tag ? `Тег: #${tag}` : 'Тег снят', 'info', 1500);
    },

    // ── Per-folder grouping ─────────────────────────────────
    ctx_toggleGroupFolder() {
        Utils.hide(Utils.el('context-menu'));
        const node = this._nodeMap.get(this._ctxTargetId);
        if (!node || node.type !== 'folder') return;

        if (this._groupedFolders.has(node.id)) {
            this._groupedFolders.delete(node.id);
            Utils.toast(`Группировка снята: ${node.name}`, 'info', 1500);
        } else {
            this._groupedFolders.add(node.id);
            Utils.toast(`Файлы сгруппированы: ${node.name}`, 'success', 1500);
        }

        // Re-run grouping
        if (!this._rawNodes || !this._rawEdges) this._syncRawData();
        const rawNodes = this._rawNodes.map(n => ({ ...n }));
        const rawEdges = this._rawEdges.map(e => ({ ...e }));
        const { nodes, edges } = this._groupFiles(rawNodes, rawEdges);
        this._nodes = nodes;
        this._edges = edges;
        this._applyGraph(0.3);
    },

    // ── Comments / Notes ────────────────────────────────────
    saveComment(nodeId, text) {
        if (!nodeId) return;
        if (text && text.trim()) {
            this._nodeComments.set(nodeId, text.trim());
        } else {
            this._nodeComments.delete(nodeId);
        }
        this._persistComments();
    },

    _persistComments() {
        try {
            const data = {};
            for (const [id, text] of this._nodeComments) data[id] = text;
            localStorage.setItem('aetherfs-comments', JSON.stringify(data));
        } catch (e) { /* ignore */ }
    },

    _loadComments() {
        try {
            const raw = localStorage.getItem('aetherfs-comments');
            if (raw) {
                const data = JSON.parse(raw);
                for (const [id, text] of Object.entries(data)) {
                    this._nodeComments.set(id, text);
                }
            }
        } catch (e) { /* ignore */ }
    },

    // ── Favorites ───────────────────────────────────────────
    ctx_toggleFavorite() {
        Utils.hide(Utils.el('context-menu'));
        const node = this._nodeMap.get(this._ctxTargetId);
        if (!node) return;

        if (this._favorites.has(node.id)) {
            this._favorites.delete(node.id);
            Utils.toast(`Убрано из Избранного: ${node.name}`, 'info', 1500);
        } else {
            this._favorites.add(node.id);
            Utils.toast(`Добавлено в Избранное: ${node.name}`, 'success', 1500);
        }

        this._persistFavorites();
        Renderer.markDirty();
    },

    _persistFavorites() {
        try {
            localStorage.setItem('aetherfs-favorites', JSON.stringify([...this._favorites]));
        } catch (e) { /* ignore */ }
    },

    _loadFavorites() {
        try {
            const raw = localStorage.getItem('aetherfs-favorites');
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    this._favorites = new Set(arr);
                }
            }
        } catch (e) { /* ignore */ }
    }
};

export default App;
