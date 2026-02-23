/**
 * AetherFS – Search Module
 * Fuzzy search over the node graph using a simple scoring algorithm.
 */

import { NodeTypes } from '../core/nodeTypes.js';

export const Search = {
    nodes: [],
    _query: '',
    _results: [],

    load(nodes) {
        this.nodes = nodes;
    },

    query(text, limit = 30) {
        this._query = text.toLowerCase().trim();
        if (!this._query) { this._results = []; return []; }

        const scored = [];
        for (const n of this.nodes) {
            const score = this._score(n, this._query);
            if (score > 0) scored.push({ node: n, score });
        }

        scored.sort((a, b) => b.score - a.score);
        this._results = scored.slice(0, limit).map(s => s.node);
        return this._results;
    },

    _score(node, q) {
        const name = node.name.toLowerCase();
        const path = node.path.toLowerCase();

        if (name === q) return 100;
        if (name.startsWith(q)) return 80;
        const nameIdx = name.indexOf(q);
        if (nameIdx !== -1) return 60 - nameIdx * 0.5;
        if (path.includes(q)) return 30;

        let j = 0;
        for (let i = 0; i < name.length && j < q.length; i++) {
            if (name[i] === q[j]) j++;
        }
        if (j === q.length) return Math.max(1, 20 - (name.length - q.length));
        return 0;
    },

    highlight(text, query) {
        if (!query) return this._escape(text);
        const q = query.toLowerCase();
        const lo = text.toLowerCase();

        const idx = lo.indexOf(q);
        if (idx !== -1) {
            return this._escape(text.slice(0, idx))
                + `<mark>${this._escape(text.slice(idx, idx + q.length))}</mark>`
                + this._escape(text.slice(idx + q.length));
        }

        let out = '', j = 0;
        for (let i = 0; i < text.length; i++) {
            if (j < q.length && text[i].toLowerCase() === q[j]) {
                out += `<mark>${this._escape(text[i])}</mark>`;
                j++;
            } else {
                out += this._escape(text[i]);
            }
        }
        return out;
    },

    _escape(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    renderResults(containerEl, results, query, onSelect) {
        if (results.length === 0) {
            containerEl.innerHTML = query
                ? `<div class="search-empty">Результатов по запросу "<strong>${this._escape(query)}</strong>" не найдено</div>`
                : `<div class="search-empty">Начните вводить текст для поиска файлов и папок…</div>`;
            return;
        }

        containerEl.innerHTML = results.map((n, i) => {
            return `
                <div class="search-result" data-id="${n.id}">
                    <div class="sr-icon"><div style="background: ${NodeTypes.color(n.type)}; width: 10px; height: 10px;"></div></div>
                    <div class="sr-info">
                        <div class="sr-name">${this.highlight(n.name, query)}</div>
                        <div class="sr-path">${this.highlight(n.path, query)}</div>
                    </div>
                </div>
            `;
        }).join('');

        this._onSelect = onSelect;

        // Bind clicks manually instead of relying on global AetherApp inline string
        containerEl.querySelectorAll('.search-result').forEach(el => {
            el.addEventListener('click', () => {
                if (this._onSelect) this._onSelect(el.dataset.id);
            });
        });
    }
};
