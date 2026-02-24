/**
 * AetherFS – Фильтр по дате изменения (панель таймлайна)
 */

import { Utils } from '../core/utils.js';
import { Renderer } from '../render/renderer.js';

export const Timeline = {
    open(app) {
        if (app._timelineOpen) {
            Timeline.close(app);
            return;
        }
        app._timelineOpen = true;

        const dates = app._nodes
            .filter(n => n.modifiedAt instanceof Date && !isNaN(n.modifiedAt))
            .map(n => n.modifiedAt.getTime());
        if (dates.length === 0) {
            Utils.toast('Нет данных о датах', 'info');
            app._timelineOpen = false;
            return;
        }

        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));

        const fromEl = Utils.el('timeline-from');
        const toEl = Utils.el('timeline-to');
        const rangeEl = Utils.el('timeline-range');

        fromEl.value = minDate.toISOString().split('T')[0];
        toEl.value = maxDate.toISOString().split('T')[0];
        rangeEl.value = 100;

        const applyFilter = () => {
            const from = new Date(fromEl.value).getTime();
            const rangeVal = parseInt(rangeEl.value, 10);
            const toInput = new Date(toEl.value).getTime();
            const effectiveTo = from + (toInput - from) * (rangeVal / 100);
            let visible = 0;

            for (const n of app._nodes) {
                if (n.type === 'folder') {
                    n._timelineHidden = false;
                    continue;
                }
                const t = n.modifiedAt instanceof Date ? n.modifiedAt.getTime() : 0;
                n._timelineHidden = (t < from || t > effectiveTo);
                if (!n._timelineHidden) visible++;
            }

            const countEl = Utils.el('timeline-count');
            if (countEl) countEl.textContent = `${visible}`;
            Renderer.markDirty();
        };

        fromEl.addEventListener('change', applyFilter);
        toEl.addEventListener('change', applyFilter);
        rangeEl.addEventListener('input', applyFilter);
        app._timelineCleanup = () => {
            fromEl.removeEventListener('change', applyFilter);
            toEl.removeEventListener('change', applyFilter);
            rangeEl.removeEventListener('input', applyFilter);
        };

        Utils.show(Utils.el('timeline-panel'));
        applyFilter();
    },

    close(app) {
        app._timelineOpen = false;
        if (app._timelineCleanup) {
            app._timelineCleanup();
            app._timelineCleanup = null;
        }
        Utils.hide(Utils.el('timeline-panel'));
        for (const n of app._nodes) n._timelineHidden = false;
        Renderer.markDirty();
    },
};
