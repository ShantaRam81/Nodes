/**
 * AetherFS – Боковая панель «Проводник» (дерево узлов)
 */

import { Utils } from '../core/utils.js';
import { NodeTypes } from '../core/nodeTypes.js';
import { Renderer } from '../render/renderer.js';

export const Sidebar = {
    renderTree(app, nodes) {
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
                <div class="tree-item" data-id="${Utils.escapeHtml(node.id)}">
                    ${isFolder ? `<span class="tree-expander open">▼</span>` : '<span style="width:14px;display:inline-block"></span>'}
                    <div style="background: ${NodeTypes.color(node.type)}; width: 8px; height: 8px; display: inline-block; margin-right: 8px; opacity: 0.8;"></div>
                    <span class="tree-item-label">${Utils.escapeHtml(node.name)}</span>
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
        else container.innerHTML = '<div style="opacity:0.5; text-align:center; padding: 20px 0;">Пусто</div>';

        container.querySelectorAll('.tree-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.tree-item').forEach(x => x.classList.remove('selected'));
                el.classList.add('selected');
                app.onNodeSelect(el.dataset.id);
                Renderer.panTo(el.dataset.id, 1.5);
            });
        });

        container.querySelectorAll('.tree-expander').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = el.classList.contains('open');
                const childrenContainer = el.closest('.tree-item').nextElementSibling;
                if (isOpen) {
                    el.classList.remove('open');
                    el.textContent = '▶';
                    if (childrenContainer?.classList.contains('tree-children')) childrenContainer.style.display = 'none';
                } else {
                    el.classList.add('open');
                    el.textContent = '▼';
                    if (childrenContainer?.classList.contains('tree-children')) childrenContainer.style.display = 'block';
                }
            });
        });
    },
};
