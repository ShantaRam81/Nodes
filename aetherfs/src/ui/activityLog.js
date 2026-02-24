/**
 * AetherFS – Журнал действий (Activity Log)
 * Стиль: вертикальная временная шкала, иконки статуса, теги.
 */

import { Utils } from '../core/utils.js';

const LABELS = {
    create: 'Создание',
    delete: 'Удаление',
    move: 'Перемещение',
    copy: 'Копирование',
    rename: 'Переименование',
    upload: 'Загрузка',
};

export const ActivityLog = {
    _entries: [],
    _containerId: 'activity-log-entries',
    _panelId: 'activity-log-panel',
    _maxEntries: 100,

    add({ type, title, status = 'success', tags = [], steps = [] }) {
        const id = Utils.uid();
        const entry = {
            id,
            type: type || 'unknown',
            title: title || LABELS[type] || 'Действие',
            status,
            time: new Date(),
            tags: Array.isArray(tags) ? tags : [tags].filter(Boolean),
            steps: Array.isArray(steps) ? steps : [],
        };
        this._entries.unshift(entry);
        if (this._entries.length > this._maxEntries) this._entries.pop();
        this._render();
        return id;
    },

    setStatus(entryId, status, steps = null) {
        const e = this._entries.find(x => x.id === entryId);
        if (e) {
            e.status = status;
            if (steps) e.steps = steps;
            this._render();
        }
    },

    _timeStr(date) {
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    },

    _render() {
        const container = document.getElementById(this._containerId);
        if (!container) return;

        container.innerHTML = this._entries.map(entry => this._renderEntry(entry)).join('');

        container.querySelectorAll('.activity-entry-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const block = btn.closest('.activity-entry');
                if (block) block.classList.toggle('is-expanded');
            });
        });
    },

    _renderEntry(entry) {
        const hasDetails = entry.tags.length > 0 || entry.steps.length > 0;
        const statusIcon = this._statusIcon(entry.status);
        const timeStr = this._timeStr(entry.time);

        const stepsHtml = entry.steps.length
            ? entry.steps.map(s => `
                <div class="activity-step">
                    <span class="activity-step-icon">${s.status === 'pending' ? this._spinnerSvg() : this._checkSvg()}</span>
                    <span class="activity-step-text">${this._escape(s.text)}</span>
                </div>`).join('')
            : '';

        const tagsHtml = entry.tags.length
            ? `<div class="activity-tags">${entry.tags.map(t => `<span class="activity-tag">${this._escape(t)}</span>`).join('')}</div>`
            : '';

        const hasSteps = entry.steps.length > 0;
        return `
            <div class="activity-entry ${hasSteps ? 'has-details' : ''}" data-id="${entry.id}">
                <div class="activity-timeline-dot ${entry.status}">${statusIcon}</div>
                <div class="activity-body">
                    <div class="activity-header">
                        <button type="button" class="activity-entry-toggle" aria-expanded="false">
                            <span class="activity-title">${this._escape(entry.title)}</span>
                            ${hasSteps ? '<span class="activity-caret">▼</span>' : ''}
                        </button>
                        <span class="activity-time">${timeStr}</span>
                    </div>
                    ${tagsHtml}
                    ${stepsHtml ? `<div class="activity-steps">${stepsHtml}</div>` : ''}
                </div>
            </div>`;
    },

    _statusIcon(status) {
        if (status === 'pending') return this._spinnerSvg();
        if (status === 'error') return this._errorSvg();
        return this._checkSvg();
    },

    _checkSvg() {
        return `<svg class="activity-icon activity-icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    },
    _spinnerSvg() {
        return `<svg class="activity-icon activity-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg>`;
    },
    _errorSvg() {
        return `<svg class="activity-icon activity-icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    },

    _escape(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    togglePanel() {
        const panel = document.getElementById(this._panelId);
        if (!panel) return;
        panel.classList.toggle('hidden');
    },

    isPanelVisible() {
        const panel = document.getElementById(this._panelId);
        return panel && !panel.classList.contains('hidden');
    },
};
