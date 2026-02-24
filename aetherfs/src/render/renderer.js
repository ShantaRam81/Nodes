/**
 * AetherFS – Canvas Renderer
 * High-performance 2D Canvas renderer.
 * Phase 5 Aesthetic: Grayscale, 8px rounded corners, Bezier curves, subtle shadows.
 */

import { Utils } from '../core/utils.js';
import { NodeTypes } from '../core/nodeTypes.js';
import { ForceLayout } from './forceLayout.js';

export const Renderer = {
    canvas: null,
    ctx: null,
    miniCanvas: null,
    miniCtx: null,
    appHooks: null, // Callback map to decouple from global App

    _cam: { x: 0, y: 0, scale: 1 },
    _targetCam: { x: 0, y: 0, scale: 1 },

    _drag: null,
    _hoveredId: null,
    _selectedId: null,
    _selectedIds: new Set(), // Multi-selection
    _draggingNodes: [],      // при перетаскивании — все ноды, которые двигаются (включая выделенные)
    _draggingStartPositions: null, // Map id -> { x, y } на момент начала перетаскивания

    nodes: [],
    edges: [],
    _nodeMap: new Map(),

    heatmapMode: false,
    _highlightId: null,
    _dimMode: false,
    _focusType: null,
    _dashOffset: 0,
    _animFrame: 0,
    _selectionRect: null, // { x1, y1, x2, y2 } in world coords
    _ctrlDown: false,
    _uploadPickerMode: false,
    _pathHighlightIds: new Set(), // IDs of nodes in the highlighted path

    /** Радиус круга файла (px). Меняй это значение, чтобы регулировать размер. */
    FILE_CIRCLE_RADIUS: 10,

    _raf: null,
    _dirty: true,

    init(canvasId, miniCanvasId, appHooks) {
        this.appHooks = appHooks || {};
        this.canvas = Utils.el(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.miniCanvas = Utils.el(miniCanvasId);
        this.miniCtx = this.miniCanvas.getContext('2d');
        this._bindEvents();
        this._loop();
    },

    resize() {
        this._resize();
    },

    _resize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const container = this.canvas.parentElement;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || (window.innerHeight - 52);
        this.canvas.width = w;
        this.canvas.height = h;
        this._dirty = true;
    },

    loadGraph(nodes, edges) {
        this.nodes = nodes;
        this.edges = edges;
        this._nodeMap = new Map(nodes.map(n => [n.id, n]));
        this._dirty = true;
    },

    _loop() {
        if (this.canvas.width === 0 || this.canvas.height === 0) this._resize();

        const lerp = 0.12;
        this._cam.x += (this._targetCam.x - this._cam.x) * lerp;
        this._cam.y += (this._targetCam.y - this._cam.y) * lerp;
        this._cam.scale += (this._targetCam.scale - this._cam.scale) * lerp;

        const camMoved = Math.abs(this._targetCam.x - this._cam.x) > 0.1 ||
            Math.abs(this._targetCam.y - this._cam.y) > 0.1 ||
            Math.abs(this._targetCam.scale - this._cam.scale) > 0.001;

        if (this._dirty || camMoved || ForceLayout.running || this._drawingConnectionSrc || this._uploadPickerMode) {
            this._render();
            this._renderMinimap();
            this._dirty = false;
        }

        this._updateZoomLabel();
        this._raf = requestAnimationFrame(() => this._loop());
    },

    markDirty() { this._dirty = true; },

    _getThemeColors() {
        const style = getComputedStyle(document.documentElement);
        return {
            bg: style.getPropertyValue('--canvas-bg').trim() || '#111111',
            dot: style.getPropertyValue('--canvas-dot').trim() || 'rgba(255,255,255,0.06)',
            nodeBg: style.getPropertyValue('--canvas-node-bg').trim() || '#1a1a1a',
            nodeBgSel: style.getPropertyValue('--canvas-node-bg-sel').trim() || '#262626',
            nodeBorder: style.getPropertyValue('--canvas-node-border').trim() || '#333333',
            nodeBorderHov: style.getPropertyValue('--canvas-node-border-hover').trim() || '#555555',
            edge: style.getPropertyValue('--canvas-edge').trim() || 'rgba(255,255,255,0.2)',
            edgeSel: style.getPropertyValue('--canvas-edge-sel').trim() || 'rgba(255,255,255,0.8)',
            text: style.getPropertyValue('--canvas-text').trim() || '#d1d5db',
            textSel: style.getPropertyValue('--canvas-text-sel').trim() || '#ffffff',
        };
    },

    _render() {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        if (W === 0 || H === 0) return;

        const cam = this._cam;
        const nodes = this.nodes;
        const edges = this.edges;
        const T = this._getThemeColors();

        // Фон — сплошной цвет в экранных координатах
        ctx.fillStyle = T.bg;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.translate(W / 2 + cam.x, H / 2 + cam.y);
        ctx.scale(cam.scale, cam.scale);

        // Точечная сетка в мировых координатах: при отдалении точки визуально уменьшаются
        const dotSpacing = 25;
        const dotR = 1;
        const vw = (W / cam.scale) + dotSpacing * 2;
        const vh = (H / cam.scale) + dotSpacing * 2;
        const cx = -cam.x / cam.scale;
        const cy = -cam.y / cam.scale;
        ctx.fillStyle = T.dot;
        for (let x = cx - vw; x < cx + vw; x += dotSpacing) {
            for (let y = cy - vh; y < cy + vh; y += dotSpacing) {
                ctx.beginPath();
                ctx.arc(x, y, dotR, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (this.heatmapMode) this._drawHeatmapAuras(ctx, nodes);
        const visibleNodes = this._getVisibleNodes(nodes);
        this._drawEdges(ctx, edges, visibleNodes, T);
        this._drawActiveConnection(ctx, T);
        this._drawNodes(ctx, visibleNodes, cam, T);

        // Draw selection rectangle
        if (this._selectionRect) {
            const r = this._selectionRect;
            ctx.strokeStyle = 'rgba(100, 150, 255, 0.7)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            const rx = Math.min(r.x1, r.x2), ry = Math.min(r.y1, r.y2);
            const rw = Math.abs(r.x2 - r.x1), rh = Math.abs(r.y2 - r.y1);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.fillStyle = 'rgba(100, 150, 255, 0.08)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.setLineDash([]);
        }

        ctx.restore();

        // Increment animation counter
        this._animFrame++;
        this._dashOffset = (this._dashOffset + 0.5) % 16;
    },

    setFilesVisible(visible) {
        this._filesVisible = visible;
        this._dirty = true;
    },

    _getVisibleNodes(nodes) {
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        return nodes.filter(n => {
            if (n._tempHidden) return false;
            // Filter files if visibility is turned off
            if (this._filesVisible === false && n.type !== 'folder') return false;

            let curr = n;
            while (curr && curr.parentId) {
                const parent = nodeMap.get(curr.parentId);
                if (parent && parent.collapsed) return false;
                curr = parent;
            }
            return true;
        });
    },

    _drawEdges(ctx, edges, visibleNodes, T) {
        const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));
        for (const e of edges) {
            const src = nodeMap.get(e.source);
            const tgt = nodeMap.get(e.target);
            if (!src || !tgt || src.x == null || tgt.x == null) continue;

            const isSel = src.id === this._selectedId || tgt.id === this._selectedId ||
                this._selectedIds.has(src.id) || this._selectedIds.has(tgt.id);

            // Path highlight: dim edges not in path
            const pathActive = this._pathHighlightIds.size > 0;
            const inPath = pathActive && this._pathHighlightIds.has(src.id) && this._pathHighlightIds.has(tgt.id);
            if (pathActive && !inPath) {
                ctx.save();
                ctx.globalAlpha = 0.08;
            }

            // Elastic S-curve Bezier from right port to left edge
            const srcHalf = this._isFolderShape(src) ? 70 : this.FILE_CIRCLE_RADIUS;
            const tgtHalf = this._isFolderShape(tgt) ? 70 : this.FILE_CIRCLE_RADIUS;
            const startX = src.x + srcHalf;
            const endX = tgt.x - tgtHalf;
            const dx = Math.abs(endX - startX);
            const tension = Math.max(dx * 0.45, 60); // Elastic tension

            ctx.strokeStyle = (isSel || inPath) ? T.edgeSel : T.edge;
            ctx.lineWidth = (isSel || inPath) ? 2 : 1;

            ctx.beginPath();
            ctx.moveTo(startX, src.y);
            ctx.bezierCurveTo(
                startX + tension, src.y,
                endX - tension, tgt.y,
                endX, tgt.y
            );
            ctx.stroke();

            // Restore alpha for dimmed edges
            if (pathActive && !inPath) ctx.restore();
        }
    },

    _drawActiveConnection(ctx, T) {
        if (!this._drawingConnectionSrc || !this._drawingConnectionTo) return;
        const src = this._drawingConnectionSrc;
        const tgt = this._drawingConnectionTo;

        // Animated dashed Bezier curve
        ctx.strokeStyle = T.edgeSel;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -this._dashOffset;

        const srcHalf = this._isFolderShape(src) ? 70 : this.FILE_CIRCLE_RADIUS;
        const startX = src.x + srcHalf;
        ctx.beginPath();
        ctx.moveTo(startX, src.y);
        const dx = tgt.x - startX;
        const cp1x = startX + dx * 0.5;
        const cp2x = startX + dx * 0.5;
        ctx.bezierCurveTo(cp1x, src.y, cp2x, tgt.y, tgt.x, tgt.y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;

        // Target endpoint dot
        ctx.beginPath();
        ctx.arc(tgt.x, tgt.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = T.edgeSel;
        ctx.fill();
    },

    // File nodes drawn as circles; folders (and file-group) as rounded rects
    _isFolderShape(n) {
        return n.type === 'folder' || n.type === 'file-group';
    },

    _drawFavoriteStar(ctx, cx, cy) {
        const R = 7, r = 3; // outer and inner radius
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const aOut = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
            const aIn = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / 5;
            const xOut = cx + R * Math.cos(aOut);
            const yOut = cy + R * Math.sin(aOut);
            const xIn = cx + r * Math.cos(aIn);
            const yIn = cy + r * Math.sin(aIn);
            if (i === 0) ctx.moveTo(xOut, yOut);
            else ctx.lineTo(xOut, yOut);
            ctx.lineTo(xIn, yIn);
        }
        ctx.closePath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
    },

    _drawRect(ctx, x, y, width, height, radius = 8) {
        // Rounded corners for modern look
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    },

    _drawNodes(ctx, nodes, cam, T) {
        for (const n of nodes) {
            if (n.x == null) continue;

            // Timeline hidden: render as ghost
            if (n._timelineHidden) {
                ctx.save();
                ctx.globalAlpha = 0.08;
            }

            // Upload picker mode: dim non-folders, pulse folders
            const inUploadPicker = this._uploadPickerMode && !n._timelineHidden;
            if (inUploadPicker && n.type !== 'folder') {
                ctx.save();
                ctx.globalAlpha = 0.15;
            }

            const color = NodeTypes.color(n.type);
            const isSel = n.id === this._selectedId || this._selectedIds.has(n.id);
            const isHov = n.id === this._hoveredId;
            const isHlt = n.id === this._highlightId;
            const isDim = this._dimMode && this._focusType &&
                n.type !== this._focusType && n.id !== this._selectedId;
            // Path highlight dimming: if active, dim everything not in path
            const isPathDim = this._pathHighlightIds.size > 0 && !this._pathHighlightIds.has(n.id);

            ctx.save();
            ctx.globalAlpha = (isDim || isPathDim) ? 0.15 : 1;

            const isFolderShape = this._isFolderShape(n);
            const fileCircleR = this.FILE_CIRCLE_RADIUS;

            if (isFolderShape) {
                // ─── Folder / file-group: rounded rectangle ───
                const w = 140;
                const h = 36;
                const rx = n.x - w / 2;
                const ry = n.y - h / 2;

                ctx.fillStyle = isSel ? T.nodeBgSel : T.nodeBg;
                this._drawRect(ctx, rx, ry, w, h);
                ctx.fill();

                ctx.strokeStyle = isHlt ? T.textSel : (isSel ? color : (isHov ? T.nodeBorderHov : T.nodeBorder));
                ctx.lineWidth = isSel || isHlt ? 2 : 1;
                ctx.stroke();

                ctx.beginPath();
                ctx.rect(rx + 10, n.y - 4, 8, 8);
                ctx.fillStyle = color;
                ctx.fill();

                if (n.type === 'folder' && isHov) {
                    const portX = rx + w - 6;
                    const portY = n.y;
                    const portR = 5;
                    ctx.beginPath();
                    ctx.arc(portX, portY, portR, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = T.textSel;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.strokeStyle = T.textSel;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(portX - 2.5, portY); ctx.lineTo(portX + 2.5, portY);
                    ctx.moveTo(portX, portY - 2.5); ctx.lineTo(portX, portY + 2.5);
                    ctx.stroke();
                }

                const maxLen = 16;
                const label = n.name.length > maxLen ? n.name.slice(0, maxLen - 1) + '…' : n.name;
                ctx.font = '12px "Inter Tight", sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = isSel ? T.textSel : T.text;
                ctx.fillText(label, rx + 28, n.y);

                if (n.type === 'folder' && n.collapsed) {
                    ctx.fillStyle = T.textSel;
                    ctx.font = 'bold 12px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText('+', rx + w - 22, n.y);
                }

                if (window.AetherApp && window.AetherApp._favorites.has(n.id)) {
                    this._drawFavoriteStar(ctx, rx + w - 11, n.y);
                }
                if (inUploadPicker && n.type === 'folder') {
                    const pulse = Math.sin(this._animFrame * 0.05) * 0.3 + 0.7;
                    ctx.strokeStyle = `rgba(100, 180, 255, ${pulse})`;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }

                if (n._tag) {
                    const tagColors = { urgent: '#ff4444', review: '#ffaa00', wip: '#44aaff', done: '#44cc44', important: '#cc44ff' };
                    ctx.fillStyle = tagColors[n._tag] || '#888';
                    ctx.fillRect(rx + 2, ry + h - 4, w - 4, 3);
                }
            } else {
                // ─── File: один круг (внутренний), без внешнего кольца ───
                ctx.beginPath();
                ctx.arc(n.x, n.y, fileCircleR, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.fill();

                ctx.strokeStyle = isHlt ? T.textSel : (isSel ? color : (isHov ? T.nodeBorderHov : T.nodeBorder));
                ctx.lineWidth = isSel || isHlt ? 2 : 1;
                ctx.stroke();

                // Label to the right of circle
                const maxLen = 14;
                const label = n.name.length > maxLen ? n.name.slice(0, maxLen - 1) + '…' : n.name;
                ctx.font = '12px "Inter Tight", sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = isSel ? T.textSel : T.text;
                ctx.fillText(label, n.x + fileCircleR + 10, n.y);

                if (window.AetherApp && window.AetherApp._favorites.has(n.id)) {
                    this._drawFavoriteStar(ctx, n.x + fileCircleR + 5, n.y);
                }

                if (n._tag) {
                    const tagColors = { urgent: '#ff4444', review: '#ffaa00', wip: '#44aaff', done: '#44cc44', important: '#cc44ff' };
                    ctx.fillStyle = tagColors[n._tag] || '#888';
                    ctx.beginPath();
                    ctx.arc(n.x + fileCircleR * 0.85, n.y + fileCircleR * 0.85, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            ctx.restore();

            // Restore timeline/upload picker alpha
            if (n._timelineHidden) ctx.restore();
            if (inUploadPicker && n.type !== 'folder') ctx.restore();
        }
    },

    _drawHeatmapAuras(ctx, nodes) {
        const maxSize = Math.max(...nodes.map(n => n.subtreeSizeBytes || 0), 1);
        for (const n of nodes.filter(n => n.type === 'folder')) {
            if (n.x == null) continue;
            const ratio = (n.subtreeSizeBytes || 0) / maxSize;
            if (ratio < 0.01) continue;

            // Solid overlay instead of gradient
            const auraR = n._radius * (1.5 + ratio * 4);
            ctx.beginPath();
            ctx.arc(n.x, n.y, auraR, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + ratio * 0.1})`;
            ctx.fill();
        }
    },

    _renderMinimap() {
        const mc = this.miniCtx;
        const MW = this.miniCanvas.width, MH = this.miniCanvas.height;
        const nodes = this.nodes;
        if (!nodes.length) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
            if (n.x == null) continue;
            minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
        }
        if (!isFinite(minX)) return;

        const pad = 10;
        const gW = (maxX - minX) || 1, gH = (maxY - minY) || 1;
        const s = Math.min((MW - pad * 2) / gW, (MH - pad * 2) / gH);

        mc.fillStyle = '#0a0a0a';
        mc.fillRect(0, 0, MW, MH);

        for (const n of nodes) {
            if (n.x == null) continue;
            const sz = Math.max(2, n._radius * s * 0.7);
            const px = (n.x - minX) * s + pad;
            const py = (n.y - minY) * s + pad;
            mc.fillStyle = NodeTypes.hexToRgba(NodeTypes.color(n.type), 0.7);
            if (this._isFolderShape(n)) {
                mc.fillRect(px - sz / 2, py - sz * 0.25, sz, sz * 0.5);
            } else {
                mc.beginPath();
                mc.arc(px, py, Math.max(2, sz * 0.5), 0, Math.PI * 2);
                mc.fill();
            }
        }

        const cam = this._cam;
        const W = this.canvas.width, H = this.canvas.height;
        const vW = W / cam.scale, vH = H / cam.scale;
        const vcx = -cam.x / cam.scale, vcy = -cam.y / cam.scale;
        mc.strokeStyle = 'rgba(255,255,255,0.4)';
        mc.lineWidth = 1;
        mc.strokeRect(
            (vcx - gW / 2 - minX) * s + pad,
            (vcy - gH / 2 - minY) * s + pad,
            vW * s, vH * s
        );
    },

    zoom(factor, cx, cy) {
        if (cx == null) cx = this.canvas.width / 2;
        if (cy == null) cy = this.canvas.height / 2;
        const newScale = Utils.clamp(this._targetCam.scale * factor, 0.04, 6);
        this._targetCam.scale = newScale;
        this._dirty = true;
    },

    fitView() {
        if (!this.nodes.length) return;
        if (this.canvas.width === 0) this._resize();

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of this.nodes) {
            if (n.x == null) continue;
            minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
        }
        if (!isFinite(minX)) return;

        const gW = (maxX - minX) || 100, gH = (maxY - minY) || 100;
        const cx = minX + gW / 2, cy = minY + gH / 2;
        const pad = 120;
        const sc = Utils.clamp(
            Math.min((this.canvas.width - pad) / gW, (this.canvas.height - pad) / gH),
            0.06, 2.5
        );
        this._targetCam.x = -cx * sc;
        this._targetCam.y = -cy * sc;
        this._targetCam.scale = sc;
        this._dirty = true;
    },

    panTo(nodeId, scale) {
        const n = this._nodeMap.get(nodeId);
        if (!n || n.x == null) return;
        const s = scale || Math.max(this._targetCam.scale, 1.2);
        this._targetCam.x = -n.x * s;
        this._targetCam.y = -n.y * s;
        this._targetCam.scale = s;
        this._dirty = true;
    },

    screenToWorld(sx, sy) {
        const W = this.canvas.width, H = this.canvas.height;
        return {
            x: (sx - W / 2 - this._cam.x) / this._cam.scale,
            y: (sy - H / 2 - this._cam.y) / this._cam.scale,
        };
    },

    hitTest(wx, wy, excludeId = null) {
        const fileCircleR = this.FILE_CIRCLE_RADIUS;
        const visibleIds = new Set(this._getVisibleNodes(this.nodes).map(n => n.id));

        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            if (n.x == null || !visibleIds.has(n.id)) continue;
            if (excludeId && n.id === excludeId) continue;
            if (this._isFolderShape(n)) {
                const w2 = 70, h2 = 18;
                if (wx >= n.x - w2 && wx <= n.x + w2 && wy >= n.y - h2 && wy <= n.y + h2) return n;
            } else {
                if (Utils.dist(wx, wy, n.x, n.y) <= fileCircleR) return n;
            }
        }
        return null;
    },

    hitTestPort(wx, wy) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            if (n.x == null || n.type !== 'folder') continue; // Only folders have ports
            // Right port connector location
            const px = n.x + 64; // rx + w - 6 => (n.x - 70) + 134 = n.x + 64
            if (Utils.dist(wx, wy, px, n.y) <= 10) return n;
        }
        return null;
    },

    _bindEvents() {
        const c = this.canvas;

        // Track Ctrl key state (for multi-select)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Control') this._ctrlDown = true;
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Control') this._ctrlDown = false;
        });

        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom(e.deltaY < 0 ? 1.12 : 0.89, e.offsetX, e.offsetY);
        }, { passive: false });

        c.addEventListener('mousedown', (e) => {
            if (e.button === 0 || e.button === 1) {
                const w = this.screenToWorld(e.offsetX, e.offsetY);

                const hitPort = this.hitTestPort(w.x, w.y);
                if (hitPort && e.button === 0) {
                    this._drawingConnectionSrc = hitPort;
                    this._drawingConnectionTo = { x: w.x, y: w.y };
                    this._drag = null;
                    return;
                }

                const hit = this.hitTest(w.x, w.y);
                this._drag = {
                    startX: e.clientX, startY: e.clientY,
                    camX: this._targetCam.x, camY: this._targetCam.y,
                    clickedNode: hit, moved: false,
                    worldStartX: w.x, worldStartY: w.y,
                    ctrlWasHeld: this._ctrlDown
                };

                // Start rectangle selection if Ctrl+drag on empty space
                if (!hit && this._ctrlDown && e.button === 0) {
                    this._selectionRect = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
                }

                if (hit && e.button === 0) {
                    this._draggingNode = hit;
                    const inSelection = hit.id === this._selectedId || this._selectedIds.has(hit.id);
                    const idsToMove = inSelection && (this._selectedId || this._selectedIds.size > 0)
                        ? [this._selectedId, ...this._selectedIds].filter(Boolean)
                        : [hit.id];
                    this._draggingNodes = idsToMove.map(id => this._nodeMap.get(id)).filter(Boolean);
                    this._draggingStartPositions = new Map();
                    for (const node of this._draggingNodes) {
                        node.fx = node.x;
                        node.fy = node.y;
                        this._draggingStartPositions.set(node.id, { x: node.x, y: node.y });
                    }
                    if (ForceLayout) ForceLayout.alpha = 0.3;
                }
            }
        });

        c.addEventListener('mousemove', (e) => {
            const w = this.screenToWorld(e.offsetX, e.offsetY);
            if (this._drawingConnectionSrc) {
                this._drawingConnectionTo = { x: w.x, y: w.y };
                this._dirty = true;
                return;
            }

            // Rectangle selection drag
            if (this._selectionRect) {
                this._selectionRect.x2 = w.x;
                this._selectionRect.y2 = w.y;
                this._dirty = true;
                // Don't return — fall through to update hover
            }

            if (this._draggingNode && this._draggingStartPositions) {
                const dx = e.clientX - this._drag.startX;
                const dy = e.clientY - this._drag.startY;
                if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                    this._drag.moved = true;
                    const deltaWorldX = w.x - this._drag.worldStartX;
                    const deltaWorldY = w.y - this._drag.worldStartY;
                    for (const node of this._draggingNodes) {
                        const start = this._draggingStartPositions.get(node.id);
                        if (start) {
                            node.fx = start.x + deltaWorldX;
                            node.fy = start.y + deltaWorldY;
                            if (ForceLayout && ForceLayout.mode === 'strict') {
                                node.x = node.fx;
                                node.y = node.fy;
                            }
                        }
                    }
                    if (ForceLayout) ForceLayout.alpha = 0.3;
                    this._dirty = true;
                }
            } else if (this._drag) {
                const dx = e.clientX - this._drag.startX;
                const dy = e.clientY - this._drag.startY;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                    this._drag.moved = true;
                    // Block panning during Ctrl (selection mode)
                    if (!this._ctrlDown && (!this._drag.clickedNode || e.button === 1)) {
                        this._targetCam.x = this._drag.camX + dx;
                        this._targetCam.y = this._drag.camY + dy;
                        this._dirty = true;
                    }
                }
            }
            const hit = this.hitTest(w.x, w.y);
            const prev = this._hoveredId;
            this._hoveredId = hit ? hit.id : null;
            if (prev !== this._hoveredId) {
                this._dirty = true;
                c.style.cursor = hit ? 'pointer' : (this._drag && !this._draggingNode ? 'grabbing' : 'grab');
            }
        });

        c.addEventListener('mouseup', (e) => {
            const w = this.screenToWorld(e.offsetX, e.offsetY);
            if (this._drawingConnectionSrc) {
                const hit = this.hitTest(w.x, w.y);

                // If dropped on empty space, create node hook
                if (!hit && e.button === 0) {
                    if (this.appHooks.onConnectionDrop) {
                        this.appHooks.onConnectionDrop(this._drawingConnectionSrc, e.clientX, e.clientY, w.x, w.y);
                    }
                }

                // If dropped onto a DIFFERENT FOLDER node, move files hook!
                if (hit && hit.type === 'folder' && hit.id !== this._drawingConnectionSrc.id) {
                    if (this.appHooks.onNodeMoveAttempt) {
                        this.appHooks.onNodeMoveAttempt(this._drawingConnectionSrc, hit);
                    }
                }

                this._drawingConnectionSrc = null;
                this._drawingConnectionTo = null;
                this._dirty = true;
                return;
            }

            if (this._draggingNode) {
                // If dropping a node strictly on top of a folder node, trigger a move
                const dropHit = this.hitTest(w.x, w.y, this._draggingNode.id);
                if (dropHit && dropHit.id !== this._draggingNode.id && dropHit.type === 'folder') {
                    // Multi-selection: if dragged node is in selection, move all selected
                    const nodesToMove = [];
                    if (this._selectedIds.size > 0 && this._selectedIds.has(this._draggingNode.id)) {
                        for (const id of this._selectedIds) {
                            const n = this.nodes.find(nd => nd.id === id);
                            if (n && n.id !== dropHit.id) nodesToMove.push(n);
                        }
                    } else {
                        nodesToMove.push(this._draggingNode);
                    }
                    if (window.AetherApp) {
                        window.AetherApp.showMoveCopyMenu(nodesToMove.length === 1 ? nodesToMove[0] : nodesToMove, dropHit, e.clientX, e.clientY);
                    } else if (this.appHooks && this.appHooks.onNodeMoveAttempt) {
                        for (const n of nodesToMove) this.appHooks.onNodeMoveAttempt(n, dropHit);
                    }
                }

                // Закрепляем позиции всех перетаскиваемых нод
                for (const node of this._draggingNodes) {
                    node.x = node.fx ?? node.x;
                    node.y = node.fy ?? node.y;
                    node.fx = null;
                    node.fy = null;
                }

                this._draggingNode = null;
                this._draggingNodes = [];
                this._draggingStartPositions = null;
                if (ForceLayout) ForceLayout.alpha = 0.1;
                this._dirty = true;
            }

            // Rectangle selection complete
            if (this._selectionRect) {
                const r = this._selectionRect;
                const minX = Math.min(r.x1, r.x2), maxX = Math.max(r.x1, r.x2);
                const minY = Math.min(r.y1, r.y2), maxY = Math.max(r.y1, r.y2);
                const fileCircleR = this.FILE_CIRCLE_RADIUS;
                if (!this._ctrlDown) this._selectedIds.clear();
                for (const n of this.nodes) {
                    if (n.x == null) continue;
                    const mx = this._isFolderShape(n) ? 70 : fileCircleR;
                    const my = this._isFolderShape(n) ? 18 : fileCircleR;
                    if (n.x >= minX - mx && n.x <= maxX + mx && n.y >= minY - my && n.y <= maxY + my) {
                        this._selectedIds.add(n.id);
                    }
                }
                this._selectionRect = null;
                this._dirty = true;
                this._drag = null;
                c.style.cursor = 'grab';
                return;
            }

            if (this._drag && !this._drag.moved && this._drag.clickedNode && e.button === 0) {
                const nodeId = this._drag.clickedNode.id;
                if (this._ctrlDown) {
                    // Ctrl+click: toggle in multi-selection
                    if (this._selectedIds.has(nodeId)) {
                        this._selectedIds.delete(nodeId);
                    } else {
                        this._selectedIds.add(nodeId);
                    }
                    this._dirty = true;
                } else {
                    // Normal click: clear multi-selection, select single
                    this._selectedIds.clear();
                    this.selectNode(nodeId);
                    // Path highlight: trace ancestors to root
                    this._highlightPath(nodeId);
                }
            } else if (this._drag && !this._drag.moved && !this._drag.clickedNode && e.button === 0 && !this._ctrlDown) {
                // Click on empty space: clear selection and path highlight
                this._selectedIds.clear();
                this._selectedId = null;
                this._pathHighlightIds.clear();
                this._dirty = true;
            }
            this._drag = null;
            c.style.cursor = 'grab';
        });

        c.addEventListener('mouseleave', () => { this._drag = null; });

        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const w = this.screenToWorld(e.offsetX, e.offsetY);
            const hit = this.hitTest(w.x, w.y);
            if (hit) {
                this.selectNode(hit.id);
                if (this.appHooks.onContextMenu) this.appHooks.onContextMenu(e.clientX, e.clientY, hit.id);
            }
        });

        window.addEventListener('resize', Utils.debounce(() => { this._resize(); }, 150));
    },

    selectNode(id) {
        this._selectedId = id;
        this._dirty = true;
        if (this.appHooks.onNodeSelect) this.appHooks.onNodeSelect(id);
    },

    deselect() {
        this._selectedId = null;
        this._highlightId = null;
        this._dirty = true;
    },

    highlightNode(id) { this._highlightId = id; this._dirty = true; },

    setDimMode(active, focusType) {
        this._dimMode = active;
        this._focusType = focusType || null;
        this._dirty = true;
    },

    _highlightPath(nodeId) {
        this._pathHighlightIds.clear();
        if (!nodeId) return;
        // Build parent map (target -> source) and children map (source -> [targets])
        const parentMap = new Map();
        const childMap = new Map();
        for (const e of this.edges) {
            parentMap.set(e.target, e.source);
            if (!childMap.has(e.source)) childMap.set(e.source, []);
            childMap.get(e.source).push(e.target);
        }
        // Trace ancestors: node → parent → ... → root
        let current = nodeId;
        while (current) {
            this._pathHighlightIds.add(current);
            current = parentMap.get(current) || null;
        }
        // Trace descendants: BFS from nodeId
        const stack = [nodeId];
        while (stack.length > 0) {
            const id = stack.pop();
            this._pathHighlightIds.add(id);
            const children = childMap.get(id) || [];
            for (const childId of children) {
                if (!this._pathHighlightIds.has(childId)) stack.push(childId);
            }
        }
        this._dirty = true;
    },

    showInlineInput(worldX, worldY, placeholder, callback) {
        // Remove existing input if any
        this.hideInlineInput();
        const s = this.worldToScreen(worldX, worldY);
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder || 'Имя...';
        input.className = 'inline-node-input';
        input.style.cssText = `
            position:fixed; left:${s.x - 80}px; top:${s.y - 16}px;
            width:180px; padding:8px 12px; font-size:13px;
            background:rgba(20,25,40,0.95); color:#e0e8ff;
            border:2px solid rgba(100,180,255,0.5); border-radius:8px;
            outline:none; z-index:10000; backdrop-filter:blur(8px);
            box-shadow:0 4px 20px rgba(0,0,0,0.5);
            font-family:'Inter Tight',sans-serif;
            animation: inlineInputAppear 0.2s ease-out;
        `;
        document.body.appendChild(input);
        this._inlineInput = input;
        requestAnimationFrame(() => input.focus());

        const submit = () => {
            const val = input.value.trim();
            this.hideInlineInput();
            if (val && callback) callback(val);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') this.hideInlineInput();
        });
        input.addEventListener('blur', () => {
            setTimeout(() => this.hideInlineInput(), 100);
        });
    },

    hideInlineInput() {
        if (this._inlineInput && this._inlineInput.parentNode) {
            this._inlineInput.parentNode.removeChild(this._inlineInput);
        }
        this._inlineInput = null;
    },

    worldToScreen(wx, wy) {
        const cam = this._cam;
        return {
            x: (wx * cam.scale) + cam.x + this.canvas.width / 2,
            y: (wy * cam.scale) + cam.y + this.canvas.height / 2,
        };
    },

    _updateZoomLabel() {
        const el = Utils.el('zoom-level');
        if (el) el.textContent = `${Math.round(this._cam.scale * 100)}%`;
    }
};
