/**
 * AetherFS – Utility Functions
 */

'use strict';

const Utils = {
  // ── ID generation ──────────────────────────────────────
  hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36);
  },

  uid() {
    return Math.random().toString(36).slice(2, 10);
  },

  // ── File size formatting ────────────────────────────────
  formatSize(bytes) {
    if (bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log2(Math.max(bytes, 1)) / 10);
    const val = bytes / Math.pow(1024, i);
    return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
  },

  // ── Date formatting ─────────────────────────────────────
  formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return '—';
    return date.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  },

  // ── Smooth animation via rAF ────────────────────────────
  animate({ duration = 400, easing = Utils.easeInOutCubic, onUpdate, onComplete }) {
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      onUpdate(easing(t));
      if (t < 1) requestAnimationFrame(frame);
      else if (onComplete) onComplete();
    }
    requestAnimationFrame(frame);
  },

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },

  easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  },

  // ── Vector math ─────────────────────────────────────────
  dist(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  },

  lerpVec(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  },

  // ── Clamp ───────────────────────────────────────────────
  clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  },

  // ── Deep clone (structured clone fallback) ──────────────
  clone(obj) {
    try { return structuredClone(obj); } catch (_) { return JSON.parse(JSON.stringify(obj)); }
  },

  // ── DOM helpers ─────────────────────────────────────────
  el(id) { return document.getElementById(id); },
  show(el) { el.classList.remove('hidden'); },
  hide(el) { el.classList.add('hidden'); },
  toggle(el) { el.classList.toggle('hidden'); },

  // ── Toast notifications ─────────────────────────────────
  toast(message, type = 'info', duration = 2800) {
    const container = Utils.el('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('exit');
      setTimeout(() => t.remove(), 350);
    }, duration);
  },

  // ── Clipboard ───────────────────────────────────────────
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      Utils.toast('Copied to clipboard', 'success');
    } catch (e) {
      Utils.toast('Copy failed', 'error');
    }
  },

  // ── Debounce ────────────────────────────────────────────
  debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  // ── Throttle ────────────────────────────────────────────
  throttle(fn, ms) {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...args); }
    };
  },
};
