// Hide & Seek Paint - in-page game. Injected on demand into the active tab.
// The visible viewport is snapshotted into a canvas; slabs are painted and hunted on top of it.
(function () {
  'use strict';
  if (window.__HSP_LOADED__) return;
  window.__HSP_LOADED__ = true;

  const L = globalThis.HSP;
  const HUD_H = 60;
  const GREY = '#8b9099';
  const ZMAX = 2147483647;

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .root {
      position: fixed; inset: 0; z-index: ${ZMAX};
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #f1f2f8; user-select: none; -webkit-user-select: none;
      overscroll-behavior: contain; touch-action: none;
    }
    .board { position: absolute; left: 0; top: 0; display: block; cursor: crosshair; touch-action: none; }
    .board.move { cursor: grab; }
    .board.moving { cursor: grabbing; }
    .board.picker { cursor: copy; }
    .board.seek { cursor: crosshair; }
    .hud {
      position: absolute; left: 0; right: 0; top: 0; height: ${HUD_H}px;
      display: flex; align-items: center; gap: 14px; padding: 0 14px;
      background: linear-gradient(180deg, rgba(14,15,22,.96), rgba(14,15,22,.88));
      border-bottom: 1px solid rgba(255,255,255,.08); backdrop-filter: blur(6px);
      box-shadow: 0 4px 24px rgba(0,0,0,.35);
    }
    .hud .title { font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
    .hud .title small { display: block; font-weight: 400; color: #9a9fb8; font-size: 11px; }
    .hud .mid { flex: 1; display: flex; justify-content: center; gap: 22px; align-items: center; }
    .stat { text-align: center; min-width: 64px; }
    .stat b { display: block; font-size: 20px; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .stat b.warn { color: #ff6b6b; }
    .stat span { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #9a9fb8; }
    .btn {
      appearance: none; border: 1px solid rgba(255,255,255,.14); background: #262a3b; color: #f1f2f8;
      padding: 8px 14px; border-radius: 9px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap;
      transition: background .12s, transform .08s;
    }
    .btn:hover { background: #333852; transform: translateY(-1px); }
    .btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
    .btn.primary { background: #7cf2a7; color: #0c1a12; border-color: transparent; }
    .btn.primary:hover { background: #9af7bb; }
    .btn.danger { background: #3a2028; border-color: #6a2c3c; color: #ffb3b3; }
    .btn.ghost { background: transparent; }
    .btn.small { padding: 5px 10px; font-size: 12px; }
    .tools {
      position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 8px; padding: 8px 10px; max-width: calc(100vw - 24px); flex-wrap: wrap; justify-content: center;
      background: rgba(14,15,22,.94); border: 1px solid rgba(255,255,255,.1); border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,.45);
    }
    .tools.top { bottom: auto; top: ${HUD_H + 12}px; }
    .tool {
      width: 40px; height: 40px; border-radius: 10px; border: 1px solid transparent; background: #1f2231;
      color: #f1f2f8; font-size: 18px; cursor: pointer; display: grid; place-items: center; position: relative;
    }
    .tool:hover { background: #2b2f44; }
    .tool.active { border-color: #7cf2a7; background: #23392d; }
    .tool:disabled { opacity: .35; cursor: not-allowed; }
    .tool .kbd { position: absolute; right: 3px; bottom: 1px; font-size: 9px; color: #9a9fb8; }
    .sep { width: 1px; height: 30px; background: rgba(255,255,255,.12); margin: 0 2px; }
    .field { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: #9a9fb8; text-transform: uppercase; letter-spacing: .06em; }
    .field input[type=range] { width: 90px; accent-color: #7cf2a7; margin: 0; }
    .field input[type=color] { width: 40px; height: 28px; border: none; background: none; padding: 0; cursor: pointer; }
    .swatches { display: flex; gap: 4px; }
    .swatch { width: 18px; height: 18px; border-radius: 5px; border: 1px solid rgba(255,255,255,.2); cursor: pointer; }
    .ink { position: absolute; left: 4px; right: 4px; bottom: 3px; height: 3px; background: #333; border-radius: 2px; overflow: hidden; }
    .ink i { display: block; height: 100%; background: #ff8bd1; }
    .modal-wrap {
      position: absolute; inset: 0; display: grid; place-items: center; background: rgba(8,9,14,.62); backdrop-filter: blur(3px);
    }
    .modal-wrap.opaque { background: #0e0f16; backdrop-filter: none; }
    .modal {
      width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
      background: #171923; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; padding: 22px 24px;
      box-shadow: 0 30px 80px rgba(0,0,0,.6);
    }
    .modal h2 { margin: 0 0 6px; font-size: 22px; }
    .modal p { margin: 6px 0; color: #c9ccdc; }
    .modal .big { font-size: 42px; font-weight: 800; margin: 8px 0; }
    .modal .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .modal .muted { color: #9a9fb8; font-size: 12px; }
    .choices { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 10px; }
    .choice { padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: #1f2231; cursor: pointer; color: #f1f2f8; font: inherit; }
    .choice.active { border-color: #7cf2a7; background: #23392d; }
    textarea.code {
      width: 100%; height: 110px; resize: vertical; font: 11px/1.3 ui-monospace, Menlo, Consolas, monospace;
      background: #0e0f16; color: #c9ccdc; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 8px;
    }
    .toast {
      position: absolute; left: 50%; top: ${HUD_H + 14}px; transform: translateX(-50%);
      padding: 8px 16px; border-radius: 999px; background: rgba(14,15,22,.92); border: 1px solid rgba(255,255,255,.12);
      font-weight: 700; pointer-events: none; opacity: 0; transition: opacity .2s; white-space: nowrap;
    }
    .toast.show { opacity: 1; }
    .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 10px 0; }
    .kv b { color: #7cf2a7; }
    [hidden] { display: none !important; }
  `;

  const SHAPE_LABELS = { rect: 'Slab', round: 'Blob', blob: 'Splat', ghost: 'Ghost' };

  function shapePath(shape, w, h) {
    const p = new Path2D();
    switch (shape) {
      case 'round':
        p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case 'blob': {
        const cx = w / 2, cy = h / 2, n = 9;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const r = 0.78 + 0.22 * Math.sin(i * 2.3 + 0.7);
          pts.push([cx + Math.cos(a) * (w / 2) * r, cy + Math.sin(a) * (h / 2) * r]);
        }
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          if (i === 0) p.moveTo(mx, my);
          const c = pts[(i + 1) % n], d = pts[(i + 2) % n];
          p.quadraticCurveTo(b[0], b[1], (c[0] + d[0]) / 2, (c[1] + d[1]) / 2);
        }
        p.closePath();
        break;
      }
      case 'ghost': {
        const r = w / 2;
        p.moveTo(0, r);
        p.arc(r, r, r, Math.PI, 0);
        p.lineTo(w, h - h * 0.12);
        const waves = 4;
        for (let i = waves; i > 0; i--) {
          const x1 = (w / waves) * i, x0 = (w / waves) * (i - 1);
          p.quadraticCurveTo((x0 + x1) / 2, h + h * 0.08, x0, h - h * 0.12);
        }
        p.closePath();
        break;
      }
      default:
        p.roundRect(0, 0, w, h, Math.min(8, w / 6, h / 6));
    }
    return p;
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (v != null) n.setAttribute(k, v);
      }
    }
    for (const c of children || []) n.append(c);
    return n;
  }

  // Tiny WebAudio synth for feedback beeps. Never throws.
  class Sfx {
    constructor(enabled) { this.enabled = enabled; this.ctx = null; }
    play(kind) {
      if (!this.enabled) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = this.ctx || new AC();
        const c = this.ctx;
        if (c.state === 'suspended') c.resume();
        const notes = {
          hit: [[660, 0, 0.08], [990, 0.08, 0.14]],
          miss: [[200, 0, 0.18]],
          win: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.3]],
          lose: [[330, 0, 0.2], [247, 0.2, 0.4]],
          tick: [[1400, 0, 0.03]],
          pick: [[900, 0, 0.04]],
          hide: [[440, 0, 0.08], [554, 0.08, 0.16]],
        }[kind] || [];
        for (const [f, t, d] of notes) {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = kind === 'miss' || kind === 'lose' ? 'sawtooth' : 'sine';
          o.frequency.value = f;
          const at = c.currentTime + t;
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(0.1, at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, at + d);
          o.connect(g).connect(c.destination);
          o.start(at);
          o.stop(at + d + 0.02);
        }
      } catch { /* audio is optional */ }
    }
  }

  function safeSend(msg) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  class Game {
    constructor(opts) {
      this.mode = opts.mode;
      this.settings = Object.assign({ difficulty: 'normal', seekTime: 45, guesses: 3, hideTime: 90, hiders: 1, sound: true, wobble: 'normal', stampInk: 'unlimited' }, opts.settings || {});
      this.inkRatio = L.STAMP_INK[this.settings.stampInk] != null ? L.STAMP_INK[this.settings.stampInk] : Infinity;
      this.wobbleAmp = 0;
      this.previewWobble = false;
      this.settings.hiders = L.clamp(Number(this.settings.hiders) || 1, 1, 3);
      this.sfx = new Sfx(this.settings.sound !== false);
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
      this.slabs = [];
      this.markers = [];
      this.hintCircle = null;
      this.phase = 'loading';
      this.tool = 'brush';
      this.color = '#ff8bd1';
      this.brushSize = 14;
      this.opacity = 1;
      this.recent = [];
      this.undo = [];
      this.fx = [];
      this.fxRaf = 0;
      this.round = 1;
      this.soloScore = 0;
      this.timer = null;
      this.hiderScore = null;
      this.buildDom();
      this.bindEvents();
      this.loadScreenshot(opts.screenshot).then(() => this.begin()).catch((e) => {
        this.showModal({ title: 'Could not load snapshot', body: e.message, buttons: [['Close', () => this.destroy()]] });
      });
    }

    // ---------- DOM ----------
    buildDom() {
      this.host = el('div', { id: 'hsp-host', tabindex: '-1' });
      // Inline styles beat the popover UA stylesheet (margin:auto, borders, fit-content sizing).
      this.host.style.cssText = `position:fixed;inset:0;z-index:${ZMAX};margin:0;padding:0;border:0;width:auto;height:auto;max-width:none;max-height:none;background:transparent;overflow:visible;`;
      this.shadow = this.host.attachShadow({ mode: 'open' });
      // A constructed stylesheet is CSSOM, so a strict page CSP (YouTube, Facebook,
      // Reddit) cannot block it the way it can block an inline <style> element.
      let styled = false;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        this.shadow.adoptedStyleSheets = [sheet];
        styled = true;
      } catch { /* fall back below */ }
      if (!styled) this.shadow.append(el('style', { text: CSS }));
      this.root = el('div', { class: 'root' });
      this.board = el('canvas', { class: 'board' });
      this.hud = el('div', { class: 'hud' });
      this.tools = el('div', { class: 'tools' });
      this.tools.hidden = true;
      this.modalWrap = el('div', { class: 'modal-wrap' });
      this.modalWrap.hidden = true;
      this.toast = el('div', { class: 'toast' });
      this.root.append(this.board, this.hud, this.tools, this.toast, this.modalWrap);
      this.shadow.append(this.root);
      document.documentElement.append(this.host);
      this.setOverlayVisible(true);
      this.host.focus();
    }

    // Uses the Popover API to put the overlay in the browser's top layer, above
    // site <dialog>s, cookie walls and video controls that out-rank any z-index.
    setOverlayVisible(visible) {
      const h = this.host;
      if (visible) {
        h.style.display = '';
        try {
          if (typeof h.showPopover === 'function') {
            if (!h.hasAttribute('popover')) h.setAttribute('popover', 'manual');
            if (!h.matches(':popover-open')) h.showPopover();
          }
        } catch { /* z-index fallback */ }
      } else {
        try { if (typeof h.hidePopover === 'function' && h.matches(':popover-open')) h.hidePopover(); } catch { /* ignore */ }
        h.style.display = 'none';
      }
    }

    // Decodes a data: URL without an <img> element, so a page's img-src CSP
    // cannot block the snapshot. Falls back to <img> on old browsers.
    async decodeImage(dataUrl) {
      const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl || '');
      if (m && typeof createImageBitmap === 'function') {
        try {
          const bin = atob(m[2]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return await createImageBitmap(new Blob([bytes], { type: m[1] }));
        } catch { /* fall through */ }
      }
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image failed to decode'));
        img.src = dataUrl;
      });
    }

    bindEvents() {
      const b = this.board;
      b.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      b.addEventListener('pointermove', (e) => this.onPointerMove(e));
      b.addEventListener('pointerup', (e) => this.onPointerUp(e));
      b.addEventListener('pointercancel', (e) => this.onPointerUp(e));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      this.root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
      this.root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
      this.onKey = (e) => this.handleKey(e);
      window.addEventListener('keydown', this.onKey, true);
      this.onResize = () => {
        clearTimeout(this.resizeT);
        this.resizeT = setTimeout(() => {
          if (window.innerWidth !== this.vw || window.innerHeight !== this.vh) {
            this.showToast('Window resized - the arena keeps its original size. Use "New snapshot" for a fresh one.', 3500);
          }
        }, 300);
      };
      window.addEventListener('resize', this.onResize);
    }

    handleKey(e) {
      const active = this.shadow.activeElement;
      const typing = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
      if (typing) return;
      const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
      if (scrollKeys.includes(e.key)) e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        if (this.escHandler) this.escHandler();
        else this.confirmQuit();
        return;
      }
      if (this.phase !== 'paint') return;
      const map = { m: 'move', b: 'brush', e: 'picker', s: 'stamp', f: 'fill' };
      if (map[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey) this.setTool(map[e.key.toLowerCase()]);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.doUndo(); }
      if (e.key === '[') this.setBrush(this.brushSize - 2);
      if (e.key === ']') this.setBrush(this.brushSize + 2);
    }

    // ---------- snapshot ----------
    async loadScreenshot(dataUrl) {
      let img;
      try {
        img = await this.decodeImage(dataUrl);
      } catch {
        throw new Error('Snapshot image failed to decode');
      }
      this.S = img.width / this.vw;
      this.bg = document.createElement('canvas');
      this.bg.width = img.width;
      this.bg.height = img.height;
      this.bgCtx = this.bg.getContext('2d', { willReadFrequently: true });
      this.bgCtx.drawImage(img, 0, 0);
      // GPU-friendly copy for per-frame drawing; bgCtx stays CPU-backed for reads.
      this.bgGpu = document.createElement('canvas');
      this.bgGpu.width = this.bg.width;
      this.bgGpu.height = this.bg.height;
      this.bgGpu.getContext('2d').drawImage(img, 0, 0);
      if (img.close) img.close();
      this.board.width = this.bg.width;
      this.board.height = this.bg.height;
      this.board.style.width = this.vw + 'px';
      this.board.style.height = this.vh + 'px';
      // GPU-backed: every pixel read goes to the bg or slab canvases, so a 4K
      // hi-DPI board stays smooth while painting.
      this.ctx = this.board.getContext('2d');
      this.render();
    }

    async recapture() {
      this.setOverlayVisible(false);
      await new Promise((r) => setTimeout(r, 120));
      try {
        const res = await chrome.runtime.sendMessage({ type: 'HSP_CAPTURE' });
        if (!res || !res.ok) throw new Error(res ? res.error : 'No response');
        this.vw = window.innerWidth;
        this.vh = window.innerHeight;
        await this.loadScreenshot(res.screenshot);
      } catch (e) {
        this.showToast('Snapshot failed: ' + e.message, 3000);
      } finally {
        this.setOverlayVisible(true);
      }
    }

    // ---------- slabs ----------
    makeSlab(x, y, w, h, shape) {
      const S = this.S;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * S));
      canvas.height = Math.max(1, Math.round(h * S));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const slab = {
        x, y, w, h, shape, canvas, ctx, path: shapePath(shape, w, h), found: false, ink: 0, inkMax: 0,
        phase: Math.random() * Math.PI * 2,
        depth: L.clamp(Math.min(w, h) * 0.08, 4, 12),
      };
      this.resetSlabPaint(slab);
      return slab;
    }

    resetSlabPaint(slab) {
      const c = slab.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, slab.canvas.width, slab.canvas.height);
      c.save();
      c.setTransform(this.S, 0, 0, this.S, 0, 0);
      c.clip(slab.path);
      c.fillStyle = GREY;
      c.fillRect(0, 0, slab.w, slab.h);
      // subtle "blank concrete" texture
      c.fillStyle = 'rgba(255,255,255,.06)';
      for (let i = 0; i < 40; i++) c.fillRect(Math.random() * slab.w, Math.random() * slab.h, 2, 2);
      c.restore();
      slab.inkMax = this.inkRatio === Infinity ? Infinity : Math.round(slab.w * slab.h * this.inkRatio);
      slab.ink = slab.inkMax;
    }

    resizeSlab(slab, w, h) {
      const S = this.S;
      const old = slab.canvas;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * S));
      canvas.height = Math.max(1, Math.round(h * S));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.save();
      ctx.setTransform(S, 0, 0, S, 0, 0);
      const path = shapePath(slab.shape, w, h);
      ctx.clip(path);
      ctx.drawImage(old, 0, 0, w, h);
      ctx.restore();
      const cx = slab.x + slab.w / 2, cy = slab.y + slab.h / 2;
      Object.assign(slab, { canvas, ctx, path, w, h });
      slab.inkMax = this.inkRatio === Infinity ? Infinity : Math.round(w * h * this.inkRatio);
      slab.depth = L.clamp(Math.min(w, h) * 0.08, 4, 12);
      slab.ink = Math.min(slab.ink, slab.inkMax);
      this.moveSlab(slab, cx - w / 2, cy - h / 2);
    }

    moveSlab(slab, x, y) {
      const S = this.S;
      x = L.clamp(x, 0, this.vw - slab.w);
      y = L.clamp(y, HUD_H + 2, this.vh - slab.h);
      slab.x = Math.round(x * S) / S;
      slab.y = Math.round(y * S) / S;
    }

    hitSlab(slab, px, py) {
      if (px < slab.x || py < slab.y || px > slab.x + slab.w || py > slab.y + slab.h) return false;
      // isPointInPath transforms the Path2D by the CTM but takes the point in
      // device pixels, so scale the local point by S.
      const c = slab.ctx;
      c.save();
      c.setTransform(this.S, 0, 0, this.S, 0, 0);
      const hit = c.isPointInPath(slab.path, (px - slab.x) * this.S, (py - slab.y) * this.S);
      c.restore();
      return hit;
    }

    slabCamo(slab) {
      const S = this.S;
      const W = slab.canvas.width, H = slab.canvas.height;
      const sd = slab.ctx.getImageData(0, 0, W, H).data;
      const bd = this.bgCtx.getImageData(Math.round(slab.x * S), Math.round(slab.y * S), W, H).data;
      return L.camoScore(sd, bd);
    }

    slabBusyness(slab) {
      const S = this.S;
      const W = slab.canvas.width, H = slab.canvas.height;
      const bd = this.bgCtx.getImageData(Math.round(slab.x * S), Math.round(slab.y * S), W, H).data;
      return L.busyness(bd, W, H, Math.max(1, Math.round(S * 2)));
    }

    regionBusyness(x, y, w, h) {
      const S = this.S;
      const W = Math.max(1, Math.round(w * S)), H = Math.max(1, Math.round(h * S));
      const bd = this.bgCtx.getImageData(Math.round(x * S), Math.round(y * S), W, H).data;
      return L.busyness(bd, W, H, Math.max(1, Math.round(S * 2)));
    }

    // ---------- reveal effects ----------
    // A cheap "3D" flip: the found slab pops out of the page and spins once
    // around its vertical axis with a drop shadow, then settles back.
    revealSlab(slab) {
      this.fx.push({ slab, t0: performance.now(), dur: 750 });
      this.startFx();
    }

    // True while something on the board moves on its own (reveal flips, the
    // result pulse, or hidden slabs idling in 3D).
    needsAnimation() {
      if (this.fx.length || this.phase === 'result') return true;
      if (this.phase === 'seek' && this.wobbleAmp > 0 && this.slabs.some((s) => !s.found)) return true;
      if (this.phase === 'paint' && this.previewWobble && this.active) return true;
      return false;
    }

    startFx() {
      if (this.fxRaf) return;
      let last = 0;
      const loop = (ts) => {
        this.fxRaf = 0;
        const now = performance.now();
        this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
        // ~30 fps is plenty for a slow wobble and keeps 4K boards cheap.
        if (ts - last >= 30 || this.fx.length) { last = ts; this.render(); }
        if (this.needsAnimation()) this.fxRaf = requestAnimationFrame(loop);
      };
      this.fxRaf = requestAnimationFrame(loop);
    }

    // Wobble amplitude for a slab right now (degrees), 0 when it should sit still.
    slabWobble(slab) {
      if (slab.found) return 0;
      if (this.phase === 'seek') return this.wobbleAmp;
      if (this.phase === 'paint' && this.previewWobble && slab === this.active) return Math.max(this.wobbleAmp, L.WOBBLE[this.settings.wobble] || 0);
      return 0;
    }

    // Draws a slab as a thin 3D object tilted by (ry, rx). The front face is the
    // painted canvas; the back face is bare concrete and peeks out at the edges
    // that turn towards the viewer, together with a sliding drop shadow.
    drawSlab3D(c, slab, ry, rx) {
      const cosY = Math.cos(ry), sinY = Math.sin(ry), cosX = Math.cos(rx), sinX = Math.sin(rx);
      const d = slab.depth;
      c.save();
      c.translate(slab.x + slab.w / 2, slab.y + slab.h / 2);
      c.scale(cosY, cosX);
      c.translate(-slab.w / 2, -slab.h / 2);
      c.save();
      c.translate((-d * sinY) / cosY, (d * sinX) / cosX);
      c.shadowColor = 'rgba(0,0,0,.35)';
      c.shadowBlur = 5;
      c.shadowOffsetX = -sinY * 6;
      c.shadowOffsetY = sinX * 6 + 1;
      const g = c.createLinearGradient(0, 0, 0, slab.h);
      g.addColorStop(0, '#a3a8b0');
      g.addColorStop(1, '#4a4f57');
      c.fillStyle = g;
      c.fill(slab.path);
      c.restore();
      c.drawImage(slab.canvas, 0, 0, slab.w, slab.h);
      c.restore();
    }

    // ---------- rendering ----------
    render() {
      const c = this.ctx;
      if (!c) return;
      const S = this.S;
      c.setTransform(S, 0, 0, S, 0, 0);
      c.clearRect(0, 0, this.vw, this.vh);
      c.drawImage(this.bgGpu || this.bg, 0, 0, this.vw, this.vh);
      const now = performance.now();
      for (const slab of this.slabs) {
        if (slab.hiddenFromView) continue;
        const fx = this.fx.find((f) => f.slab === slab);
        if (fx) {
          const t = L.clamp((now - fx.t0) / fx.dur, 0, 1);
          const ease = 1 - Math.pow(1 - t, 3);
          const sx = Math.cos(ease * Math.PI * 2);
          const lift = Math.sin(Math.PI * t) * 0.35;
          c.save();
          c.translate(slab.x + slab.w / 2, slab.y + slab.h / 2);
          c.shadowColor = 'rgba(0,0,0,.55)';
          c.shadowBlur = 40 * lift + 4;
          c.shadowOffsetY = 30 * lift + 2;
          c.scale(Math.max(0.02, Math.abs(sx)) * (1 + lift), 1 + lift);
          c.drawImage(slab.canvas, -slab.w / 2, -slab.h / 2, slab.w, slab.h);
          c.shadowColor = 'transparent';
          c.translate(-slab.w / 2, -slab.h / 2);
          if (sx < 0) { c.fillStyle = 'rgba(20,22,30,.75)'; c.fill(slab.path); }
          c.lineWidth = 3;
          c.strokeStyle = '#7cf2a7';
          c.stroke(slab.path);
          c.restore();
          continue;
        }
        const amp = this.slabWobble(slab);
        if (amp > 0) {
          const a = L.wobbleAngles(now / 1000, slab.phase, amp);
          this.drawSlab3D(c, slab, a.ry, a.rx);
        } else {
          c.drawImage(slab.canvas, slab.x, slab.y, slab.w, slab.h);
        }
        const outline = (this.phase === 'paint' && slab === this.active) || (this.phase === 'result' && !slab.found) || slab.found;
        if (outline) {
          c.save();
          c.translate(slab.x, slab.y);
          c.lineWidth = 2;
          if (slab.found) {
            c.strokeStyle = '#7cf2a7';
            c.shadowColor = '#7cf2a7';
            c.shadowBlur = 12;
          } else if (this.phase === 'result') {
            const pulse = 0.5 + 0.5 * Math.sin(now / 160);
            c.strokeStyle = '#ff6b6b';
            c.shadowColor = '#ff6b6b';
            c.shadowBlur = 8 + 16 * pulse;
            c.lineWidth = 2 + 2 * pulse;
          } else {
            c.strokeStyle = 'rgba(255,255,255,.85)';
            c.setLineDash([6, 4]);
          }
          c.stroke(slab.path);
          c.restore();
        }
      }
      if (this.hintCircle) {
        c.save();
        c.beginPath();
        c.arc(this.hintCircle.x, this.hintCircle.y, this.hintCircle.r, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(124,242,167,.9)';
        c.lineWidth = 3;
        c.setLineDash([10, 8]);
        c.stroke();
        c.restore();
      }
      for (const m of this.markers) {
        c.save();
        c.translate(m.x, m.y);
        c.strokeStyle = m.kind === 'miss' ? '#ff6b6b' : '#7cf2a7';
        c.lineWidth = 3;
        c.shadowColor = 'rgba(0,0,0,.6)';
        c.shadowBlur = 4;
        if (m.kind === 'miss') {
          c.beginPath(); c.moveTo(-8, -8); c.lineTo(8, 8); c.moveTo(8, -8); c.lineTo(-8, 8); c.stroke();
        } else {
          c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.stroke();
        }
        c.restore();
      }
      if (this.phase === 'paint' && this.brushPos && this.tool !== 'move' && this.tool !== 'fill') {
        c.save();
        c.beginPath();
        const r = this.tool === 'picker' ? 6 : this.brushSize / 2;
        c.arc(this.brushPos.x, this.brushPos.y, r, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,255,255,.9)';
        c.lineWidth = 1;
        c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.6)';
        c.setLineDash([2, 2]);
        c.stroke();
        c.restore();
      }
    }

    // ---------- HUD ----------
    setHud({ title, sub, stats, buttons }) {
      this.hud.replaceChildren();
      this.hud.append(el('div', { class: 'title', html: `${title}<small>${sub || ''}</small>` }));
      const mid = el('div', { class: 'mid' });
      this.statEls = {};
      for (const s of stats || []) {
        const b = el('b', { text: s.value });
        this.statEls[s.key] = b;
        mid.append(el('div', { class: 'stat' }, [b, el('span', { text: s.label })]));
      }
      this.hud.append(mid);
      for (const [label, fn, cls] of buttons || []) {
        this.hud.append(el('button', { class: 'btn ' + (cls || ''), text: label, onclick: fn }));
      }
    }

    setStat(key, value, warn) {
      const e = this.statEls && this.statEls[key];
      if (!e) return;
      if (e.textContent !== String(value)) e.textContent = value;
      e.classList.toggle('warn', Boolean(warn));
    }

    showToast(text, ms) {
      this.toast.textContent = text;
      this.toast.classList.add('show');
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => this.toast.classList.remove('show'), ms || 1400);
    }

    showModal({ title, body, bodyEl, buttons, opaque, esc }) {
      this.modalWrap.replaceChildren();
      this.modalWrap.classList.toggle('opaque', Boolean(opaque));
      const m = el('div', { class: 'modal' });
      m.append(el('h2', { html: title }));
      if (body) m.append(el('div', { html: body }));
      if (bodyEl) m.append(bodyEl);
      const row = el('div', { class: 'row' });
      for (const [label, fn, cls] of buttons || []) {
        row.append(el('button', { class: 'btn ' + (cls || ''), text: label, onclick: fn }));
      }
      m.append(row);
      this.modalWrap.append(m);
      this.modalWrap.hidden = false;
      this.escHandler = esc || null;
    }

    hideModal() {
      this.modalWrap.hidden = true;
      this.modalWrap.replaceChildren();
      this.escHandler = null;
    }

    confirmQuit() {
      if (!this.modalWrap.hidden) return;
      this.pauseTimer();
      this.showModal({
        title: 'Leave the game?',
        body: '<p>The current round will be lost.</p>',
        buttons: [
          ['Keep playing', () => { this.hideModal(); this.resumeTimer(); }, 'primary'],
          ['Leave', () => this.destroy(), 'danger'],
        ],
        esc: () => { this.hideModal(); this.resumeTimer(); },
      });
    }

    // ---------- timer ----------
    startTimer(seconds, onEnd) {
      this.stopTimer();
      if (!seconds) return;
      this.timer = { total: seconds * 1000, deadline: performance.now() + seconds * 1000, onEnd, paused: null };
      const tick = () => {
        if (!this.timer) return;
        const left = this.timer.paused != null ? this.timer.deadline - this.timer.paused : this.timer.deadline - performance.now();
        this.setStat('time', L.formatTime(left), left < 10000);
        const sec = Math.ceil(left / 1000);
        if (sec !== this.timer.lastSec) {
          this.timer.lastSec = sec;
          if (sec > 0 && sec <= 5 && this.phase === 'seek') this.sfx.play('tick');
        }
        if (left <= 0) {
          const cb = this.timer.onEnd;
          this.stopTimer();
          cb && cb();
          return;
        }
        this.timer.raf = requestAnimationFrame(tick);
      };
      tick();
    }

    timeLeft() {
      if (!this.timer) return 0;
      return Math.max(0, this.timer.deadline - performance.now());
    }

    adjustTimer(ms) {
      if (this.timer) this.timer.deadline += ms;
    }

    pauseTimer() {
      if (this.timer && this.timer.paused == null) this.timer.paused = performance.now();
    }

    resumeTimer() {
      if (this.timer && this.timer.paused != null) {
        this.timer.deadline += performance.now() - this.timer.paused;
        this.timer.paused = null;
      }
    }

    stopTimer() {
      if (this.timer && this.timer.raf) cancelAnimationFrame(this.timer.raf);
      this.timer = null;
    }

    // ---------- flow ----------
    begin() {
      switch (this.mode) {
        case 'solo': return this.soloBrief();
        case 'seek-code': return this.codeEntry();
        case 'hide-share':
        default: return this.hiderBrief();
      }
    }

    hiderBrief(hiderNo) {
      this.phase = 'brief';
      this.hiderNo = hiderNo || 1;
      this.active = null;
      if (this.hiderNo === 1) this.slabs = [];
      this.markers = [];
      this.hintCircle = null;
      this.render();
      this.tools.hidden = true;
      const N = this.mode === 'hotseat' ? this.settings.hiders : 1;
      const who = N > 1 ? `Hider ${this.hiderNo} of ${N}` : 'Hider';
      this.setHud({ title: `🎨 ${who}`, sub: 'choose your slab', buttons: [['Quit', () => this.confirmQuit(), 'ghost small']] });
      let shape = 'rect', size = 1;
      const shapeRow = el('div', { class: 'choices' });
      const sizeRow = el('div', { class: 'choices' });
      const mk = (row, items, get, set) => {
        row.replaceChildren();
        for (const [val, label] of items) {
          row.append(el('button', { class: 'choice' + (get() === val ? ' active' : ''), text: label, onclick: () => { set(val); mk(row, items, get, set); } }));
        }
      };
      mk(shapeRow, L.SHAPES.map((s) => [s, SHAPE_LABELS[s]]), () => shape, (v) => (shape = v));
      mk(sizeRow, [[0.7, 'Small (harder)'], [1, 'Medium'], [1.4, 'Large (easier)']], () => size, (v) => (size = v));
      const body = el('div', {}, [
        el('p', { html: this.mode === 'hide-share'
          ? 'Paint your slab to blend into this page, hide it, then copy the code for a friend who has the <b>same page</b> open.'
          : `Round ${this.round}${N > 1 ? ` · ${who}` : ''}. Paint your slab so it disappears into the page${N > 1 ? ' (do not cover another hider\'s slab)' : ''}, then pass the device ${this.hiderNo < N ? 'to the next hider' : 'to the seeker'}. Seeker gets <b>${this.settings.seekTime}s</b> and <b>${this.settings.guesses || '∞'}</b> guesses${N > 1 ? ` to find all ${N} slabs` : ''}.` }),
        el('div', { class: 'muted', text: 'Shape' }), shapeRow,
        el('div', { class: 'muted', text: 'Size' }), sizeRow,
        el('p', { class: 'muted', html: `Tools: <b>B</b>rush · <b>E</b>yedropper · <b>S</b>tamp (${this.inkRatio === Infinity ? 'copies the page behind the slab' : `pixel-perfect ink for ${Math.round(this.inkRatio * 100)}% of the slab`}) · <b>F</b>ill · <b>M</b>ove · Ctrl+Z undo` }),
        el('p', { class: 'muted', html: (L.WOBBLE[this.settings.wobble] || 0) > 0 ? 'Your slab is a real object: while the seeker looks, it idles and tilts a little, and its bare concrete edges peek out. Perfect paint helps, a good spot helps more.' : 'Wobble is off: hidden slabs sit perfectly still.' }),
      ]);
      this.showModal({
        title: this.mode === 'hide-share' ? 'Hide & Share' : `Hide & Seek · ${who}`,
        bodyEl: body,
        buttons: [['Start painting', () => this.startPaint(shape, size), 'primary'], ['Quit', () => this.destroy(), 'ghost']],
      });
    }

    startPaint(shape, sizeMul) {
      this.hideModal();
      const base = L.clamp(Math.min(this.vw, this.vh) * 0.15, 60, 200) * sizeMul;
      const w = Math.round(base), h = Math.round(base * (shape === 'ghost' ? 1.2 : 1));
      const slab = this.makeSlab(0, 0, w, h, shape);
      this.moveSlab(slab, this.vw / 2 - w / 2, this.vh / 2 - h / 2);
      slab.hider = this.hiderNo || 1;
      this.slabs.push(slab);
      this.active = slab;
      this.undo = [];
      this.phase = 'paint';
      this.setTool('brush');
      this.buildTools();
      this.tools.hidden = false;
      const N = this.mode === 'hotseat' ? this.settings.hiders : 1;
      this.setHud({
        title: N > 1 ? `🎨 Hider ${this.hiderNo} of ${N}` : '🎨 Hider',
        sub: 'paint, drag into place, then hide',
        stats: [
          { key: 'time', label: 'time', value: this.settings.hideTime ? L.formatTime(this.settings.hideTime * 1000) : '—' },
          { key: 'camo', label: 'camo', value: '0%' },
          { key: 'spot', label: 'spot', value: '—' },
        ],
        buttons: [
          ['Hide it!', () => this.finishHiding(), 'primary'],
          ['Quit', () => this.confirmQuit(), 'ghost small'],
        ],
      });
      this.startTimer(this.settings.hideTime, () => { this.showToast("Time's up - hiding now!", 1800); this.finishHiding(true); });
      this.updateCamo();
      this.render();
    }

    updateCamo() {
      if (!this.active || this.phase !== 'paint') return;
      clearTimeout(this.camoT);
      this.camoT = setTimeout(() => {
        if (!this.active) return;
        const score = this.slabCamo(this.active);
        this.active.camo = score;
        this.setStat('camo', score + '%');
        const busy = this.slabBusyness(this.active);
        this.active.busy = busy;
        const label = L.spotLabel(busy);
        this.setStat('spot', label === 'flat' ? 'flat ⚠' : label, label === 'flat');
      }, 120);
    }

    finishHiding(force) {
      if (this.phase !== 'paint') return;
      const slab = this.active;
      if (!force && this.slabs.some((o) => o !== slab && L.rectsOverlap(o, slab, 4))) {
        this.sfx.play('miss');
        this.showToast("Your slab overlaps another hider's slab - move it somewhere else", 2500);
        return;
      }
      this.stopTimer();
      this.tools.hidden = true;
      this.brushPos = null;
      slab.camo = this.slabCamo(slab);
      slab.busy = this.slabBusyness(slab);
      slab.flat = slab.busy < L.FLAT_THRESHOLD;
      this.hiderScore = Math.max(...this.slabs.map((s) => s.camo || 0));
      this.phase = 'hidden';
      this.sfx.play('hide');
      this.render();
      if (this.mode === 'hide-share') return this.shareScreen();
      const N = this.mode === 'hotseat' ? this.settings.hiders : 1;
      if (this.hiderNo < N) return this.handoffToHider(this.hiderNo + 1);
      this.handoff();
    }

    handoffToHider(next) {
      this.phase = 'handoff';
      this.setHud({ title: '🙈 Pass the device', sub: `hider ${next} is up` });
      this.showModal({
        opaque: true,
        title: `Pass the device to hider ${next}`,
        body: `<p>Hider ${next - 1} is hidden with a camouflage of <b>${this.active.camo}%</b>.${this.active.flat ? ' ⚠️ It sits on a flat area, so the seeker will get a free hint for it.' : ''}</p><p>Hider ${next}: you will see the earlier slabs on the page. Paint your own and hide it somewhere else.</p>`,
        buttons: [[`I am hider ${next} - go!`, () => this.hiderBrief(next), 'primary']],
      });
    }

    handoff() {
      this.phase = 'handoff';
      this.setHud({ title: '🙈 Pass the device', sub: 'no peeking' });
      const many = this.slabs.length > 1;
      const camoLine = many
        ? `<p>Camouflage: ${this.slabs.map((s) => `hider ${s.hider} <b>${s.camo}%</b>`).join(' · ')}.</p>`
        : `<p>The hider scored a camouflage of <b>${this.hiderScore}%</b>.</p>`;
      this.showModal({
        opaque: true,
        title: 'Pass the device to the seeker',
        body: `${camoLine}${this.slabs.some((s) => s.flat) ? '<p>⚠️ A slab is hiding on a flat area of the page, so the seeker starts with a free hint circle for it.</p>' : ''}<p>Seeker: you have <b>${this.settings.seekTime}s</b> and <b>${this.settings.guesses || 'unlimited'}</b> guesses to click on ${many ? `all <b>${this.slabs.length}</b> hidden slabs` : 'the hidden slab'}. ${(L.WOBBLE[this.settings.wobble] || 0) > 0 ? 'Watch for movement: a slab is a real object and its bare edges show when it shifts.' : 'The slabs sit perfectly still.'} Hints cost 10 seconds.</p>`,
        buttons: [['I am the seeker - go!', () => this.startSeek(), 'primary']],
      });
    }

    startSeek() {
      this.hideModal();
      this.phase = 'seek';
      this.markers = [];
      this.hintCircle = null;
      this.guessesUsed = 0;
      this.hintsUsed = 0;
      this.prevDist = null;
      this.seekStart = performance.now();
      this.board.className = 'board seek';
      this.wobbleAmp = this.levelWobble != null ? this.levelWobble : (L.WOBBLE[this.settings.wobble] != null ? L.WOBBLE[this.settings.wobble] : L.WOBBLE.normal);
      this.startFx();
      const total = this.slabs.length;
      this.setHud({
        title: '🔍 Seeker',
        sub: total > 1 ? `find all ${total} slabs` : 'click where the slab is hiding',
        stats: [
          { key: 'time', label: 'time', value: L.formatTime(this.settings.seekTime * 1000) },
          { key: 'guesses', label: 'guesses', value: this.settings.guesses ? this.settings.guesses : '∞' },
          ...(total > 1 ? [{ key: 'found', label: 'found', value: `0/${total}` }] : []),
        ],
        buttons: [
          ['Hint (−10s)', () => this.useHint(), 'small'],
          ['Give up', () => this.endSeek(false), 'danger small'],
          ['Quit', () => this.confirmQuit(), 'ghost small'],
        ],
      });
      this.startTimer(this.settings.seekTime, () => this.endSeek(false));
      const flat = this.slabs.find((s) => !s.found && s.flat);
      if (flat) {
        this.placeHint(flat);
        this.showToast('Free hint: a slab is hiding on a flat part of the page', 2600);
      }
      this.render();
    }

    placeHint(target) {
      const r = Math.max(90, Math.min(this.vw, this.vh) * 0.18);
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.45;
      this.hintCircle = { x: target.x + target.w / 2 + Math.cos(a) * d, y: target.y + target.h / 2 + Math.sin(a) * d, r };
    }

    useHint() {
      if (this.phase !== 'seek') return;
      const unfound = this.slabs.filter((s) => !s.found);
      const target = unfound.find((s) => !s.flat) || unfound[0];
      if (!target) return;
      this.hintsUsed++;
      this.adjustTimer(-10000);
      this.placeHint(target);
      this.showToast('Somewhere in the circle…');
      this.render();
    }

    seekClick(px, py) {
      const hit = this.slabs.find((s) => !s.found && this.hitSlab(s, px, py));
      if (hit) {
        hit.found = true;
        hit.foundAt = performance.now() - this.seekStart;
        this.sfx.play('hit');
        this.revealSlab(hit);
        this.markers.push({ x: px, y: py, kind: 'hit' });
        const remaining = this.slabs.filter((s) => !s.found).length;
        if (this.statEls.found) this.setStat('found', `${this.slabs.length - remaining}/${this.slabs.length}`);
        this.showToast('Found it! 🎉');
        this.render();
        if (!remaining) this.endSeek(true);
        return;
      }
      this.guessesUsed++;
      this.sfx.play('miss');
      this.markers.push({ x: px, y: py, kind: 'miss' });
      const dist = Math.min(...this.slabs.filter((s) => !s.found).map((s) => Math.hypot(s.x + s.w / 2 - px, s.y + s.h / 2 - py)));
      this.showToast(L.temperatureHint(dist, this.prevDist));
      this.prevDist = dist;
      const left = this.settings.guesses ? this.settings.guesses - this.guessesUsed : Infinity;
      if (this.settings.guesses) this.setStat('guesses', Math.max(0, left), left <= 1);
      this.render();
      if (left <= 0) this.endSeek(false);
    }

    endSeek(won) {
      if (this.phase !== 'seek') return;
      const msLeft = this.timeLeft();
      this.stopTimer();
      this.phase = 'result';
      this.hintCircle = null;
      this.board.className = 'board';
      this.render();
      this.startFx();
      const elapsed = performance.now() - this.seekStart;
      const score = won ? L.seekScore(msLeft, this.settings.seekTime * 1000, this.guessesUsed + 1, this.settings.guesses, this.hintsUsed) : 0;
      const foundCount = this.slabs.filter((s) => s.found).length;
      this.sfx.play(won ? 'win' : 'lose');
      safeSend({ type: 'HSP_RECORD_STATS', stats: { rounds: 1, found: foundCount, seekMs: won ? Math.round(elapsed) : null, camo: this.mode === 'seek-code' ? null : this.hiderScore } });
      const sec = (elapsed / 1000).toFixed(1);
      const many = this.slabs.length > 1;
      const detail = many
        ? `<div class="kv">${this.slabs.map((s) => `<span>Hider ${s.hider || '?'} · camo ${s.camo != null ? s.camo + '%' : '?'}</span><b>${s.found ? `found after ${(s.foundAt / 1000).toFixed(1)}s` : 'never found 🏆'}</b>`).join('')}</div>`
        : '';
      const body = won
        ? `<div class="big">🎯 ${many ? 'All found!' : 'Found!'}</div><div class="kv"><span>Time</span><b>${sec}s</b><span>Wrong guesses</span><b>${this.guessesUsed}</b><span>Seeker score</span><b>${score}</b>${!many && this.hiderScore != null ? `<span>Hider camo</span><b>${this.hiderScore}%</b>` : ''}</div>${detail}`
        : `<div class="big">🫥 ${many ? `Found ${foundCount}/${this.slabs.length}` : 'Not found'}</div><p>${many ? 'Slabs that were never found are' : 'The slab is'} outlined in red. ${!many && this.hiderScore != null ? `The hider's camouflage scored <b>${this.hiderScore}%</b>.` : ''}</p>${detail}`;
      const buttons = [];
      if (this.mode === 'hotseat') {
        buttons.push(['Swap roles & play again', () => { this.round++; this.hiderBrief(1); }, 'primary']);
        buttons.push(['New snapshot', async () => { this.hideModal(); await this.recapture(); this.round++; this.hiderBrief(1); }]);
      } else if (this.mode === 'seek-code') {
        buttons.push(['Try another code', () => this.codeEntry(), 'primary']);
      } else {
        buttons.push(['Play again', () => this.hiderBrief(1), 'primary']);
      }
      buttons.push(['Look at the page', () => { this.hideModal(); this.setHud({ title: won ? '🎯 Found' : '🫥 Not found', sub: 'result view', buttons: [['Back', () => this.endSeekModal(body, buttons), 'primary small'], ['Quit', () => this.destroy(), 'ghost small']] }); }]);
      buttons.push(['Quit', () => this.destroy(), 'ghost']);
      this.endSeekModal(body, buttons);
    }

    endSeekModal(body, buttons) {
      this.setHud({ title: 'Round over', sub: '' });
      this.showModal({ title: 'Round over', body, buttons });
    }

    // ---------- share ----------
    shareScreen() {
      this.phase = 'share';
      const slab = this.active;
      const level = {
        v: 1,
        url: location.href,
        vw: this.vw,
        vh: this.vh,
        t: Date.now(),
        seekTime: this.settings.seekTime,
        guesses: this.settings.guesses,
        wobble: this.settings.wobble,
        camo: this.hiderScore,
        slabs: [{ x: slab.x, y: slab.y, w: slab.w, h: slab.h, shape: slab.shape, camo: slab.camo, img: slab.canvas.toDataURL('image/png') }],
      };
      const code = L.encodeShareCode(level);
      safeSend({ type: 'HSP_RECORD_STATS', stats: { camo: this.hiderScore } });
      const ta = el('textarea', { class: 'code', readonly: 'readonly' });
      ta.value = code;
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(code);
          this.showToast('Code copied!');
        } catch {
          ta.focus(); ta.select();
          this.showToast('Select the text and copy it manually', 2500);
        }
      };
      this.setHud({ title: '📤 Hidden', sub: 'share the code' });
      this.showModal({
        opaque: true,
        title: 'Slab hidden! Share this code',
        bodyEl: el('div', {}, [
          el('p', { html: `Camouflage <b>${this.hiderScore}%</b>. Your friend opens <b>${location.host}</b> at the same page, picks <i>Seek from Code</i> and pastes this (${Math.round(code.length / 1024)} KB):` }),
          ta,
          el('p', { class: 'muted', text: 'The code contains only the painted slab and its position, not the page.' }),
        ]),
        buttons: [
          ['Copy code', copy, 'primary'],
          ['Seek it myself now', () => this.handoff()],
          ['Quit', () => this.destroy(), 'ghost'],
        ],
      });
      copy();
    }

    codeEntry() {
      this.phase = 'code';
      this.slabs = [];
      this.markers = [];
      this.render();
      this.setHud({ title: '📥 Seek from code', sub: 'paste a code' });
      const ta = el('textarea', { class: 'code', placeholder: 'HSP1.…' });
      const err = el('p', { class: 'muted' });
      const body = el('div', {}, [el('p', { text: 'Paste the code your friend sent. Open the same page first for the best experience.' }), ta, err]);
      const start = async () => {
        try {
          const level = L.decodeShareCode(ta.value);
          await this.loadLevel(level);
        } catch (e) {
          err.textContent = e.message;
          err.style.color = '#ff6b6b';
        }
      };
      this.showModal({ title: 'Seek from Code', bodyEl: body, buttons: [['Start seeking', start, 'primary'], ['Quit', () => this.destroy(), 'ghost']] });
      setTimeout(() => ta.focus(), 50);
    }

    async loadLevel(level) {
      const slabs = [];
      for (const s of level.slabs) {
        const p = L.rescalePlacement(s, level.vw || this.vw, level.vh || this.vh, this.vw, this.vh);
        const slab = this.makeSlab(p.x, p.y, p.w, p.h, L.SHAPES.includes(s.shape) ? s.shape : 'rect');
        let img;
        try {
          img = await this.decodeImage(s.img);
        } catch {
          throw new Error('Slab image could not be decoded');
        }
        const c = slab.ctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, slab.canvas.width, slab.canvas.height);
        c.save();
        c.setTransform(this.S, 0, 0, this.S, 0, 0);
        c.clip(slab.path);
        c.drawImage(img, 0, 0, slab.w, slab.h);
        c.restore();
        if (img.close) img.close();
        this.moveSlab(slab, p.x, p.y);
        slab.hider = 1;
        slab.camo = s.camo != null ? s.camo : level.camo;
        slab.busy = this.slabBusyness(slab);
        slab.flat = slab.busy < L.FLAT_THRESHOLD;
        slabs.push(slab);
      }
      this.slabs = slabs;
      this.hiderScore = level.camo != null ? level.camo : null;
      if (level.seekTime) this.settings.seekTime = level.seekTime;
      if (level.guesses != null) this.settings.guesses = level.guesses;
      this.levelWobble = L.WOBBLE[level.wobble] != null ? L.WOBBLE[level.wobble] : null;
      let warn = '';
      try {
        const u = new URL(level.url);
        if (u.host !== location.host || u.pathname !== location.pathname) warn = `<p class="muted">⚠️ This code was made on <b>${u.host}${u.pathname}</b>. The slab was painted for that page, so it may stand out here.</p>`;
      } catch { /* ignore */ }
      if (level.vw && (Math.abs(level.vw - this.vw) > 80 || Math.abs(level.vh - this.vh) > 80)) {
        warn += `<p class="muted">⚠️ Made at ${level.vw}×${level.vh}; your viewport is ${this.vw}×${this.vh}. Position was scaled.</p>`;
      }
      this.showModal({
        opaque: true,
        title: 'Ready to seek',
        body: `<p>${slabs.length} slab hidden with <b>${this.hiderScore != null ? this.hiderScore + '%' : '?'}</b> camouflage. You get <b>${this.settings.seekTime}s</b> and <b>${this.settings.guesses || 'unlimited'}</b> guesses.</p>${warn}`,
        buttons: [['Go!', () => this.startSeek(), 'primary'], ['Back', () => this.codeEntry(), 'ghost']],
      });
    }

    // ---------- solo ----------
    soloBrief() {
      this.phase = 'brief';
      this.slabs = [];
      this.markers = [];
      this.hintCircle = null;
      this.render();
      const diff = L.DIFFICULTY[this.settings.difficulty] || L.DIFFICULTY.normal;
      const count = Math.min(2 + this.round, 9);
      const time = Math.round(diff.timePerSlab * count);
      this.setHud({ title: '🦎 Chameleon Hunt', sub: `round ${this.round}`, buttons: [['Quit', () => this.confirmQuit(), 'ghost small']] });
      this.showModal({
        title: `Chameleon Hunt · Round ${this.round}`,
        body: `<p><b>${count}</b> slabs have painted themselves into this page. Every one has a tiny giveaway: a colour that is slightly off, a pattern nudged a pixel, and a little eye.</p><div class="kv"><span>Difficulty</span><b>${this.settings.difficulty}</b><span>Time</span><b>${time}s</b><span>Wrong click</span><b>−3s</b><span>Total score</span><b>${this.soloScore}</b></div><p class="muted">Tip: the slabs never hide under the top bar.</p>`,
        buttons: [
          ['Start round', () => this.startSolo(count, time, diff), 'primary'],
          ...(this.round === 1 ? [['New snapshot', async () => { this.hideModal(); await this.recapture(); this.soloBrief(); }]] : []),
          ['Quit', () => this.destroy(), 'ghost'],
        ],
      });
    }

    startSolo(count, time, diff) {
      this.hideModal();
      const rnd = L.mulberry32((Date.now() ^ (this.round * 7919)) >>> 0);
      // Steer chameleons onto thumbnails, images and text rather than the empty
      // margins that dominate flat sites like Wikipedia or Reddit.
      const rate = (c) => this.regionBusyness(c.x, c.y, c.w, c.h);
      const plan = L.planPlacements(count, this.vw, this.vh, { random: rnd, scale: diff.slabScale, topMargin: HUD_H + 6, rate });
      this.slabs = plan.map((p) => { const slab = this.generateChameleon(p, diff, rnd); slab.busy = p.busy; return slab; });
      this.markers = [];
      this.hintCircle = null;
      this.phase = 'seek';
      this.soloMode = true;
      this.roundScore = 0;
      this.guessesUsed = 0;
      this.hintsUsed = 0;
      this.seekStart = performance.now();
      this.board.className = 'board seek';
      this.wobbleAmp = diff.wobble;
      this.startFx();
      this.setHud({
        title: '🦎 Chameleon Hunt',
        sub: `round ${this.round} · ${this.settings.difficulty}`,
        stats: [
          { key: 'time', label: 'time', value: L.formatTime(time * 1000) },
          { key: 'found', label: 'found', value: `0/${count}` },
          { key: 'score', label: 'score', value: this.soloScore },
        ],
        buttons: [['Give up', () => this.endSolo(false), 'danger small'], ['Quit', () => this.confirmQuit(), 'ghost small']],
      });
      this.startTimer(time, () => this.endSolo(false));
      this.render();
    }

    generateChameleon(p, diff, rnd) {
      const S = this.S;
      const slab = this.makeSlab(p.x, p.y, p.w, p.h, p.shape);
      const c = slab.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, slab.canvas.width, slab.canvas.height);
      const ang = rnd() * Math.PI * 2;
      const ox = Math.round(Math.cos(ang) * diff.srcOffset), oy = Math.round(Math.sin(ang) * diff.srcOffset);
      c.save();
      c.setTransform(S, 0, 0, S, 0, 0);
      c.clip(slab.path);
      c.drawImage(this.bg, Math.round((p.x + ox) * S), Math.round((p.y + oy) * S), slab.canvas.width, slab.canvas.height, 0, 0, p.w, p.h);
      c.restore();
      const id = c.getImageData(0, 0, slab.canvas.width, slab.canvas.height);
      const d = id.data;
      const hue = (rnd() < 0.5 ? -1 : 1) * diff.hueShift / 360;
      const light = (rnd() < 0.5 ? -1 : 1) * diff.lightShift;
      const noise = diff.noise;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const hsl = L.rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const h = (hsl[0] + hue + 1) % 1;
        const l = L.clamp(hsl[2] + light, 0, 1);
        const rgb = L.hslToRgb(h, hsl[1], l);
        const n = (rnd() - 0.5) * noise;
        d[i] = L.clamp(rgb[0] + n, 0, 255);
        d[i + 1] = L.clamp(rgb[1] + n, 0, 255);
        d[i + 2] = L.clamp(rgb[2] + n, 0, 255);
        d[i + 3] = 255;
      }
      c.putImageData(id, 0, 0);
      // The chameleon's eye
      const r = diff.eye;
      const ex = p.w * (0.3 + rnd() * 0.4), ey = p.h * (0.3 + rnd() * 0.4);
      c.save();
      c.setTransform(S, 0, 0, S, 0, 0);
      c.clip(slab.path);
      c.beginPath(); c.arc(ex, ey, r, 0, Math.PI * 2); c.fillStyle = '#f4f4ef'; c.fill();
      c.beginPath(); c.arc(ex + r * 0.2, ey, r * 0.55, 0, Math.PI * 2); c.fillStyle = '#1d2029'; c.fill();
      c.beginPath(); c.arc(ex + r * 0.35, ey - r * 0.3, r * 0.18, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
      c.restore();
      slab.hiddenFromView = false;
      return slab;
    }

    soloClick(px, py) {
      const hit = this.slabs.find((s) => !s.found && this.hitSlab(s, px, py));
      if (hit) {
        hit.found = true;
        this.revealSlab(hit);
        const bonus = 100 + Math.round(this.timeLeft() / 1000) * 3;
        this.roundScore += bonus;
        this.soloScore += bonus;
        this.sfx.play('hit');
        this.markers.push({ x: px, y: py, kind: 'hit' });
        const found = this.slabs.filter((s) => s.found).length;
        this.setStat('found', `${found}/${this.slabs.length}`);
        this.setStat('score', this.soloScore);
        this.showToast(`+${bonus} 🦎`);
        this.render();
        if (found === this.slabs.length) this.endSolo(true);
        return;
      }
      this.guessesUsed++;
      this.adjustTimer(-3000);
      this.sfx.play('miss');
      this.markers.push({ x: px, y: py, kind: 'miss' });
      this.showToast('Miss! −3s');
      this.render();
    }

    endSolo(won) {
      if (this.phase !== 'seek') return;
      const msLeft = this.timeLeft();
      this.stopTimer();
      this.phase = 'result';
      this.board.className = 'board';
      this.render();
      this.startFx();
      const found = this.slabs.filter((s) => s.found).length;
      const elapsed = ((performance.now() - this.seekStart) / 1000).toFixed(1);
      let bonus = 0;
      if (won) {
        bonus = Math.round(msLeft / 1000) * 5 + Math.max(0, 50 - this.guessesUsed * 10);
        this.soloScore += bonus;
      }
      this.sfx.play(won ? 'win' : 'lose');
      safeSend({ type: 'HSP_RECORD_STATS', stats: { rounds: 1, found, soloScore: this.soloScore, soloRound: won ? this.round : this.round - 1 } });
      const body = won
        ? `<div class="big">🦎 All found!</div><div class="kv"><span>Time</span><b>${elapsed}s</b><span>Misses</span><b>${this.guessesUsed}</b><span>Round bonus</span><b>+${bonus}</b><span>Total score</span><b>${this.soloScore}</b></div>`
        : `<div class="big">⏰ Round lost</div><p>You found <b>${found}/${this.slabs.length}</b>. The ones you missed are outlined in red.</p><p>Total score: <b>${this.soloScore}</b></p>`;
      const buttons = [];
      if (won) {
        buttons.push(['Next round', () => { this.round++; this.soloBrief(); }, 'primary']);
        buttons.push(['Next round, new snapshot', async () => { this.hideModal(); await this.recapture(); this.round++; this.soloBrief(); }]);
      } else {
        buttons.push(['Retry round', () => this.soloBrief(), 'primary']);
        buttons.push(['Start over', () => { this.round = 1; this.soloScore = 0; this.soloBrief(); }]);
      }
      buttons.push(['Look at the page', () => { this.hideModal(); this.setHud({ title: won ? '🦎 All found' : '⏰ Round lost', sub: 'result view', buttons: [['Back', () => this.showModal({ title: 'Round over', body, buttons }), 'primary small'], ['Quit', () => this.destroy(), 'ghost small']] }); }]);
      buttons.push(['Quit', () => this.destroy(), 'ghost']);
      this.setHud({ title: 'Round over', sub: '' });
      this.showModal({ title: `Round ${this.round} over`, body, buttons });
    }

    // ---------- paint tools ----------
    buildTools() {
      const t = this.tools;
      t.replaceChildren();
      const toolBtn = (id, icon, title, key) => {
        const b = el('button', { class: 'tool', title: `${title} (${key.toUpperCase()})`, onclick: () => this.setTool(id) }, [document.createTextNode(icon), el('span', { class: 'kbd', text: key })]);
        b.dataset.tool = id;
        return b;
      };
      const stamp = toolBtn('stamp', '🩹', 'Stamp: copies the real pixels behind the slab. Limited ink!', 's');
      this.inkBar = el('i');
      stamp.append(el('div', { class: 'ink' }, [this.inkBar]));
      const colorInput = el('input', { type: 'color', value: this.color, oninput: (e) => this.setColor(e.target.value, false) });
      this.colorInput = colorInput;
      this.swatchRow = el('div', { class: 'swatches' });
      const sizeIn = el('input', { type: 'range', min: '2', max: '60', value: String(this.brushSize), oninput: (e) => this.setBrush(Number(e.target.value)) });
      this.sizeInput = sizeIn;
      const opIn = el('input', { type: 'range', min: '10', max: '100', value: String(this.opacity * 100), oninput: (e) => { this.opacity = Number(e.target.value) / 100; } });
      const slabIn = el('input', { type: 'range', min: '40', max: '200', value: '100', oninput: (e) => {
        const base = this.active.baseW || (this.active.baseW = this.active.w);
        const baseH = this.active.baseH || (this.active.baseH = this.active.h);
        const k = Number(e.target.value) / 100;
        this.pushUndo();
        this.resizeSlab(this.active, Math.max(16, Math.round(base * k)), Math.max(16, Math.round(baseH * k)));
        this.updateCamo();
        this.render();
      } });
      t.append(
        toolBtn('move', '✋', 'Move the slab (or Shift+drag)', 'm'),
        toolBtn('brush', '🖌️', 'Brush', 'b'),
        toolBtn('picker', '💧', 'Eyedropper: pick a colour from the page', 'e'),
        stamp,
        toolBtn('fill', '🪣', 'Fill the whole slab', 'f'),
        el('div', { class: 'sep' }),
        el('label', { class: 'field' }, [document.createTextNode('colour'), colorInput]),
        el('div', { class: 'field' }, [document.createTextNode('recent'), this.swatchRow]),
        el('label', { class: 'field' }, [document.createTextNode('brush'), sizeIn]),
        el('label', { class: 'field' }, [document.createTextNode('opacity'), opIn]),
        el('label', { class: 'field' }, [document.createTextNode('slab size'), slabIn]),
        el('div', { class: 'sep' }),
        el('button', { class: 'btn small', text: '↶ Undo', title: 'Ctrl+Z', onclick: () => this.doUndo() }),
        el('button', { class: 'btn small ghost', text: 'Reset', onclick: () => { this.pushUndo(); this.resetSlabPaint(this.active); this.updateCamo(); this.render(); } }),
        el('button', { class: 'btn small ghost', text: '🎲 Preview', title: 'Preview how your slab wobbles while the seeker looks for it', onclick: (e) => {
          this.previewWobble = !this.previewWobble;
          e.currentTarget.classList.toggle('primary', this.previewWobble);
          if (this.previewWobble) this.startFx(); else this.render();
        } }),
        el('button', { class: 'btn small ghost', text: '⇅', title: 'Move toolbar to the top/bottom', onclick: () => t.classList.toggle('top') }),
      );
      this.renderSwatches();
      this.updateInk();
      this.setTool(this.tool);
    }

    setTool(tool) {
      this.tool = tool;
      for (const b of this.tools.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === tool);
      this.board.className = 'board' + (tool === 'move' ? ' move' : tool === 'picker' ? ' picker' : '');
      this.render();
    }

    setBrush(size) {
      this.brushSize = L.clamp(size, 2, 60);
      if (this.sizeInput) this.sizeInput.value = String(this.brushSize);
      this.render();
    }

    setColor(hex, remember) {
      this.color = hex;
      if (this.colorInput) this.colorInput.value = hex;
      if (remember) {
        this.recent = [hex, ...this.recent.filter((c) => c !== hex)].slice(0, 8);
        this.renderSwatches();
      }
    }

    renderSwatches() {
      if (!this.swatchRow) return;
      this.swatchRow.replaceChildren();
      for (const c of this.recent) {
        const s = el('div', { class: 'swatch', title: c, onclick: () => this.setColor(c, false) });
        s.style.background = c;
        this.swatchRow.append(s);
      }
      if (!this.recent.length) {
        const hint = el('span', { text: 'use eyedropper' });
        hint.style.fontSize = '10px';
        hint.style.color = '#666';
        this.swatchRow.append(hint);
      }
    }

    updateInk() {
      if (!this.inkBar || !this.active) return;
      const pct = this.active.inkMax === Infinity ? 100 : this.active.inkMax ? (this.active.ink / this.active.inkMax) * 100 : 0;
      this.inkBar.parentElement.hidden = this.active.inkMax === Infinity;
      this.inkBar.style.width = pct + '%';
      const stampBtn = this.tools.querySelector('[data-tool=stamp]');
      if (stampBtn) stampBtn.disabled = this.active.ink <= 0;
      if (this.active.ink <= 0 && this.tool === 'stamp') this.setTool('brush');
    }

    pushUndo() {
      const s = this.active;
      if (!s) return;
      this.undo.push({ data: s.ctx.getImageData(0, 0, s.canvas.width, s.canvas.height), x: s.x, y: s.y, w: s.w, h: s.h, ink: s.ink });
      if (this.undo.length > 25) this.undo.shift();
    }

    doUndo() {
      const u = this.undo.pop();
      const s = this.active;
      if (!u || !s) return;
      if (u.w !== s.w || u.h !== s.h) this.resizeSlab(s, u.w, u.h);
      s.ctx.setTransform(1, 0, 0, 1, 0, 0);
      s.ctx.putImageData(u.data, 0, 0);
      s.ink = u.ink;
      this.moveSlab(s, u.x, u.y);
      this.updateInk();
      this.updateCamo();
      this.render();
    }

    pickColorAt(px, py) {
      const S = this.S;
      const over = [...this.slabs].reverse().find((s) => this.hitSlab(s, px, py));
      const d = over
        ? over.ctx.getImageData(Math.round((px - over.x) * S), Math.round((py - over.y) * S), 1, 1).data
        : this.bgCtx.getImageData(Math.round(px * S), Math.round(py * S), 1, 1).data;
      this.setColor(L.rgbToHex(d[0], d[1], d[2]), true);
      this.sfx.play('pick');
      this.showToast(`Picked ${this.color}`, 700);
    }

    paintDab(from, to) {
      const s = this.active;
      const c = s.ctx;
      const S = this.S;
      c.save();
      c.setTransform(S, 0, 0, S, 0, 0);
      c.clip(s.path);
      const lx0 = from.x - s.x, ly0 = from.y - s.y, lx1 = to.x - s.x, ly1 = to.y - s.y;
      if (this.tool === 'brush') {
        c.globalAlpha = this.opacity;
        c.strokeStyle = this.color;
        c.lineWidth = this.brushSize;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(lx0, ly0);
        c.lineTo(lx1 === lx0 && ly1 === ly0 ? lx1 + 0.01 : lx1, ly1);
        c.stroke();
      } else if (this.tool === 'stamp') {
        const r = this.brushSize / 2;
        const dist = Math.hypot(lx1 - lx0, ly1 - ly0);
        const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
        for (let i = 0; i <= steps; i++) {
          if (s.ink <= 0) break;
          const t = steps ? i / steps : 0;
          const x = lx0 + (lx1 - lx0) * t, y = ly0 + (ly1 - ly0) * t;
          if (x < -r || y < -r || x > s.w + r || y > s.h + r) continue;
          c.save();
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.clip();
          c.drawImage(this.bg, Math.round(s.x * S), Math.round(s.y * S), s.canvas.width, s.canvas.height, 0, 0, s.w, s.h);
          c.restore();
          s.ink -= Math.round(Math.PI * r * r * 0.5);
        }
        s.ink = Math.max(0, s.ink);
        this.updateInk();
      }
      c.restore();
    }

    fillSlab() {
      const s = this.active;
      const c = s.ctx;
      c.save();
      c.setTransform(this.S, 0, 0, this.S, 0, 0);
      c.clip(s.path);
      c.globalAlpha = this.opacity;
      c.fillStyle = this.color;
      c.fillRect(0, 0, s.w, s.h);
      c.restore();
    }

    // ---------- pointer ----------
    pointerPos(e) {
      const r = this.board.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    onPointerDown(e) {
      if (!this.modalWrap.hidden) return;
      const p = this.pointerPos(e);
      if (e.button === 2) return;
      if (this.phase === 'seek') {
        if (p.y < HUD_H) return;
        if (this.soloMode) this.soloClick(p.x, p.y); else this.seekClick(p.x, p.y);
        return;
      }
      if (this.phase !== 'paint' || !this.active) return;
      this.board.setPointerCapture(e.pointerId);
      const s = this.active;
      const wantMove = this.tool === 'move' || e.shiftKey || e.button === 1;
      if (wantMove) {
        if (this.tool !== 'move' && !this.hitSlab(s, p.x, p.y)) return;
        this.pushUndo();
        this.drag = { dx: p.x - s.x, dy: p.y - s.y };
        this.board.classList.add('moving');
        return;
      }
      if (this.tool === 'picker') { this.pickColorAt(p.x, p.y); return; }
      if (this.tool === 'fill') { this.pushUndo(); this.fillSlab(); this.updateCamo(); this.render(); return; }
      this.pushUndo();
      this.stroke = { last: p };
      this.paintDab(p, p);
      this.updateCamo();
      this.render();
    }

    onPointerMove(e) {
      const p = this.pointerPos(e);
      if (this.phase === 'paint') {
        this.brushPos = p;
        if (this.drag) {
          this.moveSlab(this.active, p.x - this.drag.dx, p.y - this.drag.dy);
          this.updateCamo();
        } else if (this.stroke) {
          const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
          if (events.length) {
            for (const ce of events) {
              const cp = this.pointerPos(ce);
              this.paintDab(this.stroke.last, cp);
              this.stroke.last = cp;
            }
          } else {
            this.paintDab(this.stroke.last, p);
            this.stroke.last = p;
          }
          this.updateCamo();
        }
        this.render();
      }
    }

    onPointerUp(e) {
      if (this.drag || this.stroke) {
        this.drag = null;
        this.stroke = null;
        this.board.classList.remove('moving');
        try { this.board.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        this.updateCamo();
        this.render();
      }
    }

    destroy() {
      this.stopTimer();
      clearTimeout(this.camoT);
      clearTimeout(this.toastT);
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('resize', this.onResize);
      clearTimeout(this.resizeT);
      if (this.fxRaf) cancelAnimationFrame(this.fxRaf);
      this.fxRaf = 0;
      this.host.remove();
      if (current === this) current = null;
    }
  }

  let current = null;
  // Debug/test handle: lets automated tests inspect the running game.
  Object.defineProperty(window, '__HSP__', { value: { get game() { return current; } }, configurable: true });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === 'HSP_HIDE') {
      if (current) current.destroy();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type !== 'HSP_START') return false;
    if (current) current.destroy();
    try {
      current = new Game(msg);
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return false;
  });
})();
