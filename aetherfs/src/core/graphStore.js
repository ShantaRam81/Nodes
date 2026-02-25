/**
 * GraphStore – centralized graph domain store
 * Single source of truth for nodes, edges and basic invariants.
 */

export class GraphStore {
    constructor() {
        this._nodes = [];
        this._edges = [];
        this._nodeMap = new Map();
        this._listeners = new Set();
    }

    /**
     * Replace the whole graph with new nodes/edges and run integrity checks.
     * Consumers that hold references to node objects will continue to work.
     */
    loadGraph(nodes, edges) {
        this._nodes = Array.isArray(nodes) ? nodes : [];
        this._edges = Array.isArray(edges) ? edges : [];
        const result = this._ensureGraphIntegrity();
        this._emit({ type: 'graphChanged', nodes: this._nodes, edges: this._edges });
        return result;
    }

    /**
     * Update graph using existing node/edge arrays that might have been mutated
     * in-place by other modules. This keeps references but still enforces invariants.
     */
    refreshGraph(nodes, edges) {
        if (Array.isArray(nodes)) this._nodes = nodes;
        if (Array.isArray(edges)) this._edges = edges;
        const result = this._ensureGraphIntegrity();
        this._emit({ type: 'graphChanged', nodes: this._nodes, edges: this._edges });
        return result;
    }

    get nodes() { return this._nodes; }
    get edges() { return this._edges; }
    get nodeMap() { return this._nodeMap; }

    getNode(id) {
        return this._nodeMap.get(id) || null;
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _emit(event) {
        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch (e) {
                // Non-fatal: listeners should not break store invariants
                console.warn('[GraphStore] listener error:', e);
            }
        }
    }

    /**
     * Validates and repairs the graph. Removes orphan edges,
     * reconnects dangling nodes, deduplicates edges and rebuilds nodeMap.
     */
    _ensureGraphIntegrity() {
        let fixed = 0;
        const nodeIds = new Set(this._nodes.map(n => n.id));

        // 1) Remove edges referencing non-existent nodes
        const beforeEdges = this._edges.length;
        this._edges = this._edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
        fixed += beforeEdges - this._edges.length;

        // 2) Deduplicate edges (same source→target)
        const edgeKeys = new Set();
        const uniqueEdges = [];
        for (const e of this._edges) {
            const key = `${e.source}→${e.target}`;
            if (!edgeKeys.has(key)) {
                edgeKeys.add(key);
                uniqueEdges.push(e);
            } else {
                fixed++;
            }
        }
        this._edges = uniqueEdges;

        // 3) Find root node (node with no incoming edge)
        const targeted = new Set(this._edges.map(e => e.target));
        const roots = this._nodes.filter(n => !targeted.has(n.id));
        const rootId = roots.length > 0 ? roots[0].id : (this._nodes[0]?.id || null);

        // 4) Detect dangling nodes (no edge connecting them, except root)
        const connected = new Set();
        if (rootId != null) connected.add(rootId);
        for (const e of this._edges) {
            connected.add(e.source);
            connected.add(e.target);
        }
        for (const n of this._nodes) {
            if (!connected.has(n.id) && n.id !== rootId) {
                // Reconnect to parent or root
                const parentId = n.parentId || rootId;
                if (parentId != null && nodeIds.has(parentId)) {
                    this._edges.push({
                        id: `${parentId}->${n.id}`,
                        source: parentId,
                        target: n.id
                    });
                } else if (rootId != null) {
                    this._edges.push({
                        id: `${rootId}->${n.id}`,
                        source: rootId,
                        target: n.id
                    });
                }
                fixed++;
            }
        }

        // 5) Rebuild nodeMap
        this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));

        if (fixed > 0) {
            console.warn(`[GraphStore] Fixed ${fixed} graph issue(s)`);
        }
        return { fixed };
    }
}

// Singleton instance used across the app
export const graphStore = new GraphStore();

