// Pure helpers shared by the in-page game. No DOM access here so the file can
// be unit-tested with plain Node (`npm test`).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HSP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHAPES = ['rect', 'round', 'blob', 'ghost'];

  const DIFFICULTY = {
    // hueShift in degrees, lightShift in HSL lightness (0..1), noise in RGB units,
    // eye radius in CSS px, srcOffset = how many px the copied pattern is nudged.
    // wobble = idle 3D tilt amplitude in degrees (see wobbleAngles).
    easy:   { hueShift: 10, lightShift: 0.06, noise: 8, eye: 5, srcOffset: 0, slabScale: 1.25, timePerSlab: 14, wobble: 20 },
    normal: { hueShift: 5,  lightShift: 0.035, noise: 4, eye: 4, srcOffset: 1, slabScale: 1.0,  timePerSlab: 11, wobble: 12 },
    hard:   { hueShift: 2.5, lightShift: 0.018, noise: 2, eye: 3, srcOffset: 2, slabScale: 0.85, timePerSlab: 9, wobble: 6 },
    insane: { hueShift: 1,  lightShift: 0.008, noise: 1, eye: 2, srcOffset: 3, slabScale: 0.7,  timePerSlab: 8, wobble: 3 },
  };

  // Idle wobble presets (degrees) for hot-seat and share rounds.
  const WOBBLE = { still: 0, subtle: 6, normal: 12, lively: 20 };

  // A hidden slab is a persona, not a sticker: over time it adopts different
  // poses. Personas set how restless it is; `speed` shortens pose durations.
  const PERSONAS = {
    statue:  { label: 'Statue',  hint: 'almost never moves',      weights: { still: 0.7,  sway: 0.2,  shift: 0.05, twist: 0.05, peek: 0 },    speed: 0.7 },
    sneaky:  { label: 'Sneaky',  hint: 'shifts now and then',     weights: { still: 0.35, sway: 0.35, shift: 0.12, twist: 0.1,  peek: 0.08 }, speed: 1 },
    nervous: { label: 'Nervous', hint: 'cannot sit still',        weights: { still: 0.15, sway: 0.35, shift: 0.2,  twist: 0.15, peek: 0.15 }, speed: 1.4 },
  };
  const POSE_DURATION = { still: [2, 6], sway: [2, 5], shift: [2, 4], twist: [2, 4], peek: [0.5, 0.8] };

  // Picks the next pose for a persona, never repeating the previous kind.
  function nextPose(rnd, persona, prevKind) {
    const P = PERSONAS[persona] || PERSONAS.sneaky;
    let entries = Object.entries(P.weights).filter(([k, w]) => w > 0 && k !== prevKind);
    if (!entries.length) entries = Object.entries(P.weights).filter(([, w]) => w > 0);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = rnd() * total;
    let kind = entries[entries.length - 1][0];
    for (const [k, w] of entries) {
      r -= w;
      if (r <= 0) { kind = k; break; }
    }
    const [lo, hi] = POSE_DURATION[kind];
    const ang = rnd() * Math.PI * 2;
    return { kind, dur: (lo + rnd() * (hi - lo)) / P.speed, dir: [Math.cos(ang), Math.sin(ang)], sign: rnd() < 0.5 ? -1 : 1 };
  }

  // Transform for a pose at local time `tl` (seconds since it began), scaled by
  // the wobble amplitude: tilt (ry, rx), in-plane twist (rz, radians), offset
  // (ox, oy, CSS px) and lift (scale delta). Poses ease in and out.
  function poseTransform(pose, tl, ampDeg, t, phase) {
    const out = { ry: 0, rx: 0, rz: 0, ox: 0, oy: 0, lift: 0 };
    if (!pose || !ampDeg || pose.kind === 'still') return out;
    const k = ampDeg / 12;
    const env = clamp(Math.min(tl / 0.6, (pose.dur - tl) / 0.6, 1), 0, 1);
    switch (pose.kind) {
      case 'sway': {
        const a = wobbleAngles(t, phase, ampDeg);
        out.ry = a.ry * env; out.rx = a.rx * env;
        break;
      }
      case 'shift': {
        const d = 5 * k;
        out.ox = pose.dir[0] * d * env; out.oy = pose.dir[1] * d * env;
        const a = wobbleAngles(t, phase, ampDeg * 0.4);
        out.ry = a.ry * env; out.rx = a.rx * env;
        break;
      }
      case 'twist':
        out.rz = (pose.sign * 3.5 * k * Math.PI / 180) * env;
        break;
      case 'peek': {
        const p = Math.sin(Math.PI * clamp(tl / pose.dur, 0, 1));
        out.lift = 0.06 * k * p;
        const a = wobbleAngles(t * 3, phase, ampDeg * 2);
        out.ry = a.ry * p; out.rx = a.rx * p;
        break;
      }
      default:
        break;
    }
    return out;
  }

  // Stamp ink presets: fraction of the slab area that may be pixel-copied.
  const STAMP_INK = { '30': 0.3, '60': 0.6, unlimited: Infinity };

  // A hidden slab is a physical object: it never sits perfectly still. Returns
  // the tilt around the vertical (ry) and horizontal (rx) axes in radians at
  // time t (seconds) for a slab with its own phase. Two incommensurate sines
  // keep the motion irregular; |ry| <= amp, |rx| <= amp / 2.
  function wobbleAngles(t, phase, ampDeg) {
    const amp = (ampDeg || 0) * Math.PI / 180;
    if (!amp) return { ry: 0, rx: 0 };
    const ry = amp * (0.6 * Math.sin((2 * Math.PI * t) / 3.1 + phase) + 0.4 * Math.sin((2 * Math.PI * t) / 1.7 + 2 * phase));
    const rx = (amp / 2) * Math.sin((2 * Math.PI * t) / 2.3 + 3 * phase);
    return { ry, rx };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }

  // Perceptual-ish distance between two RGB colours (0..~765).
  function colorDistance(a, b) {
    const rmean = (a[0] + b[0]) / 2;
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    const wr = 2 + rmean / 256;
    const wg = 4;
    const wb = 2 + (255 - rmean) / 256;
    return Math.sqrt(wr * dr * dr + wg * dg * dg + wb * db * db);
  }

  // Camouflage score 0..100 from two equally sized RGBA buffers. Pixels that
  // are transparent in the mask buffer (alpha 0) are ignored.
  function camoScore(slabData, bgData) {
    let total = 0;
    let n = 0;
    for (let i = 0; i < slabData.length; i += 4) {
      if (slabData[i + 3] < 8) continue;
      total += colorDistance(
        [slabData[i], slabData[i + 1], slabData[i + 2]],
        [bgData[i], bgData[i + 1], bgData[i + 2]]
      );
      n++;
    }
    if (!n) return 0;
    const mean = total / n;
    // A mean weighted distance of ~280 is "completely different"; anything
    // under ~30 is hard to see with the naked eye.
    return clamp(Math.round(100 * (1 - mean / 280)), 0, 100);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ];
  }

  // Deterministic PRNG so solo rounds can be reproduced from a seed.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Visual "busyness" of an RGBA region (0 flat .. ~1 very detailed): luminance
  // standard deviation plus horizontal gradient energy. Flat pages such as a
  // Wikipedia margin or a Reddit background score close to 0; thumbnails and
  // text score high. `stride` skips pixels for speed.
  function busyness(data, w, h, stride) {
    stride = Math.max(1, stride || 2);
    let n = 0, sum = 0, sum2 = 0, grad = 0, gn = 0;
    for (let y = 0; y < h; y += stride) {
      let prev = -1;
      for (let x = 0; x < w; x += stride) {
        const i = (y * w + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += lum;
        sum2 += lum * lum;
        n++;
        if (prev >= 0) { grad += Math.abs(lum - prev); gn++; }
        prev = lum;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    const g = gn ? grad / gn : 0;
    return clamp((sd / 60) * 0.6 + (g / 25) * 0.4, 0, 1);
  }

  // Below this a spot counts as "flat": hiding there hands the seeker a free hint.
  const FLAT_THRESHOLD = 0.08;

  function spotLabel(busy) {
    if (busy < FLAT_THRESHOLD) return 'flat';
    if (busy < 0.3) return 'ok';
    return 'busy';
  }

  function rectsOverlap(a, b, pad) {
    pad = pad || 0;
    return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
  }

  // Choose non-overlapping placements for `count` slabs inside a viewport,
  // keeping a margin away from the HUD at the top. When `opts.rate(cand)` is
  // given it scores candidate spots (0..1, see busyness) and busy spots are
  // preferred; flat spots are used only when nothing else is available.
  function planPlacements(count, vw, vh, opts) {
    opts = opts || {};
    const rnd = opts.random || Math.random;
    const scale = opts.scale || 1;
    const top = opts.topMargin != null ? opts.topMargin : 64;
    const rate = typeof opts.rate === 'function' ? opts.rate : null;
    const want = rate ? (opts.candidates || 16) : 1;
    const base = clamp(Math.min(vw, vh) * 0.11, 48, 140) * scale;
    const out = [];
    for (let i = 0; i < count; i++) {
      const cands = [];
      for (let attempt = 0; attempt < 200 && cands.length < want; attempt++) {
        const w = Math.round(base * (0.75 + rnd() * 0.6));
        const h = Math.round(base * (0.75 + rnd() * 0.6));
        const x = Math.round(8 + rnd() * Math.max(1, vw - w - 16));
        const y = Math.round(top + rnd() * Math.max(1, vh - h - top - 8));
        const cand = { x, y, w, h, shape: SHAPES[Math.floor(rnd() * SHAPES.length)] };
        if (!out.some((o) => rectsOverlap(o, cand, 12))) cands.push(cand);
      }
      if (!cands.length) continue;
      let pick = cands[0];
      if (rate) {
        for (const c of cands) c.busy = clamp(Number(rate(c)) || 0, 0, 1);
        const good = cands.filter((c) => c.busy >= FLAT_THRESHOLD);
        const pool = good.length ? good : cands;
        const weight = (c) => 0.05 + c.busy;
        let r = rnd() * pool.reduce((a, c) => a + weight(c), 0);
        pick = pool[pool.length - 1];
        for (const c of pool) {
          r -= weight(c);
          if (r <= 0) { pick = c; break; }
        }
      }
      out.push(pick);
    }
    return out;
  }

  // Share codes: compact JSON -> base64url with a version prefix.
  const CODE_PREFIX = 'HSP1.';

  function encodeShareCode(level) {
    const json = JSON.stringify(level);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return CODE_PREFIX + b64;
  }

  function decodeShareCode(code) {
    const trimmed = String(code || '').replace(/\s+/g, '');
    if (!trimmed.startsWith(CODE_PREFIX)) throw new Error('Not a Hide & Seek Paint code');
    let b64 = trimmed.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const level = JSON.parse(new TextDecoder().decode(bytes));
    if (!level || level.v !== 1 || !Array.isArray(level.slabs) || !level.slabs.length) {
      throw new Error('Code is damaged or from an unsupported version');
    }
    for (const s of level.slabs) {
      if (typeof s.img !== 'string' || !s.img.startsWith('data:image/png;base64,')) {
        throw new Error('Code contains invalid slab data');
      }
    }
    return level;
  }

  // Map a slab saved on one viewport onto another viewport size.
  function rescalePlacement(slab, fromW, fromH, toW, toH) {
    const sx = toW / fromW;
    const sy = toH / fromH;
    const s = Math.min(sx, sy);
    return {
      x: clamp(Math.round(slab.x * sx), 0, Math.max(0, toW - Math.round(slab.w * s))),
      y: clamp(Math.round(slab.y * sy), 0, Math.max(0, toH - Math.round(slab.h * s))),
      w: Math.max(8, Math.round(slab.w * s)),
      h: Math.max(8, Math.round(slab.h * s)),
    };
  }

  // Identity of a page for the "hiders on this page" registry: origin + path +
  // query (YouTube videos differ only by ?v=), never the hash.
  function pageKey(href) {
    try {
      const u = new URL(href);
      return u.origin + u.pathname + u.search;
    } catch {
      return String(href || '');
    }
  }

  function seekScore(msLeft, msTotal, guessesUsed, guessLimit, hintsUsed) {
    if (msLeft <= 0) return 0;
    const timePart = Math.round(700 * (msLeft / msTotal));
    const guessPenalty = Math.max(0, guessesUsed - 1) * 60;
    const hintPenalty = (hintsUsed || 0) * 80;
    return Math.max(50, 300 + timePart - guessPenalty - hintPenalty);
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}`;
  }

  function temperatureHint(dist, prevDist) {
    if (dist < 40) return 'Boiling! 🔥🔥';
    if (dist < 90) return 'Hot 🔥';
    if (prevDist == null) return dist < 200 ? 'Warm' : 'Cold ❄️';
    if (dist < prevDist - 5) return 'Warmer ↑';
    if (dist > prevDist + 5) return 'Colder ↓';
    return 'Same…';
  }

  return {
    SHAPES,
    DIFFICULTY,
    WOBBLE,
    STAMP_INK,
    PERSONAS,
    POSE_DURATION,
    nextPose,
    poseTransform,
    wobbleAngles,
    clamp,
    hexToRgb,
    rgbToHex,
    colorDistance,
    camoScore,
    rgbToHsl,
    hslToRgb,
    mulberry32,
    busyness,
    FLAT_THRESHOLD,
    spotLabel,
    rectsOverlap,
    planPlacements,
    encodeShareCode,
    decodeShareCode,
    rescalePlacement,
    seekScore,
    pageKey,
    formatTime,
    temperatureHint,
  };
});
