/**
 * AetherFS – Canvas Renderer
 * High-performance 2D Canvas renderer with pan/zoom, glow effects,
 * animated edges, heatmap auras, and node interaction.
 */

'use strict';

const Renderer = {
    canvas: null,
    ctx: null,
    miniCanvas: null,
    miniCtx: null,

    // Camera state (plain properties)
    _cam: { x: 0, y: 0, scale: 1 },
    _targetCam: { x: 0, y: 0, scale: 1 },

    // Input state
    _drag: null,
    _hoveredId: null,
    _selectedId: null,

    // Graph data
    nodes: [],
    edges: [],
    _nodeMap: new Map(),
    _edgesBySource: new Map(),

    // State flags
    heatmapMode: false,
    _pulses: [],
    _highlightId: null,
    _dimMode: false,
    _focusType: null,

    // Render loop
    _raf: null,
    _dirty: true,

    // ── Init ───────────────────────────────────────────────
    init(canvasId, miniCanvasId) {
        this.canvas = Utils.el(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.miniCanvas = Utils.el(miniCanvasId);
        this.miniCtx = this.miniCanvas.getContext('2d');
        // Don't resize yet — graphScreen may be hidden (display:none → clientWidth=0)
        this._bindEvents();
        this._loop();
    },

    // Call this when the graph screen becomes visible
    resize() {
        this._resize();
    },

    _resize() {
        const container = this.canvas.parentElement;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || (window.innerHeight - 52); // minus toolbar
        this.canvas.width = w;
        this.canvas.height = h;
        this._dirty = true;
    },

    // ── Load graph data ────────────────────────────────────
    loadGraph(nodes, edges) {
        this.nodes = nodes;
        this.edges = edges;
        this._nodeMap = new Map(nodes.map(n => [n.id, n]));
        this._edgesBySource = new Map();
        for (const e of edges) {
            if (!this._edgesBySource.has(e.source)) this._edgesBySource.set(e.source, []);
            this._edgesBySource.get(e.source).push(e.target);
        }
        this._dirty = true;
    },

    // ── Main rAF loop ──────────────────────────────────────
    _loop() {
        // If canvas has no size yet (graph hidden), resize now
        if (this.canvas.width === 0 || this.canvas.height === 0) {
            this._resize();
        }

        const lerp = 0.12;
        this._cam.x += (this._targetCam.x - this._cam.x) * lerp;
        this._cam.y += (this._targetCam.y - this._cam.y) * lerp;
        this._cam.scale += (this._targetCam.scale - this._cam.scale) * lerp;

        const camMoved = Math.abs(this._targetCam.x - this._cam.x) > 0.1 ||
            Math.abs(this._targetCam.y - this._cam.y) > 0.1 ||
            Math.abs(this._targetCam.scale - this._cam.scale) > 0.001;

        if (this._dirty || camMoved || this._pulses.length > 0 || ForceLayout.running) {
            this._render();
            this._renderMinimap();
            this._dirty = false;
        }

        this._updateZoomLabel();
        this._raf = requestAnimationFrame(() => this._loop());
    },

    markDirty() { this._dirty = true; },

    // ── Main Render ────────────────────────────────────────
    _render() {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        if (W === 0 || H === 0) return;

        const cam = this._cam;
        const nodes = this.nodes;
        const edges = this.edges;

        ctx.fillStyle = '#050810';
        ctx.fillRect(0, 0, W, H);

        this._drawGrid(ctx, W, H, cam);

        ctx.save();
        ctx.translate(W / 2 + cam.x, H / 2 + cam.y);
        ctx.scale(cam.scale, cam.scale);

        if (this.heatmapMode) this._drawHeatmapAuras(ctx, nodes);
        this._drawEdges(ctx, edges, nodes);
        this._drawActiveConnection(ctx);
        this._drawPulses(ctx);
        this._drawNodes(ctx, nodes, cam);

        ctx.restore();
    },

    // ── Cyber-grid background ──────────────────────────────
    _gridOffset: 0,
    _drawGrid(ctx, W, H, cam) {
        this._gridOffset = (this._gridOffset + 0.08) % 60;
        const spacing = 60;
        const ox = ((cam.x % spacing) + spacing) % spacing - this._gridOffset;
        const oy = ((cam.y % spacing) + spacing) % spacing - this._gridOffset;

        ctx.strokeStyle = 'rgba(0,200,255,0.045)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = ox; x < W; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let y = oy; y < H; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
    },

    // ── Draw Edges ─────────────────────────────────────────
    _drawEdges(ctx, edges, nodes) {
        const nodeMap = this._nodeMap;

        for (const e of edges) {
            const src = nodeMap.get(e.source);
            const tgt = nodeMap.get(e.target);
            if (!src || !tgt || src.x == null || tgt.x == null) continue;

            const isHov = src.id === this._hoveredId || tgt.id === this._hoveredId;
            const isSel = src.id === this._selectedId || tgt.id === this._selectedId;
            const isDim = this._dimMode && this._focusType &&
                src.type !== this._focusType && tgt.type !== this._focusType;

            const alpha = isDim ? 0.04 : isSel ? 0.8 : isHov ? 0.5 : 0.18;
            const color = isSel || isHov ? '#00f5ff' : 'rgba(0,200,255,1)';

            ctx.strokeStyle = this._alphaColor(color, alpha);
            ctx.lineWidth = isSel ? 1.5 : 1;

            const mx = (src.x + tgt.x) / 2;
            const my = (src.y + tgt.y) / 2 - 20;

            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y);
            ctx.stroke();

            if (isSel || isHov) this._drawArrow(ctx, mx, my, tgt.x, tgt.y, 6, color, alpha);
        }
    },

    _drawActiveConnection(ctx) {
        if (!this._drawingConnectionSrc || !this._drawingConnectionTo) return;
        const src = this._drawingConnectionSrc;
        const tgt = this._drawingConnectionTo;

        ctx.strokeStyle = '#39ff14'; // Connection drag color
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        const startX = src.x - 56; // Port dot X
        ctx.moveTo(startX, src.y);
        ctx.quadraticCurveTo(startX - 50, src.y, tgt.x, tgt.y);
        ctx.stroke();

        ctx.setLineDash([]);

        // Draw little node ghost at cursor
        ctx.beginPath();
        ctx.arc(tgt.x, tgt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#39ff14';
        ctx.fill();
    },

    _drawArrow(ctx, fromX, fromY, toX, toY, size, color, alpha) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const curR = 20; // Default arrow distance
        ctx.save();
        ctx.translate(toX - Math.cos(angle) * curR, toY - Math.sin(angle) * curR);
        ctx.rotate(angle);
        ctx.fillStyle = this._alphaColor(color, alpha);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size / 2);
        ctx.lineTo(-size, size / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    },

    _drawRoundRect(ctx, x, y, width, height, radius) {
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

    // ── Draw Nodes ────────────────────────────────────────
    _drawNodes(ctx, nodes, cam) {
        const now = performance.now();

        for (const n of nodes) {
            if (n.x == null) continue;

            const color = NodeTypes.color(n.type);
            const isSel = n.id === this._selectedId;
            const isHov = n.id === this._hoveredId;
            const isHlt = n.id === this._highlightId;
            const isDim = this._dimMode && this._focusType &&
                n.type !== this._focusType && n.id !== this._selectedId;

            ctx.save();
            ctx.globalAlpha = isDim ? 0.3 : 1;

            const w = 140;
            const h = 36;
            const rx = n.x - w / 2;
            const ry = n.y - h / 2;

            if (isSel || isHov || isHlt) {
                ctx.shadowColor = 'rgba(0,0,0,0.6)';
                ctx.shadowBlur = isSel ? 16 : 10;
                ctx.shadowOffsetY = 4;
            }

            // Node body (dark minimal)
            ctx.fillStyle = '#1a1a1a';
            if (isSel) ctx.fillStyle = '#262626';
            this._drawRoundRect(ctx, rx, ry, w, h, 2);
            ctx.fill();

            ctx.shadowColor = 'transparent';

            // Border
            ctx.strokeStyle = isHlt ? '#fff' : (isSel ? color : (isHov ? '#555' : '#333'));
            ctx.lineWidth = isSel || isHlt ? 2 : 1;
            ctx.stroke();

            // Port dot
            ctx.beginPath();
            ctx.arc(rx + 14, n.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            // Label
            const maxLen = 16;
            const label = n.name.length > maxLen ? n.name.slice(0, maxLen - 1) + '…' : n.name;
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isSel ? '#fff' : '#d1d5db';
            ctx.fillText(label, rx + 28, n.y);

            ctx.restore();
        }
    },

    // ── Heatmap Auras ─────────────────────────────────────
    _drawHeatmapAuras(ctx, nodes) {
        const maxSize = Math.max(...nodes.map(n => n.subtreeSizeBytes || 0), 1);
        for (const n of nodes.filter(n => n.type === 'folder')) {
            if (n.x == null) continue;
            const ratio = (n.subtreeSizeBytes || 0) / maxSize;
            if (ratio < 0.01) continue;
            const auraR = n._radius * (2 + ratio * 6);
            const color = NodeTypes.heatColor(ratio);
            const gr = ctx.createRadialGradient(n.x, n.y, n._radius, n.x, n.y, auraR);
            gr.addColorStop(0, color);
            gr.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath();
            ctx.arc(n.x, n.y, auraR, 0, Math.PI * 2);
            ctx.fillStyle = gr;
            ctx.fill();
        }
    },

    // ── Sync Pulses ────────────────────────────────────────
    addPulse(sourceId, targetId) {
        this._pulses.push({ src: sourceId, tgt: targetId, t: 0, color: '#00f5ff' });
    },

    _drawPulses(ctx) {
        const toRemove = [];
        for (let i = 0; i < this._pulses.length; i++) {
            const p = this._pulses[i];
            p.t += 0.018;
            if (p.t >= 1) { toRemove.push(i); continue; }
            const src = this._nodeMap.get(p.src);
            const tgt = this._nodeMap.get(p.tgt);
            if (!src || !tgt) { toRemove.push(i); continue; }
            const t = Utils.easeInOutCubic(p.t);
            const x = src.x + (tgt.x - src.x) * t;
            const y = src.y + (tgt.y - src.y) * t;
            const a = t < 0.9 ? 1 : 1 - (t - 0.9) / 0.1;
            ctx.save();
            ctx.globalAlpha = a;
            const gr = ctx.createRadialGradient(x, y, 0, x, y, 5);
            gr.addColorStop(0, '#ffffff');
            gr.addColorStop(0.5, p.color);
            gr.addColorStop(1, 'transparent');
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        for (let i = toRemove.length - 1; i >= 0; i--) this._pulses.splice(toRemove[i], 1);
    },

    // ── Minimap ─────────────────────────────────────────────
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

        mc.fillStyle = 'rgba(5,8,16,0.9)';
        mc.fillRect(0, 0, MW, MH);

        for (const n of nodes) {
            if (n.x == null) continue;
            mc.beginPath();
            mc.arc((n.x - minX) * s + pad, (n.y - minY) * s + pad, Math.max(1.5, n._radius * s * 0.7), 0, Math.PI * 2);
            mc.fillStyle = NodeTypes.hexToRgba(NodeTypes.color(n.type), 0.7);
            mc.fill();
        }

        const cam = this._cam;
        const W = this.canvas.width, H = this.canvas.height;
        const vW = W / cam.scale, vH = H / cam.scale;
        const vcx = -cam.x / cam.scale, vcy = -cam.y / cam.scale;
        mc.strokeStyle = 'rgba(0,245,255,0.5)';
        mc.lineWidth = 1;
        mc.strokeRect(
            (vcx - gW / 2 - minX) * s + pad,
            (vcy - gH / 2 - minY) * s + pad,
            vW * s, vH * s
        );
    },

    // ── Camera controls ────────────────────────────────────
    zoom(factor, cx, cy) {
        if (cx == null) cx = this.canvas.width / 2;
        if (cy == null) cy = this.canvas.height / 2;
        const newScale = Utils.clamp(this._targetCam.scale * factor, 0.04, 6);
        this._targetCam.scale = newScale;
        this._dirty = true;
    },

    fitView() {
        if (!this.nodes.length) return;
        // Ensure canvas has proper size
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

    // ── Input helpers ──────────────────────────────────────
    screenToWorld(sx, sy) {
        const W = this.canvas.width, H = this.canvas.height;
        return {
            x: (sx - W / 2 - this._cam.x) / this._cam.scale,
            y: (sy - H / 2 - this._cam.y) / this._cam.scale,
        };
    },

    hitTest(wx, wy) {
        const w2 = 140 / 2;
        const h2 = 36 / 2;
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            if (n.x == null) continue;
            if (wx >= n.x - w2 && wx <= n.x + w2 && wy >= n.y - h2 && wy <= n.y + h2) return n;
        }
        return null;
    },

    hitTestPort(wx, wy) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            if (n.x == null) continue;
            const px = n.x - 56;
            if (Utils.dist(wx, wy, px, n.y) <= 8) return n;
        }
        return null;
    },

    // ── Event binding ──────────────────────────────────────
    _bindEvents() {
        const c = this.canvas;

        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom(e.deltaY < 0 ? 1.12 : 0.89, e.offsetX, e.offsetY);
        }, { passive: false });

        c.addEventListener('mousedown', (e) => {
            if (e.button === 0 || e.button === 1) {
                const w = this.screenToWorld(e.offsetX, e.offsetY);

                const hitPort = this.hitTestPort(w.x, w.y);
                if (hitPort && e.button === 0 && hitPort.type === 'folder') {
                    this._drawingConnectionSrc = hitPort;
                    this._drawingConnectionTo = { x: w.x, y: w.y };
                    this._drag = null;
                    return;
                }

                const hit = this.hitTest(w.x, w.y);
                this._drag = {
                    startX: e.clientX, startY: e.clientY,
                    camX: this._targetCam.x, camY: this._targetCam.y,
                    clickedNode: hit, moved: false
                };

                if (hit && e.button === 0) {
                    hit.fx = hit.x;
                    hit.fy = hit.y;
                    this._draggingNode = hit;
                    if (window.ForceLayout) window.ForceLayout.alpha = 0.3;
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

            if (this._draggingNode) {
                this._drag.moved = true;
                this._draggingNode.fx = w.x;
                this._draggingNode.fy = w.y;
                if (window.ForceLayout) window.ForceLayout.alpha = 0.3;
                this._dirty = true;
            } else if (this._drag) {
                const dx = e.clientX - this._drag.startX;
                const dy = e.clientY - this._drag.startY;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                    this._drag.moved = true;
                    if (!this._drag.clickedNode || e.button === 1) {
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
            if (this._drawingConnectionSrc) {
                const w = this.screenToWorld(e.offsetX, e.offsetY);
                const hit = this.hitTest(w.x, w.y);
                if (!hit && e.button === 0) {
                    if (window.AetherApp && window.AetherApp.onConnectionDrop) {
                        window.AetherApp.onConnectionDrop(this._drawingConnectionSrc, e.clientX, e.clientY, w.x, w.y);
                    }
                }
                this._drawingConnectionSrc = null;
                this._drawingConnectionTo = null;
                this._dirty = true;
                return;
            }

            if (this._draggingNode) {
                // Keep the node permanently pinned by NOT resetting fx and fy!
                this._draggingNode = null;
                if (window.ForceLayout) window.ForceLayout.alpha = 0.1;
                this._dirty = true;
            }
            if (this._drag && !this._drag.moved && this._drag.clickedNode && e.button === 0) {
                this.selectNode(this._drag.clickedNode.id);
            }
            this._drag = null;
            c.style.cursor = 'grab';
        });

        c.addEventListener('mouseleave', () => { this._drag = null; });

        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const w = this.screenToWorld(e.offsetX, e.offsetY);
            const hit = this.hitTest(w.x, w.y);
            if (hit) { this.selectNode(hit.id); AetherApp.showContextMenu(e.clientX, e.clientY, hit.id); }
        });

        let lastTouches = [];
        c.addEventListener('touchstart', (e) => { e.preventDefault(); lastTouches = [...e.touches]; }, { passive: false });
        c.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const t = [...e.touches];
            if (t.length === 1 && lastTouches.length === 1) {
                this._targetCam.x += t[0].clientX - lastTouches[0].clientX;
                this._targetCam.y += t[0].clientY - lastTouches[0].clientY;
                this._dirty = true;
            } else if (t.length === 2 && lastTouches.length === 2) {
                const d0 = Utils.dist(lastTouches[0].clientX, lastTouches[0].clientY, lastTouches[1].clientX, lastTouches[1].clientY);
                const d1 = Utils.dist(t[0].clientX, t[0].clientY, t[1].clientX, t[1].clientY);
                if (d0 > 0) this.zoom(d1 / d0);
            }
            lastTouches = t;
        }, { passive: false });

        window.addEventListener('resize', Utils.debounce(() => { this._resize(); }, 150));
    },

    // ── Node selection ──────────────────────────────────────
    selectNode(id) {
        this._selectedId = id;
        this._dirty = true;
        AetherApp.onNodeSelect(id);
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

    // ── Zoom label ───────────────────────────────────────────
    _updateZoomLabel() {
        const el = Utils.el('zoom-level');
        if (el) el.textContent = `${Math.round(this._cam.scale * 100)}%`;
    },

    // ── Helper ──────────────────────────────────────────────
    _alphaColor(color, alpha) {
        if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${alpha})`);
        if (color.startsWith('#')) return NodeTypes.hexToRgba(color, alpha);
        return color;
    },
};
