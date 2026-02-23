/**
 * AetherFS – Main Application Controller
 */

'use strict';

const AetherApp = {
    _nodes: [],
    _edges: [],
    _nodeMap: new Map(),
    _selectedNode: null,
    _heatmapOn: false,
    _revokableURLs: [],
    _ctxTargetId: null,
    _clusterMode: 'folder',

    init() {
        Renderer.init('aether-canvas', 'minimap-canvas');

        document.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT') return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); this.openSearch(); }
            if (e.key === 'Escape') {
                this.closeSearch(null);
                this.closePreview();
                Utils.hide(Utils.el('context-menu'));
                Utils.hide(Utils.el('create-menu'));
                Renderer.deselect();
            }
            if (e.key === 'h' || e.key === 'H') this.toggleHeatmap();
            if (e.key === 'f' || e.key === 'F') this.fitView();
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#context-menu') && !e.target.closest('#create-menu')) {
                Utils.hide(Utils.el('context-menu'));
                Utils.hide(Utils.el('create-menu'));
            }
        });

        // Bind layout mode buttons
        document.querySelectorAll('.cluster-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                document.querySelectorAll('.cluster-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.setLayoutMode(mode);
            });
        });
    },

    setLayoutMode(mode) {
        if (!window.ForceLayout) return;
        window.ForceLayout.setMode(mode);
        if (mode === 'radial' || mode === 'strict') {
            window.ForceLayout.reheat(0.8);
        } else {
            window.ForceLayout.reheat(0.4);
        }
    },

    async openDirectory() {
        if (!('showDirectoryPicker' in window)) {
            Utils.toast('File System Access API not supported — loading demo', 'error', 3000);
            setTimeout(() => this.loadDemo(), 1000);
            return;
        }
        this._showLoading('OPENING DIRECTORY…');
        let result;
        try {
            result = await FileSystem.openDirectory((count, name) => {
                Utils.el('loading-text').textContent = 'SCANNING FILESYSTEM…';
                Utils.el('loading-sub').textContent = `${count} items · ${name}`;
            });
        } catch (e) {
            this._hideLoading();
            if (e.name !== 'AbortError') Utils.toast(`Error: ${e.message}`, 'error');
            return;
        }
        if (!result) { this._hideLoading(); return; }
        this._loadGraph(result.nodes, result.edges, FileSystem.rootName);
    },

    loadDemo() {
        this._showLoading('GENERATING DEMO…');
        setTimeout(() => {
            const r = FileSystem.generateDemo();
            this._loadGraph(r.nodes, r.edges, 'my-project [DEMO]');
        }, 300);
    },

    _loadGraph(nodes, edges, rootName) {
        this._edges = edges;
        this._nodeMap = new Map(nodes.map(n => [n.id, n]));
        Search.load(nodes);

        // Show graph screen FIRST so the canvas has real dimensions
        Utils.hide(Utils.el('landing-screen'));
        Utils.show(Utils.el('graph-screen'));

        // Now resize the canvas (screen is visible → clientWidth/Height are correct)
        Renderer.resize();

        Utils.el('toolbar-path').textContent = rootName || '';
        this._updateStats(nodes);
        this._renderSidebarTree(nodes);

        // Init physics — assigns randomized x,y to each node
        ForceLayout.init(nodes, edges, this._clusterMode, (laidNodes, done) => {
            this._nodes = laidNodes;
            this._nodeMap = new Map(laidNodes.map(n => [n.id, n]));
            Renderer.loadGraph(laidNodes, edges);
            Renderer.markDirty();
            if (done) this._hideLoading();
        });

        // Immediately render the initial (random) positions
        this._nodes = ForceLayout.nodes;
        Renderer.loadGraph(ForceLayout.nodes, edges);
        Renderer.markDirty();

        ForceLayout.start();

        // Fit view after a couple of animation frames
        requestAnimationFrame(() => requestAnimationFrame(() => Renderer.fitView()));

        Utils.el('loading-text').textContent = 'LAYING OUT GRAPH…';
        Utils.el('loading-sub').textContent = `${nodes.length} nodes — simulating…`;
    },

    _updateStats(nodes) {
        const n = nodes || this._nodes;
        Utils.el('stat-nodes').textContent = n.length;
        Utils.el('stat-files').textContent = n.filter(x => x.type !== 'folder').length;
        Utils.el('stat-size').textContent = Utils.formatSize(
            n.filter(x => x.type !== 'folder').reduce((s, x) => s + (x.sizeBytes || 0), 0)
        );
    },

    _showLoading(text) {
        Utils.el('loading-text').textContent = text || 'LOADING…';
        Utils.el('loading-sub').textContent = '';
        Utils.show(Utils.el('loading-overlay'));
    },

    _hideLoading() {
        Utils.hide(Utils.el('loading-overlay'));
        Renderer.fitView();
    },

    // ── Sidebar Tree ─────────────────────────────────────────
    _renderSidebarTree(nodes) {
        const container = Utils.el('tree-container');
        if (!container) return;

        const childrenMap = new Map();
        let rootNode = null;
        for (const n of nodes) {
            if (!n.parentId) rootNode = n;
            else {
                if (!childrenMap.has(n.parentId)) childrenMap.set(n.parentId, []);
                childrenMap.get(n.parentId).push(n);
            }
        }

        for (const list of childrenMap.values()) {
            list.sort((a, b) => {
                if (a.type === 'folder' && b.type !== 'folder') return -1;
                if (b.type === 'folder' && a.type !== 'folder') return 1;
                return a.name.localeCompare(b.name);
            });
        }

        const buildHTML = (node) => {
            const isFolder = node.type === 'folder';
            const children = childrenMap.get(node.id) || [];

            let html = `
                <div class="tree-item" data-id="${node.id}" onclick="AetherApp.onSidebarClick(event, '${node.id}')">
                    ${isFolder ? `<span class="tree-expander open" onclick="AetherApp.toggleSidebarFolder(event, this)">▼</span>` : '<span style="width:14px;display:inline-block"></span>'}
                    <div style="background: ${NodeTypes.color(node.type)}; width: 8px; height: 8px; display: inline-block; margin-right: 8px; opacity: 0.8;"></div>
                    <span class="tree-item-label">${node.name}</span>
                </div>
            `;

            if (isFolder && children.length > 0) {
                html += `<div class="tree-children">`;
                for (const c of children) html += buildHTML(c);
                html += `</div>`;
            }
            return html;
        };

        if (rootNode) container.innerHTML = buildHTML(rootNode);
        else container.innerHTML = '<div style="opacity:0.5; text-align:center; padding: 20px 0;">Empty</div>';
    },

    onSidebarClick(e, id) {
        document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
        const target = e.currentTarget;
        if (target) target.classList.add('selected');
        this.onNodeSelect(id);
        Renderer.panTo(id, 1.5);
    },

    toggleSidebarFolder(e, expanderEl) {
        e.stopPropagation();
        const isOpen = expanderEl.classList.contains('open');
        const childrenContainer = expanderEl.closest('.tree-item').nextElementSibling;

        if (isOpen) {
            expanderEl.classList.remove('open');
            expanderEl.textContent = '▶';
            if (childrenContainer && childrenContainer.classList.contains('tree-children')) childrenContainer.style.display = 'none';
        } else {
            expanderEl.classList.add('open');
            expanderEl.textContent = '▼';
            if (childrenContainer && childrenContainer.classList.contains('tree-children')) childrenContainer.style.display = 'block';
        }
    },

    // ── Preview & Selection ──────────────────────────────────
    onNodeSelect(id) {
        const node = this._nodeMap.get(id);
        if (!node) return;
        this._selectedNode = node;
        this._openPreview(node);

        // Also highlight in tree
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
        Utils.el('meta-size').textContent = node.type === 'folder'
            ? `${Utils.formatSize(node.subtreeSizeBytes)} total` : Utils.formatSize(node.sizeBytes);
        Utils.el('meta-modified').textContent = Utils.formatDate(node.modifiedAt);
        const pathEl = Utils.el('meta-path');
        pathEl.textContent = node.path; pathEl.title = node.path;

        const previewArea = Utils.el('panel-preview-area');
        previewArea.innerHTML = '';

        if (node.handle) {
            if (node.type === 'image') {
                const url = await FileSystem.readFileURL(node.handle).catch(() => null);
                if (url) { this._revokableURLs.push(url); const img = document.createElement('img'); img.src = url; previewArea.appendChild(img); }
                else this._placeholderPreview(previewArea, node);
            } else if (node.type === 'code' || node.type === 'document') {
                const text = await FileSystem.readFileText(node.handle).catch(() => null);
                if (text !== null) { const pre = document.createElement('pre'); pre.className = 'preview-code'; pre.textContent = text.slice(0, 3000); previewArea.appendChild(pre); }
                else this._placeholderPreview(previewArea, node);
            } else if (node.type === 'video') {
                const url = await FileSystem.readFileURL(node.handle).catch(() => null);
                if (url) { this._revokableURLs.push(url); const v = document.createElement('video'); v.src = url; v.controls = true; v.style.maxHeight = '220px'; previewArea.appendChild(v); }
                else this._placeholderPreview(previewArea, node);
            } else if (node.type === 'audio') {
                const url = await FileSystem.readFileURL(node.handle).catch(() => null);
                if (url) { this._revokableURLs.push(url); const a = document.createElement('audio'); a.src = url; a.controls = true; a.style.width = '90%'; previewArea.appendChild(a); }
                else this._placeholderPreview(previewArea, node);
            } else this._placeholderPreview(previewArea, node);
        } else this._placeholderPreview(previewArea, node);

        Utils.show(panel);
    },

    _placeholderPreview(container, node) {
        container.innerHTML = `<div class="preview-placeholder"><div style="background:${NodeTypes.color(node.type)}; width:32px; height:32px; display:inline-block; margin-bottom:12px;"></div><p style="color:${NodeTypes.hexToRgba(NodeTypes.color(node.type), 0.6)}">${NodeTypes.label(node.type).toUpperCase()}</p></div>`;
    },

    closePreview() { Utils.hide(Utils.el('preview-panel')); this._selectedNode = null; Renderer.deselect(); },
    async openSelectedFile() { Utils.toast('Open is available via File System Access API in Chrome/Edge', 'info'); },
    copyPath() { if (this._selectedNode) Utils.copyText(this._selectedNode.path); },

    setClusterMode(mode) {
        this._clusterMode = mode;
        document.querySelectorAll('.cluster-btn').forEach(b => b.classList.remove('active'));
        const btn = Utils.el(`cluster-${mode}`); if (btn) btn.classList.add('active');
        ForceLayout.setClusterMode(mode);
        Utils.toast(`Clustering by ${mode}`, 'info', 1500);
    },

    toggleHeatmap() {
        this._heatmapOn = !this._heatmapOn;
        Renderer.heatmapMode = this._heatmapOn;
        Renderer.markDirty();
        const hbtn = Utils.el('btn-heatmap'), legend = Utils.el('heatmap-legend');
        if (this._heatmapOn) {
            hbtn.classList.add('active'); Utils.show(legend); this._buildHeatmapLegend();
            Utils.toast('Heatmap ON', 'info', 1500);
        } else {
            hbtn.classList.remove('active'); Utils.hide(legend);
            Utils.toast('Heatmap OFF', 'info', 1500);
        }
    },

    _buildHeatmapLegend() {
        const folders = this._nodes.filter(n => n.type === 'folder')
            .sort((a, b) => (b.subtreeSizeBytes || 0) - (a.subtreeSizeBytes || 0)).slice(0, 5);
        const maxSize = folders[0] ? folders[0].subtreeSizeBytes : 1;
        Utils.el('legend-entries').innerHTML = folders.map(f => {
            const ratio = (f.subtreeSizeBytes || 0) / maxSize;
            const color = NodeTypes.heatColor(ratio);
            return `<div class="legend-entry"><div class="legend-entry-dot" style="background:${color}"></div><div class="legend-entry-name">${f.name}</div><div class="legend-entry-size">${Utils.formatSize(f.subtreeSizeBytes)}</div></div>`;
        }).join('');
    },

    openSearch() {
        Utils.show(Utils.el('search-overlay'));
        const inp = Utils.el('search-input'); inp.value = ''; inp.focus();
        Utils.el('search-results').innerHTML = '<div class="search-empty">Start typing to search…</div>';
    },

    closeSearch(e) { if (!e || e.target === Utils.el('search-overlay')) Utils.hide(Utils.el('search-overlay')); },

    onSearchInput: null,

    _onSearchInput(value) {
        const results = Search.query(value);
        Search.renderResults(Utils.el('search-results'), results, value, (id) => {
            Utils.hide(Utils.el('search-overlay'));
            this._flyToNode(id);
        });
    },

    _flyToNode(id) {
        Renderer.selectNode(id);
        Renderer.highlightNode(id);
        Renderer.panTo(id, 1.8);
        Renderer.setDimMode(true, null);
        setTimeout(() => Renderer.setDimMode(false), 3000);
    },

    onConnectionDrop(srcNode, cx, cy, wx, wy) {
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
        const name = prompt(`Enter new ${isFolder ? 'folder' : 'file'} name:`, `New ${isFolder ? 'Folder' : 'File'}${isFolder ? '' : '.txt'}`);
        if (!name) return;

        let handle = null;
        if (srcNode.handle) {
            handle = isFolder ? await FileSystem.createFolder(srcNode.id, name) : await FileSystem.createFile(srcNode.id, name);
            if (!handle) {
                Utils.toast('Failed to create on disk', 'error');
                return;
            }
        }

        const path = srcNode.path + '/' + name;
        const id = handle ? Utils.hashStr(path) : 'virtual_' + Date.now() + Math.floor(Math.random() * 1000);
        const inferredType = isFolder ? 'folder' : NodeTypes.infer(name, false);
        const newNode = {
            id,
            name,
            path: path,
            type: inferredType,
            sizeBytes: isFolder ? 0 : 1024,
            modifiedAt: new Date(),
            parent: srcNode.id,
            parentId: srcNode.id,
            handle: handle || null,
            x: wx,
            y: wy,
            vx: 0,
            vy: 0,
            fx: wx, // Pin the newly created node physically by default
            fy: wy,
            _radius: NodeTypes.radius(1024, isFolder)
        };

        const newEdge = { id: srcNode.id + '->' + id, source: srcNode.id, target: id };
        this._nodes.push(newNode);
        this._edges.push(newEdge);

        Renderer._nodeMap.set(id, newNode);

        // Update tree and search
        this._renderSidebarTree(this._nodes);
        Search.index(this._nodes);

        if (window.ForceLayout) {
            window.ForceLayout.nodes.push(newNode);
            const edge = { source: srcNode.id, target: id };
            window.ForceLayout.edges.push(edge);

            // Re-calculate depths so STRICT and RADIAL modes know about the new tier
            window.ForceLayout._calcTreeDepths(window.ForceLayout.nodes, window.ForceLayout.edges);

            window.ForceLayout.reheat(0.3);
            Renderer.nodes = window.ForceLayout.nodes; // CRITICAL: Point Renderer to physics nodes
            Renderer.edges = window.ForceLayout.edges;
        } else {
            Renderer.nodes = this._nodes;
            Renderer.edges = this._edges;
        }

        Renderer.selectNode(id);
    },

    showContextMenu(x, y, nodeId) {
        this._ctxTargetId = nodeId;
        const m = Utils.el('context-menu');
        m.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
        m.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
        Utils.show(m);
    },

    ctx_open() { this.openSelectedFile(); },
    ctx_copyPath() { const n = this._nodeMap.get(this._ctxTargetId); if (n) Utils.copyText(n.path); },
    ctx_focusType() {
        const n = this._nodeMap.get(this._ctxTargetId); if (!n) return;
        Renderer.setDimMode(true, n.type);
        Utils.toast(`Showing: ${NodeTypes.label(n.type)}`, 'info', 2000);
        setTimeout(() => Renderer.setDimMode(false), 4000);
    },
    ctx_expandCluster() {
        const n = this._nodeMap.get(this._ctxTargetId); if (!n) return;
        const childIds = new Set(this._edges.filter(e => e.source === n.id).map(e => e.target));
        childIds.add(n.id);
        Renderer.setDimMode(true, null);
        for (const node of Renderer.nodes) node._dimOverride = !childIds.has(node.id);
        Renderer.markDirty();
        setTimeout(() => { Renderer.setDimMode(false); for (const node of Renderer.nodes) node._dimOverride = false; Renderer.markDirty(); }, 4000);
        Utils.toast(`Showing children of "${n.name}"`, 'info', 2000);
    },

    fitView() { Renderer.fitView(); },
    zoom(f) { Renderer.zoom(f); },

    goHome() {
        ForceLayout.stop();
        for (const url of this._revokableURLs) URL.revokeObjectURL(url);
        this._revokableURLs = [];
        ['graph-screen', 'preview-panel', 'heatmap-legend', 'context-menu', 'search-overlay'].forEach(id => Utils.hide(Utils.el(id)));
        Utils.el('btn-heatmap').classList.remove('active');
        this._heatmapOn = false; Renderer.heatmapMode = false;
        Renderer.nodes = []; Renderer.edges = []; Renderer._nodeMap = new Map();
        Utils.show(Utils.el('landing-screen'));
    },

    triggerPulse(src, tgt) { Renderer.addPulse(src, tgt); },
};

document.addEventListener('DOMContentLoaded', () => {
    AetherApp.init();

    const debouncedSearch = Utils.debounce((v) => AetherApp._onSearchInput(v), 120);
    AetherApp.onSearchInput = (v) => debouncedSearch(v);
    window.AetherApp = AetherApp;

    Utils.el('search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') AetherApp.closeSearch({ target: Utils.el('search-overlay') });
    });

    // Periodic sync pulses (after graph loads)
    let pulseInterval = null;
    const origHide = AetherApp._hideLoading.bind(AetherApp);
    AetherApp._hideLoading = function () {
        origHide();
        if (!pulseInterval) pulseInterval = setInterval(() => {
            if (AetherApp._edges.length > 1) {
                const e = AetherApp._edges[Math.floor(Math.random() * AetherApp._edges.length)];
                Renderer.addPulse(e.source, e.target);
            }
        }, 1800);
    };

    console.log('%c⬡ AETHERFS%c loaded', 'color:#00f5ff;font-family:Orbitron,monospace;font-size:16px;font-weight:bold', 'color:#4a6080');
});
