/**
 * AetherFS – Режим загрузки файлов (выбор папки, загрузка в Remote Storage)
 */

import { Utils } from '../core/utils.js';
import { Renderer } from '../render/renderer.js';
import { ActivityLog } from './activityLog.js';

export const Upload = {
    enterUploadPickerMode(app) {
        if (!app._pendingUploadFiles || app._pendingUploadFiles.length === 0) return;
        app._uploadPickerMode = true;

        const banner = Utils.el('upload-picker-banner');
        if (banner) {
            const count = app._pendingUploadFiles.length;
            const names = app._pendingUploadFiles.map(f => f.name).slice(0, 3).join(', ');
            const extra = count > 3 ? ` и ещё ${count - 3}...` : '';
            banner.querySelector('.upload-picker-text').textContent =
                `📁 Выберите папку для загрузки: ${names}${extra}`;
            Utils.show(banner);
        }

        Renderer.setDimMode(true, 'folder');
        Renderer._uploadPickerMode = true;
        Renderer.markDirty();

        const handler = (e) => {
            const w = Renderer.screenToWorld(e.offsetX, e.offsetY);
            const hit = Renderer.hitTest(w.x, w.y);
            if (hit && hit.type === 'folder') {
                e.stopImmediatePropagation();
                Renderer.canvas.removeEventListener('click', handler, true);
                Upload.uploadToFolder(app, hit);
            }
        };
        app._uploadClickHandler = handler;
        Renderer.canvas.addEventListener('click', handler, true);
    },

    exitUploadPickerMode(app) {
        app._uploadPickerMode = false;
        app._pendingUploadFiles = null;
        Renderer.setDimMode(false);
        Renderer._uploadPickerMode = false;
        Renderer.markDirty();
        Utils.hide(Utils.el('upload-picker-banner'));
        if (app._uploadClickHandler) {
            Renderer.canvas.removeEventListener('click', app._uploadClickHandler, true);
            app._uploadClickHandler = null;
        }
    },

    cancelUploadPicker(app) {
        Upload.exitUploadPickerMode(app);
        Utils.toast('Загрузка отменена', 'info', 1500);
    },

    async uploadToFolder(app, folder) {
        const storage = app.getStorage?.();
        const isRemoteMode = app.isRemoteMode?.() ?? false;

        const files = [...(app._pendingUploadFiles || [])];
        Upload.exitUploadPickerMode(app);
        if (files.length === 0) return;

        app._showProgress(`Загрузка 0 / ${files.length}`);
        let success = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                if (isRemoteMode && storage?.uploadFile) {
                    const targetPath = (folder._dbxPath || folder.path || '/' + folder.name) + '/' + file.name;
                    await storage.uploadFile(targetPath, file);
                    success++;
                }
            } catch (err) {
                Utils.toast(`Ошибка: ${file.name}: ${err.message}`, 'error', 3000);
            }

            app._setLoadingProgress((i + 1) / files.length);
            const textEl = Utils.el('progress-label-text');
            if (textEl) textEl.textContent = `Загрузка ${i + 1} / ${files.length}`;
        }

        app._hideProgress();

        if (success > 0) {
            Utils.toast(`✓ Загружено ${success} файл(ов) в ${folder.name}`, 'success', 3000);
            const fileNames = files.slice(0, 5).map(f => f.name);
            if (files.length > 5) fileNames.push(`…ещё ${files.length - 5}`);
            ActivityLog.add({
                type: 'upload',
                title: `Загрузка в «${folder.name}»`,
                status: 'success',
                tags: [folder.name, `${success} файл(ов)`, ...fileNames],
            });
            if (app._syncStorageNow) app._syncStorageNow();
        }
    },
};
