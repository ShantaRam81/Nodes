/**
 * AetherFS – Force-Directed Layout Engine
 * Implements Barnes-Hut-inspired O(n log n) force simulation in ES Modules.
 */

import { Utils } from '../core/utils.js';

export const ForceLayout = {
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
        if (this.mode === 'strict') this.applyStrictLayout();
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
        // ALWAYS recalculate tree depths on reheat to fix dangling nodes
        this._calcTreeDepths(this.nodes, this.edges);
        if (!this.running) this.start();
    },

    // ── Change layout mode with smooth reheat ─────────────
    setMode(mode) {
        this.mode = mode;
        // CRITICAL: recalculate tree depths for ALL modes, not just strict
        this._calcTreeDepths(this.nodes, this.edges);
        this.reheat(0.8);
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
        const cfg = this.cfg;
        const alpha = this.alpha;

        // 0. Filter active nodes (not hidden by collapsed ancestors)
        const activeNodes = this._getActiveNodes();
        const activeEdges = this._getActiveEdges(activeNodes);

        if (activeNodes.length === 0) return;

        // 1. N-body repulsion
        if (activeNodes.length <= 600) {
            for (let i = 0; i < activeNodes.length; i++) {
                for (let j = i + 1; j < activeNodes.length; j++) {
                    const a = activeNodes[i], b = activeNodes[j];
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
            this._gridRepulsion(activeNodes, alpha);
        }

        // 2. Link spring forces
        const nodeMap = new Map(activeNodes.map(n => [n.id, n]));
        for (const e of activeEdges) {
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

        // 3. Centering force (Only in free mode to avoid interference with tree structures)
        if (this.mode === 'free') {
            let cx = 0, cy = 0;
            for (const n of activeNodes) { cx += n.x; cy += n.y; }
            cx /= activeNodes.length; cy /= activeNodes.length;
            for (const n of activeNodes) {
                n.vx -= (n.x - cx) * cfg.centerStrength * alpha;
                n.vy -= (n.y - cy) * cfg.centerStrength * alpha;
            }
        }

        // 4. Mode-specific structural forces
        if (this.mode === 'strict') {
            // Purely static layout for strict mode: no physics at all.
            // Just satisfy drag mechanics (fx/fy -> x/y)
            for (const n of activeNodes) {
                if (n.fx !== undefined && n.fx !== null) {
                    n.x = n.fx;
                    n.y = n.fy;
                    n.vx = 0; n.vy = 0;
                }
            }
            return; // Skip all other forces
        } else if (this.mode === 'radial') {
            this._applyRadialGraph(activeNodes, alpha);
        }

        // 5. Collision avoidance
        for (let i = 0; i < activeNodes.length; i++) {
            for (let j = i + 1; j < activeNodes.length; j++) {
                const a = activeNodes[i], b = activeNodes[j];
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
        for (const n of activeNodes) {
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
    _applyRadialGraph(nodes, alpha) {
        const radiusStep = 200;
        for (const n of nodes) {
            if (n._depth === 0) {
                // Root stays at center
                n.vx += (0 - n.x) * 0.1 * alpha;
                n.vy += (0 - n.y) * 0.1 * alpha;
                continue;
            }
            // Push to depth-based orbit
            const targetR = (n._depth || 1) * radiusStep;
            const currentR = Math.sqrt(n.x * n.x + n.y * n.y) || 0.1;
            const radialForce = (targetR - currentR) * 0.08 * alpha;
            n.vx += (n.x / currentR) * radialForce;
            n.vy += (n.y / currentR) * radialForce;

            // Angular separation: push siblings apart around the circle
            const angle = Math.atan2(n.y, n.x);
            const vIndex = n._vIndex || 0;
            const vCount = n._vCount || 1;
            const targetAngle = ((vIndex / Math.max(vCount, 1)) * Math.PI * 2) - Math.PI;
            const angleDiff = targetAngle - angle;
            n.vx += Math.cos(angle + Math.PI / 2) * angleDiff * 15 * alpha;
            n.vy += Math.sin(angle + Math.PI / 2) * angleDiff * 15 * alpha;
        }
    },

    // ═══════════════════════════════════════════════════════════
    // BULLETPROOF TREE DEPTH CALCULATION
    // Guarantees: every node gets valid _depth, _vIndex, _vCount
    // No node is ever left "dangling" with unassigned values
    // ═══════════════════════════════════════════════════════════
    _calcTreeDepths(nodes, edges) {
        if (!nodes || nodes.length === 0) return;

        // ─── STEP 0: FULL RESET ─────────────────────────────
        // Clear ALL computed properties from previous runs.
        // This is CRITICAL: stale values cause dangling nodes.
        for (const n of nodes) {
            n._depth = -1;       // -1 = unassigned
            n._vIndex = 0;
            n._visited = false;
            n._vCount = 1;
            n._maxDepth = 0;
        }

        // ─── STEP 1: BUILD ADJACENCY ────────────────────────
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const childrenMap = new Map();
        const incomingCount = new Map();

        for (const n of nodes) {
            childrenMap.set(n.id, []);
            incomingCount.set(n.id, 0);
        }
        for (const e of edges) {
            // Skip edges referencing non-existent nodes
            if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
            childrenMap.get(e.source).push(e.target);
            incomingCount.set(e.target, (incomingCount.get(e.target) || 0) + 1);
        }

        // ─── STEP 2: FIND ROOTS ─────────────────────────────
        const roots = [];
        for (const n of nodes) {
            if ((incomingCount.get(n.id) || 0) === 0) roots.push(n);
        }
        if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]);

        // ─── STEP 3: BFS — assign depths ────────────────────
        // Uses a proper visited set. Each node processed EXACTLY once.
        const bfsVisited = new Set();
        const queue = [];

        for (const r of roots) {
            r._depth = 0;
            bfsVisited.add(r.id);
            queue.push(r);
        }

        while (queue.length > 0) {
            const curr = queue.shift();
            const children = childrenMap.get(curr.id) || [];
            for (const childId of children) {
                if (bfsVisited.has(childId)) continue;
                const child = nodeMap.get(childId);
                if (!child) continue;
                child._depth = curr._depth + 1;
                bfsVisited.add(childId);
                queue.push(child);
            }
        }

        // ─── STEP 4: FALLBACK for unreachable nodes ─────────
        // Any node not reached by BFS gets placed at maxDepth+1
        let maxDepth = 0;
        for (const n of nodes) {
            if (n._depth > maxDepth) maxDepth = n._depth;
        }
        for (const n of nodes) {
            if (n._depth === -1) {
                n._depth = maxDepth + 1;
            }
        }
        // Recalculate after fallback
        maxDepth = 0;
        for (const n of nodes) {
            if (n._depth > maxDepth) maxDepth = n._depth;
        }

        // ─── STEP 5: DFS — assign vertical indices ──────────
        const levels = new Map();

        const visit = (nodeId) => {
            const node = nodeMap.get(nodeId);
            if (!node || node._visited) return;
            node._visited = true;

            const depth = node._depth;
            if (!levels.has(depth)) levels.set(depth, 0);
            node._vIndex = levels.get(depth);
            levels.set(depth, node._vIndex + 1);

            // Sort children by name for stable visual ordering
            const childIds = (childrenMap.get(nodeId) || [])
                .map(id => nodeMap.get(id))
                .filter(c => c && !c._visited)
                .sort((a, b) => a.name.localeCompare(b.name));

            for (const c of childIds) visit(c.id);
        };

        // Visit from roots first (preserves hierarchy)
        const sortedRoots = roots.sort((a, b) => a.name.localeCompare(b.name));
        for (const r of sortedRoots) visit(r.id);

        // CRITICAL: visit ALL remaining unvisited nodes
        for (const n of nodes) {
            if (!n._visited) visit(n.id);
        }

        // ─── STEP 6: VERTICAL COUNTS per depth level ────────
        const depthCounts = new Map();
        for (const n of nodes) {
            const d = n._depth;
            depthCounts.set(d, Math.max(depthCounts.get(d) || 0, n._vIndex + 1));
        }
        for (const n of nodes) {
            n._vCount = depthCounts.get(n._depth) || 1;
            n._maxDepth = maxDepth;
        }
        // Позиции x,y в строгом режиме НЕ перезаписываем здесь — только по явному вызову applyStrictLayout()
    },

    /**
     * Расставить ноды в строгом древовидном виде.
     * @param {Object} [opts]
     * @param {boolean} [opts.onlyUnpositioned] — если true, обновлять только ноды без позиции (x/y null или 0,0)
     */
    applyStrictLayout(opts = {}) {
        const onlyUnpositioned = opts.onlyUnpositioned === true;
        const nodes = this.nodes;
        if (!nodes.length) return;
        this._calcTreeDepths(nodes, this.edges);
        const hStep = 300;
        const vStep = 100;
        for (const n of nodes) {
            if (onlyUnpositioned) {
                const hasPos = n.x != null && n.y != null && !(n.x === 0 && n.y === 0);
                if (hasPos) continue;
            }
            const targetX = n._depth * hStep;
            const vCount = n._vCount || 1;
            const spread = (vCount - 1) * vStep;
            const targetY = (n._vIndex * vStep) - spread / 2;
            n.x = targetX;
            n.y = targetY;
            n.vx = 0;
            n.vy = 0;
        }
    },

    // ── Get current snapshot (for rendering) ─────────────
    getPositions() {
        return this.nodes;
    },

    _getActiveNodes() {
        const nodeMap = new Map(this.nodes.map(n => [n.id, n]));
        const active = [];

        const isHidden = (node) => {
            let curr = node;
            while (curr && curr.parentId) {
                const parent = nodeMap.get(curr.parentId);
                if (parent && parent.collapsed) return true;
                curr = parent;
            }
            return false;
        };

        for (const n of this.nodes) {
            if (!isHidden(n)) active.push(n);
        }
        return active;
    },

    _getActiveEdges(activeNodes) {
        const idSet = new Set(activeNodes.map(n => n.id));
        return this.edges.filter(e => idSet.has(e.source) && idSet.has(e.target));
    }
};
