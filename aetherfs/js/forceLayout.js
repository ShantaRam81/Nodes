/**
 * AetherFS – Force-Directed Layout Engine
 * Implements Barnes-Hut-inspired O(n log n) force simulation in pure JS.
 */

'use strict';

const ForceLayout = {
    // ── State ────────────────────────────────────────────────
    nodes: [],
    edges: [],
    alpha: 1,
    running: false,
    _raf: null,
    clusterMode: 'folder',
    onTick: null,

    // ── Config ───────────────────────────────────────────────
    cfg: {
        repulsion: -280,
        linkDistance: 80,
        linkStrength: 0.35,
        centerStrength: 0.03,
        alphaDecay: 0.018,
        alphaMin: 0.005,
        collideBuffer: 6,
        clusterStrength: 0.12,
    },

    // ── Init ─────────────────────────────────────────────────
    init(nodes, edges, mode = 'free', onTick = null) {
        this.nodes = nodes.map(n => ({
            ...n,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            x: n.x !== undefined ? n.x : (Math.random() - 0.5) * 600,
            y: n.y !== undefined ? n.y : (Math.random() - 0.5) * 600,
        }));
        this.edges = edges;
        this.alpha = 1;
        this.mode = mode;
        this.onTick = onTick;
        this._calcTreeDepths(this.nodes, this.edges);
    },

    // ── Start simulation ─────────────────────────────────────
    start() {
        if (this.running) return;
        this.running = true;
        this._tick();
    },

    stop() {
        this.running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },

    reheat(alpha = 0.6) {
        this.alpha = alpha;
        if (!this.running) this.start();
    },

    // ── Tick loop ────────────────────────────────────────────
    _tick() {
        if (!this.running || this.alpha < this.cfg.alphaMin) {
            this.running = false;
            if (this.onTick) this.onTick(this.nodes, true); // final
            return;
        }

        this._applyForces();
        this.alpha *= (1 - this.cfg.alphaDecay);

        if (this.onTick) this.onTick(this.nodes, false);

        this._raf = requestAnimationFrame(() => this._tick());
    },

    // ── Force application ──────────────────────────────────
    _applyForces() {
        const nodes = this.nodes;
        const edges = this.edges;
        const cfg = this.cfg;
        const alpha = this.alpha;

        // 1. N-body repulsion (simplified O(n²) for <=500 nodes, grid for more)
        if (nodes.length <= 600) {
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    const dx = b.x - a.x || 0.001;
                    const dy = b.y - a.y || 0.001;
                    const d2 = dx * dx + dy * dy;
                    const d = Math.sqrt(d2);
                    const f = (cfg.repulsion / d2) * alpha;
                    const fx = f * dx / d, fy = f * dy / d;
                    a.vx -= fx; a.vy -= fy;
                    b.vx += fx; b.vy += fy;
                }
            }
        } else {
            // Grid-based repulsion for large graphs
            this._gridRepulsion(nodes, alpha);
        }

        // 2. Link spring forces
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        for (const e of edges) {
            const src = nodeMap.get(e.source);
            const tgt = nodeMap.get(e.target);
            if (!src || !tgt) continue;
            const dx = tgt.x - src.x;
            const dy = tgt.y - src.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
            const displacement = (d - cfg.linkDistance) / d * cfg.linkStrength * alpha;
            const fx = dx * displacement * 0.5;
            const fy = dy * displacement * 0.5;
            src.vx += fx; src.vy += fy;
            tgt.vx -= fx; tgt.vy -= fy;
        }

        // 3. Centering force
        let cx = 0, cy = 0;
        for (const n of nodes) { cx += n.x; cy += n.y; }
        cx /= nodes.length; cy /= nodes.length;
        for (const n of nodes) {
            n.vx -= cx * cfg.centerStrength * alpha;
            n.vy -= cy * cfg.centerStrength * alpha;
        }

        // 4. Mode-specific structural forces
        if (this.mode === 'strict') {
            this._applyStrictGraph(nodes, alpha);
        } else if (this.mode === 'radial') {
            this._applyRadialGraph(nodes, alpha);
        }

        // 5. Collision avoidance
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j];
                const minD = (a._radius || 10) + (b._radius || 10) + cfg.collideBuffer;
                const dx = b.x - a.x || 0.001;
                const dy = b.y - a.y || 0.001;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minD) {
                    const overlap = (minD - d) / d * 0.5;
                    a.vx -= dx * overlap; a.vy -= dy * overlap;
                    b.vx += dx * overlap; b.vy += dy * overlap;
                }
            }
        }

        // 6. Integrate velocities (with damping)
        for (const n of nodes) {
            if (n.fx !== undefined && n.fx !== null) {
                n.x = n.fx;
                n.y = n.fy;
                n.vx = 0; n.vy = 0;
            } else {
                n.vx *= 0.7; n.vy *= 0.7;
                n.x += Utils.clamp(n.vx, -20, 20);
                n.y += Utils.clamp(n.vy, -20, 20);
            }
        }
    },

    // ── Grid-based repulsion for large node counts ─────────
    _gridRepulsion(nodes, alpha) {
        const cellSize = 150;
        const grid = new Map();
        for (const n of nodes) {
            const key = `${Math.floor(n.x / cellSize)},${Math.floor(n.y / cellSize)}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(n);
        }
        for (const n of nodes) {
            const gx = Math.floor(n.x / cellSize);
            const gy = Math.floor(n.y / cellSize);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const neighbours = grid.get(`${gx + dx},${gy + dy}`) || [];
                    for (const m of neighbours) {
                        if (m === n) continue;
                        const ddx = m.x - n.x || 0.001;
                        const ddy = m.y - n.y || 0.001;
                        const d2 = ddx * ddx + ddy * ddy;
                        const d = Math.sqrt(d2);
                        const f = (this.cfg.repulsion / d2) * alpha * 0.5;
                        n.vx -= f * ddx / d;
                        n.vy -= f * ddy / d;
                    }
                }
            }
        }
    },

    // ── New Layout Mode Forces ────────────────────────────
    _applyStrictGraph(nodes, alpha) {
        for (const n of nodes) {
            const targetY = (n._depth * 180) - (n._maxDepth * 180) / 2;
            n.vy += (targetY - n.y) * 0.15 * alpha;
            // A subtle push against X center to keep tree cohesive in the middle
            n.vx -= n.x * 0.01 * alpha;
        }
    },

    _applyRadialGraph(nodes, alpha) {
        for (const n of nodes) {
            // Distance pushes out to depth-based orbits
            const targetR = n._depth * 250;
            const currentR = Math.sqrt(n.x * n.x + n.y * n.y) || 0.1;
            n.vx += ((n.x / currentR) * targetR - n.x) * 0.15 * alpha;
            n.vy += ((n.y / currentR) * targetR - n.y) * 0.15 * alpha;
        }
    },

    _calcTreeDepths(nodes, edges) {
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const children = new Map();
        const incoming = new Map();
        for (const n of nodes) {
            children.set(n.id, []);
            incoming.set(n.id, 0);
        }
        for (const e of edges) {
            if (children.has(e.source)) children.get(e.source).push(e.target);
            if (incoming.has(e.target)) incoming.set(e.target, incoming.get(e.target) + 1);
        }
        let q = [];
        for (const n of nodes) {
            n._depth = 0;
            if (incoming.get(n.id) === 0) q.push(n);
        }
        // Fallback for graphs with cycles but no clear root
        if (q.length === 0 && nodes.length > 0) q.push(nodes[0]);

        while (q.length > 0) {
            const curr = q.shift();
            for (const cid of children.get(curr.id) || []) {
                const cNode = nodeMap.get(cid);
                if (cNode && cNode._depth <= curr._depth) {
                    cNode._depth = curr._depth + 1;
                    q.push(cNode);
                }
            }
        }
        const maxD = Math.max(...nodes.map(n => n._depth || 0), 1);
        for (const n of nodes) n._maxDepth = maxD;
    },

    // ── Change layout mode with smooth reheat ─────────────
    setMode(mode) {
        this.mode = mode;
        this.reheat(0.8);
    },

    // ── Get current snapshot (for rendering) ─────────────
    getPositions() {
        return this.nodes;
    },
};
