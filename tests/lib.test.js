const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../content/lib.js');

test('hex <-> rgb round trip', () => {
  assert.deepEqual(L.hexToRgb('#ff8bd1'), [255, 139, 209]);
  assert.equal(L.rgbToHex(255, 139, 209), '#ff8bd1');
  assert.equal(L.hexToRgb('nope'), null);
  assert.equal(L.rgbToHex(300, -5, 12.6), '#ff000d');
});

test('colorDistance is zero for identical colours and symmetric', () => {
  assert.equal(L.colorDistance([10, 20, 30], [10, 20, 30]), 0);
  const a = [200, 10, 90], b = [20, 220, 5];
  assert.equal(L.colorDistance(a, b), L.colorDistance(b, a));
  assert.ok(L.colorDistance([0, 0, 0], [255, 255, 255]) > 500);
});

test('camoScore rewards matching pixels and ignores transparent ones', () => {
  const bg = new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 255]);
  const perfect = new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 255]);
  const awful = new Uint8ClampedArray([245, 235, 225, 255, 0, 0, 0, 255]);
  const partial = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
  assert.equal(L.camoScore(perfect, bg), 100);
  assert.equal(L.camoScore(awful, bg), 0);
  assert.equal(L.camoScore(partial, bg), 100);
  assert.equal(L.camoScore(new Uint8ClampedArray(8), bg), 0);
});

test('hsl round trip keeps colours close', () => {
  for (const rgb of [[255, 0, 0], [12, 200, 90], [128, 128, 128], [0, 0, 0], [255, 255, 255]]) {
    const [h, s, l] = L.rgbToHsl(...rgb);
    const back = L.hslToRgb(h, s, l);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - rgb[i]) <= 2, `${rgb} -> ${back}`);
  }
});

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = L.mulberry32(42), b = L.mulberry32(42);
  for (let i = 0; i < 50; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('planPlacements keeps slabs inside the viewport, below the HUD and apart', () => {
  const rnd = L.mulberry32(7);
  const vw = 1280, vh = 720;
  const plan = L.planPlacements(8, vw, vh, { random: rnd, topMargin: 64 });
  assert.equal(plan.length, 8);
  for (const p of plan) {
    assert.ok(p.x >= 0 && p.x + p.w <= vw, 'x in range');
    assert.ok(p.y >= 64 && p.y + p.h <= vh, 'y in range');
    assert.ok(L.SHAPES.includes(p.shape));
  }
  for (let i = 0; i < plan.length; i++) {
    for (let j = i + 1; j < plan.length; j++) {
      assert.equal(L.rectsOverlap(plan[i], plan[j]), false, `slabs ${i} and ${j} overlap`);
    }
  }
});

test('planPlacements gives up gracefully when the viewport is tiny', () => {
  const plan = L.planPlacements(20, 120, 120, { random: L.mulberry32(1), topMargin: 60 });
  assert.ok(plan.length < 20);
});

test('share code round trip', () => {
  const level = {
    v: 1, url: 'https://example.com/a?b=1', vw: 1440, vh: 900, seekTime: 45, guesses: 3, camo: 88,
    slabs: [{ x: 100, y: 200, w: 80, h: 60, shape: 'blob', img: 'data:image/png;base64,iVBORw0KGgo=' }],
  };
  const code = L.encodeShareCode(level);
  assert.ok(code.startsWith('HSP1.'));
  assert.doesNotMatch(code, /[+/=]/, 'base64url only');
  assert.deepEqual(L.decodeShareCode(code), level);
  assert.deepEqual(L.decodeShareCode('  ' + code.slice(0, 20) + '\n' + code.slice(20) + ' '), level, 'whitespace tolerated');
});

test('decodeShareCode rejects garbage', () => {
  assert.throws(() => L.decodeShareCode('hello'), /Not a Hide/);
  assert.throws(() => L.decodeShareCode(L.encodeShareCode({ v: 2, slabs: [] })), /unsupported|damaged/);
  assert.throws(() => L.decodeShareCode(L.encodeShareCode({ v: 1, slabs: [{ img: 'javascript:alert(1)' }] })), /invalid slab/);
});

test('rescalePlacement scales positions and clamps to the new viewport', () => {
  const s = { x: 1000, y: 500, w: 100, h: 100 };
  const r = L.rescalePlacement(s, 2000, 1000, 1000, 500);
  assert.deepEqual(r, { x: 500, y: 250, w: 50, h: 50 });
  const tight = L.rescalePlacement({ x: 1900, y: 900, w: 100, h: 100 }, 2000, 1000, 400, 300);
  assert.ok(tight.x + tight.w <= 400 && tight.y + tight.h <= 300);
});

test('seekScore favours speed and few guesses', () => {
  const fast = L.seekScore(40000, 45000, 1, 3, 0);
  const slow = L.seekScore(5000, 45000, 1, 3, 0);
  const sloppy = L.seekScore(40000, 45000, 3, 3, 1);
  assert.ok(fast > slow);
  assert.ok(fast > sloppy);
  assert.equal(L.seekScore(0, 45000, 1, 3, 0), 0);
  assert.ok(L.seekScore(100, 45000, 10, 0, 5) >= 50, 'never below floor when found');
});

test('formatTime and temperatureHint', () => {
  assert.equal(L.formatTime(65000), '1:05');
  assert.equal(L.formatTime(9500), '10');
  assert.equal(L.formatTime(-5), '0');
  assert.match(L.temperatureHint(10), /Boiling/);
  assert.match(L.temperatureHint(500, 100), /Colder/);
  assert.match(L.temperatureHint(100, 500), /Warmer/);
  assert.match(L.temperatureHint(500, null), /Cold/);
});

test('busyness is 0 on flat colour and high on noisy or text-like regions', () => {
  const w = 40, h = 40;
  const flat = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(L.busyness(flat, w, h, 1), 0);
  const noisy = new Uint8ClampedArray(w * h * 4);
  const rnd = L.mulberry32(3);
  for (let i = 0; i < noisy.length; i += 4) { const v = rnd() < 0.5 ? 0 : 255; noisy[i] = noisy[i + 1] = noisy[i + 2] = v; noisy[i + 3] = 255; }
  assert.ok(L.busyness(noisy, w, h, 1) > 0.8);
  const soft = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const v = 200 + x / 8; soft[i] = soft[i + 1] = soft[i + 2] = v; soft[i + 3] = 255; }
  assert.ok(L.busyness(soft, w, h, 1) < L.FLAT_THRESHOLD, 'a gentle gradient still counts as flat');
  assert.equal(L.spotLabel(0.01), 'flat');
  assert.equal(L.spotLabel(0.2), 'ok');
  assert.equal(L.spotLabel(0.7), 'busy');
});

test('planPlacements prefers busy spots when a rate function is given', () => {
  const vw = 1200, vh = 800;
  const rate = (c) => (c.x + c.w / 2 < vw / 2 ? 0.9 : 0);
  const plan = L.planPlacements(6, vw, vh, { random: L.mulberry32(11), rate });
  assert.equal(plan.length, 6);
  for (const p of plan) {
    assert.ok(p.x + p.w / 2 < vw / 2, `slab at ${p.x} should be on the busy left half`);
    assert.equal(p.busy, 0.9);
  }
  const allFlat = L.planPlacements(3, vw, vh, { random: L.mulberry32(5), rate: () => 0 });
  assert.equal(allFlat.length, 3, 'flat pages still get placements');
});

test('wobbleAngles stays within its amplitude, varies over time and is zero when still', () => {
  assert.deepEqual(L.wobbleAngles(1.5, 0.3, 0), { ry: 0, rx: 0 });
  const amp = 12 * Math.PI / 180;
  let maxRy = 0, maxRx = 0, distinct = new Set();
  for (let t = 0; t < 20; t += 0.05) {
    const a = L.wobbleAngles(t, 1.1, 12);
    maxRy = Math.max(maxRy, Math.abs(a.ry));
    maxRx = Math.max(maxRx, Math.abs(a.rx));
    distinct.add(a.ry.toFixed(4));
  }
  assert.ok(maxRy <= amp + 1e-9 && maxRx <= amp / 2 + 1e-9);
  assert.ok(maxRy > amp * 0.7, 'reaches most of its amplitude');
  assert.ok(distinct.size > 300, 'motion is not repetitive');
  assert.notDeepEqual(L.wobbleAngles(3, 0, 12), L.wobbleAngles(3, 2, 12), 'phase makes slabs move differently');
  assert.equal(L.STAMP_INK.unlimited, Infinity);
  assert.equal(L.WOBBLE.still, 0);
  for (const d of Object.values(L.DIFFICULTY)) assert.ok(d.wobble > 0);
});

test('pageKey ignores the hash but keeps origin, path and query', () => {
  assert.equal(L.pageKey('https://www.youtube.com/watch?v=abc#t=10'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(L.pageKey('https://en.wikipedia.org/wiki/Slab#History'), 'https://en.wikipedia.org/wiki/Slab');
  assert.notEqual(L.pageKey('https://www.youtube.com/watch?v=abc'), L.pageKey('https://www.youtube.com/watch?v=def'));
  assert.equal(L.pageKey('not a url'), 'not a url');
});
