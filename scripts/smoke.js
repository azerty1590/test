// Headless-Chromium smoke test. Loads the extension, serves a colourful page,
// and plays every mode through the real canvas/shadow-DOM code at DPR 2.
// The toolbar click cannot be simulated headlessly (no activeTab grant), so
// the page-side game is driven with a stubbed chrome.runtime while the real
// service worker + popup are checked separately.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node scripts/smoke.js
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SMOKE_OUT || path.join(ROOT, 'smoke-out');
fs.mkdirSync(OUT, { recursive: true });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Arena</title><style>
body{margin:0;font-family:Georgia,serif;background:linear-gradient(135deg,#fdf1d6,#c9e4ff 60%,#ffd7f1)}
header{background:#1d2b53;color:#fff;padding:24px 40px;font-size:28px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:30px 40px}
.card{height:170px;border-radius:14px;box-shadow:0 8px 20px rgba(0,0,0,.15);display:flex;align-items:flex-end;padding:14px;color:#fff;font-weight:bold}
p{padding:0 40px;font-size:18px;line-height:1.6;color:#333}
</style></head><body><header>The Daily Pixel</header><div class="grid">
<div class="card" style="background:#ff7b54">Sunset</div><div class="card" style="background:repeating-linear-gradient(45deg,#2a9d8f 0 12px,#264653 12px 24px)">Stripes</div>
<div class="card" style="background:radial-gradient(circle at 30% 30%,#ffd166,#ef476f)">Peach</div><div class="card" style="background:#8338ec">Violet</div>
<div class="card" style="background:repeating-radial-gradient(#06d6a0 0 6px,#118ab2 6px 12px)">Rings</div><div class="card" style="background:#ffd166;color:#333">Lemon</div>
<div class="card" style="background:linear-gradient(#073b4c,#118ab2)">Ocean</div><div class="card" style="background:#333">Coal</div></div>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.</p>
<p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p></body></html>`;

// A Wikipedia-like page served with a strict CSP: no inline styles, no data: or
// blob: images, no scripts. The extension must still render and play on it.
const STRICT_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
const STRICT_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Slab (geology) - Encyclopedia</title><link rel="stylesheet" href="/strict.css"></head>
<body><div class="side"><ul><li>Main page</li><li>Contents</li><li>Current events</li><li>Random article</li><li>About</li></ul></div>
<div class="main"><h1>Slab (geology)</h1><p class="sub">From the free encyclopedia</p>
<div class="infobox"><img src="/photo.svg" width="220" height="150" alt=""><div class="cap">A slab of layered sandstone</div><table><tr><th>Type</th><td>Sedimentary</td></tr><tr><th>Colour</th><td>Grey</td></tr></table></div>
<p>A <b>slab</b> is a flat, broad, relatively thin piece of stone, concrete or other material. Slabs are used in paving, construction and, in some parts of the internet, for hiding in plain sight. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
<h2>Formation</h2><p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</p>
<p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>
<h2>See also</h2><ul><li>Camouflage</li><li>Hide-and-seek</li><li>Chameleon</li></ul></div></body></html>`;
const STRICT_CSS = `body{margin:0;font-family:sans-serif;color:#202122;background:#fff;display:flex}.side{width:180px;background:#f8f9fa;border-right:1px solid #a2a9b1;padding:20px;font-size:13px;min-height:100vh}.side ul{list-style:none;padding:0;margin:0}.side li{padding:4px 0;color:#0645ad}.main{flex:1;padding:16px 40px;max-width:900px}h1{font-family:serif;font-weight:normal;border-bottom:1px solid #a2a9b1;font-size:28px;margin:0}.sub{color:#54595d;font-size:12px}.infobox{float:right;border:1px solid #a2a9b1;background:#f8f9fa;padding:6px;margin:0 0 12px 16px;width:236px;font-size:12px}.cap{padding:4px 2px}table{width:100%}th{text-align:left;padding:2px 4px}p{line-height:1.6;font-size:14px}h2{font-family:serif;font-weight:normal;border-bottom:1px solid #a2a9b1;font-size:22px}`;
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="150"><rect width="220" height="150" fill="#c9b79c"/><rect y="40" width="220" height="18" fill="#a8927a"/><rect y="90" width="220" height="12" fill="#8c7760"/><circle cx="60" cy="120" r="14" fill="#6d5c48"/><circle cx="170" cy="30" r="10" fill="#e3d6c1"/></svg>`;

// Fake chrome.runtime for the page side: screenshots via Playwright, and an
// in-memory "hiders on this page" registry mirroring background.js.
const RUNTIME_STUB = `
  window.__pages = window.__pages || {};
  window.__sent = [];
  const key = (u) => { const x = new URL(u); return x.origin + x.pathname + x.search; };
  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    onMessage: { addListener(fn) { window.__hspListener = fn; } },
    sendMessage: async (m) => {
      window.__sent.push(m);
      if (!m) return { ok: true };
      if (m.type === 'HSP_CAPTURE') return { ok: true, screenshot: await window.__pwCapture() };
      if (m.type === 'HSP_STORE_HIDE') {
        const k = key(m.entry.url); const p = window.__pages[k] || (window.__pages[k] = { url: m.entry.url, slabs: [] });
        if (!p.slabs.some((s) => s.id === m.entry.slab.id)) p.slabs.push({ ...m.entry.slab, vw: m.entry.vw, vh: m.entry.vh, wobble: m.entry.wobble });
        return { ok: true, id: m.entry.slab.id, count: p.slabs.length };
      }
      if (m.type === 'HSP_GET_PAGE') return { ok: true, page: window.__pages[key(m.url)] || { url: m.url, slabs: [] } };
      if (m.type === 'HSP_REMOVE_HIDES') { const p = window.__pages[key(m.url)]; if (p) p.slabs = p.slabs.filter((s) => !m.ids.includes(s.id)); return { ok: true, count: p ? p.slabs.length : 0 }; }
      return { ok: true };
    },
  };
`;

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/strict.css')) { res.setHeader('content-type', 'text/css'); return res.end(STRICT_CSS); }
    if (req.url.startsWith('/photo.svg')) { res.setHeader('content-type', 'image/svg+xml'); return res.end(PHOTO); }
    if (req.url.startsWith('/strict')) {
      res.setHeader('content-type', 'text/html');
      res.setHeader('content-security-policy', STRICT_CSP);
      return res.end(STRICT_PAGE);
    }
    res.setHeader('content-type', 'text/html');
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/arena`;

  const userDataDir = path.join(OUT, 'profile');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  const failures = [];
  const step = async (name, fn) => {
    try { await fn(); console.log('ok  -', name); }
    catch (e) { failures.push(name); console.log('FAIL-', name, '\n     ', e.stack || e); }
  };

  // ---- service worker + popup wiring ----
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  await step('service worker boots and exposes handlers', async () => {
    const r = await sw.evaluate(() => typeof startGame === 'function' && typeof recordStats === 'function');
    assert.equal(r, true);
    const stats = await sw.evaluate(async () => { await recordStats({ rounds: 1, found: 2, camo: 77, soloScore: 300 }); return (await chrome.storage.local.get('stats')).stats; });
    assert.equal(stats.roundsPlayed, 1); assert.equal(stats.slabsFound, 2); assert.equal(stats.bestCamo, 77); assert.equal(stats.soloBestScore, 300);
    // Page registry + badge live in the worker.
    const reg = await sw.evaluate(async () => {
      const img = 'data:image/png;base64,iVBORw0KGgo=';
      const a = await storeHide({ url: 'https://example.com/a?x=1#h', vw: 1000, vh: 800, wobble: 'normal', slab: { id: 'one', x: 1, y: 2, w: 30, h: 30, shape: 'rect', camo: 50, img } });
      const dup = await storeHide({ url: 'https://example.com/a?x=1', vw: 1000, vh: 800, slab: { id: 'one', x: 1, y: 2, w: 30, h: 30, shape: 'rect', camo: 50, img } });
      const b = await storeHide({ url: 'https://example.com/a?x=1', vw: 1000, vh: 800, slab: { x: 5, y: 5, w: 30, h: 30, shape: 'round', camo: 10, img } });
      const other = await getPage('https://example.com/b');
      const [tab] = await chrome.tabs.query({});
      await refreshBadge(tab.id, 'https://example.com/a?x=1');
      const badge = await chrome.action.getBadgeText({ tabId: tab.id });
      const removed = await removeHides('https://example.com/a?x=1', ['one']);
      await refreshBadge(tab.id, 'https://example.com/a?x=1');
      const badge2 = await chrome.action.getBadgeText({ tabId: tab.id });
      let bad = null; try { await storeHide({ url: 'https://x', slab: { img: 'javascript:1' } }); } catch (e) { bad = e.message; }
      return { a: a.count, dup: dup.count, b: b.count, other: other.slabs.length, badge, removed: removed.count, badge2, bad };
    });
    assert.deepEqual(reg, { a: 1, dup: 1, b: 2, other: 0, badge: '2', removed: 1, badge2: '1', bad: 'Bad hide entry' });
  });

  const popup = await context.newPage();
  await step('popup renders modes, settings and stats', async () => {
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    assert.equal(await popup.locator('.mode').count(), 5);
    await popup.waitForFunction(() => document.querySelector('#pageCount').textContent !== '…');
    assert.equal(await popup.locator('#pageCount').textContent(), '–', 'the popup tab itself is not a playable page');
    assert.equal(await popup.locator('#seekPage').isDisabled(), true);
    await popup.waitForFunction(() => document.querySelector('#stRounds').textContent === '1');
    assert.equal(await popup.locator('#stCamo').textContent(), '77%');
    await popup.selectOption('#difficulty', 'hard');
    await popup.selectOption('#sound', 'off');
    const saved = await popup.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    assert.equal(saved.difficulty, 'hard');
    assert.equal(saved.sound, false);
    assert.equal(saved.hiders, 1);
    await popup.reload();
    assert.equal(await popup.inputValue('#sound'), 'off', 'sound setting restored');
    await popup.screenshot({ path: path.join(OUT, 'popup.png') });
  });
  await step('popup launch reaches the worker and reports uncapturable pages', async () => {
    // The only "active" tab here is the popup page itself, which cannot be captured.
    await popup.bringToFront();
    await popup.click('.mode[data-mode="solo"]');
    await popup.waitForFunction(() => /Could not start/.test(document.querySelector('#status').textContent), null, { timeout: 8000 });
    const txt = await popup.locator('#status').textContent();
    assert.match(txt, /cannot be captured/);
  });
  await popup.close();

  // ---- in-page game with stubbed runtime ----
  const page = await context.newPage();
  await page.goto(url);
  await page.exposeFunction('__pwCapture', async () => 'data:image/png;base64,' + (await page.screenshot({ type: 'png' })).toString('base64'));
  await page.evaluate(RUNTIME_STUB);
  await page.addScriptTag({ path: path.join(ROOT, 'content/lib.js') });
  await page.addScriptTag({ path: path.join(ROOT, 'content/game.js') });

  const start = async (mode, settings) => {
    await page.evaluate(() => window.__hspListener({ type: 'HSP_HIDE' }, {}, () => {}));
    await page.waitForTimeout(100);
    const screenshot = 'data:image/png;base64,' + (await page.screenshot({ type: 'png' })).toString('base64');
    await page.evaluate(({ mode, settings, screenshot }) => window.__hspListener({ type: 'HSP_START', mode, settings, screenshot }, {}, () => {}), { mode, settings, screenshot });
    await page.waitForFunction(() => window.__HSP__.game && window.__HSP__.game.ctx && !window.__HSP__.game.modalWrap.hidden);
  };
  const g = (fn, arg) => page.evaluate(fn, arg);
  const sh = () => page.locator('#hsp-host');
  const clickBtn = async (text) => {
    const btn = sh().locator('button', { hasText: text }).first();
    await btn.click();
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  await step('solo: generates slabs, misses cost time, finding all wins the round', async () => {
    await start('solo', { difficulty: 'easy', seekTime: 45, guesses: 3, hideTime: 0 });
    assert.equal(await g(() => window.__HSP__.game.S), 2, 'device scale factor picked up');
    const hardening = await g(() => { const h = document.querySelector('#hsp-host'); return { sheets: h.shadowRoot.adoptedStyleSheets.length, styleEls: h.shadowRoot.querySelectorAll('style').length, popover: h.matches(':popover-open') }; });
    assert.deepEqual(hardening, { sheets: 1, styleEls: 0, popover: true }, 'constructed stylesheet + top-layer popover');
    const text = await sh().locator('.modal').textContent();
    assert.match(text, /Round 1/);
    await clickBtn('Start round');
    const slabs = await g(() => window.__HSP__.game.slabs.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, shape: s.shape })));
    assert.equal(slabs.length, 3);
    for (const s of slabs) assert.ok(s.y >= 60 && s.x >= 0 && s.x + s.w <= 1280 && s.y + s.h <= 800);
    const busy = await g(() => window.__HSP__.game.slabs.map((s) => s.busy));
    const thr = await g(() => window.HSP.FLAT_THRESHOLD);
    for (const b of busy) assert.ok(b >= thr, `chameleon placed on a busy spot (${b.toFixed(3)})`);
    await shot('solo-hidden.png');
    const timeBefore = await g(() => window.__HSP__.game.timeLeft());
    // Miss on the HUD (ignored) and on an empty spot (penalised).
    await page.mouse.click(640, 30);
    const empty = await g((slabs) => {
      for (let y = 100; y < 780; y += 7) for (let x = 5; x < 1275; x += 7) {
        if (!slabs.some((s) => x >= s.x - 4 && x <= s.x + s.w + 4 && y >= s.y - 4 && y <= s.y + s.h + 4)) return { x, y };
      }
      return null;
    }, slabs);
    assert.ok(empty, 'found an empty spot');
    await page.mouse.click(empty.x, empty.y);
    const state = await g(() => ({ misses: window.__HSP__.game.guessesUsed, markers: window.__HSP__.game.markers.length, left: window.__HSP__.game.timeLeft() }));
    assert.equal(state.misses, 1); assert.equal(state.markers, 1);
    assert.ok(state.left < timeBefore - 2500, 'miss penalty applied');
    for (const s of slabs) await page.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    assert.match(await sh().locator('.modal').textContent(), /All found/);
    assert.ok((await g(() => window.__HSP__.game.soloScore)) > 300);
    await shot('solo-result.png');
    await clickBtn('Next round, new snapshot');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'brief' && window.__HSP__.game.round === 2);
    await clickBtn('Start round');
    assert.equal(await g(() => window.__HSP__.game.slabs.length), 4);
    await clickBtn('Give up');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    assert.match(await sh().locator('.modal').textContent(), /Round lost/);
  });

  await step('hotseat: paint with brush/eyedropper/stamp, camo score, hide, seek, find', async () => {
    await start('hotseat', { difficulty: 'normal', seekTime: 45, guesses: 3, hideTime: 90 });
    await sh().locator('.choice', { hasText: 'Splat' }).click();
    await clickBtn('Start painting');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'paint');
    const s0 = await g(() => { const s = window.__HSP__.game.slabs[0]; return { x: s.x, y: s.y, w: s.w, h: s.h, camo: s.camo }; });
    // Drag the slab onto the striped card with Shift.
    await page.keyboard.down('Shift');
    await page.mouse.move(s0.x + s0.w / 2, s0.y + s0.h / 2);
    await page.mouse.down();
    await page.mouse.move(600, 260, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const s1 = await g(() => { const s = window.__HSP__.game.slabs[0]; return { x: s.x, y: s.y, w: s.w, h: s.h }; });
    assert.notEqual(s1.x, s0.x, 'slab moved');
    // Pick a colour from the page with the eyedropper.
    await page.keyboard.press('e');
    await page.mouse.click(1097, 195); // centre of the solid "Violet" card
    const picked = await g(() => window.__HSP__.game.color);
    assert.equal(picked, '#8338ec');
    // Brush a stroke across the slab.
    await page.keyboard.press('b');
    const cx = s1.x + s1.w / 2, cy = s1.y + s1.h / 2;
    await page.mouse.move(s1.x + 5, cy); await page.mouse.down(); await page.mouse.move(s1.x + s1.w - 5, cy, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(250);
    const afterBrush = await g(() => window.__HSP__.game.slabs[0].camo);
    assert.ok(typeof afterBrush === 'number');
    // Stamp is unlimited by default: the meter is hidden and ink never runs out.
    await page.keyboard.press('s');
    await page.mouse.move(cx - 20, cy - 20); await page.mouse.down(); await page.mouse.move(cx + 20, cy + 20, { steps: 6 }); await page.mouse.up();
    const ink = await g(() => { const s = window.__HSP__.game.slabs[0]; return { unlimited: s.inkMax === Infinity && s.ink === Infinity, meterHidden: document.querySelector('#hsp-host').shadowRoot.querySelector('.ink').hidden }; });
    assert.deepEqual(ink, { unlimited: true, meterHidden: true }, 'unlimited ink by default, meter hidden');
    // Preview toggle animates the active slab while painting.
    await clickBtn('Preview');
    assert.ok(await g(() => window.__HSP__.game.previewWobble && window.__HSP__.game.fxRaf > 0), 'preview wobble running');
    await clickBtn('Preview');
    assert.equal(await g(() => window.__HSP__.game.previewWobble), false);
    // Fill with the picked colour then undo restores previous pixels.
    await g(() => window.__HSP__.game.setColor('#00ff00', true));
    await page.keyboard.press('f');
    await page.mouse.click(cx, cy);
    const centrePx = () => g(() => { const s = window.__HSP__.game.slabs[0]; return Array.from(s.ctx.getImageData(s.canvas.width >> 1, s.canvas.height >> 1, 1, 1).data); });
    assert.deepEqual(await centrePx(), [0, 255, 0, 255], 'fill painted the centre green');
    await page.keyboard.press('Control+z');
    assert.notDeepEqual(await centrePx(), [0, 255, 0, 255], 'undo restored the previous pixels');
    assert.equal(await g(() => window.__HSP__.game.recent.length), 2, 'recent swatches recorded');
    // Stamp the entire slab for a near-perfect camo (ink allows 30%), then check score improves with fill of sampled colour.
    await page.keyboard.press('e');
    await page.mouse.click(cx, cy);
    await page.keyboard.press('f');
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(250);
    await shot('hotseat-paint.png');
    await clickBtn('Hide it!');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'handoff');
    const camo = await g(() => window.__HSP__.game.hiderScore);
    assert.ok(camo >= 0 && camo <= 100);
    assert.match(await sh().locator('.modal').textContent(), /Pass the device/);
    await clickBtn('I am the seeker');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'seek');
    assert.equal(await g(() => window.__HSP__.game.slabs[0].flat), false, 'stripes are a busy spot');
    assert.equal(await g(() => window.__HSP__.game.hintCircle), null, 'no free hint on a busy spot');
    // The hidden slab idles in 3D: the animation loop runs and the board changes over time.
    assert.equal(await g(() => window.__HSP__.game.wobbleAmp), 12);
    assert.ok(await g(() => window.__HSP__.game.fxRaf > 0), 'wobble animation loop is running');
    // Background tabs get their animation frames throttled, so drive the renderer directly at two moments
    // and compare the whole block around the slab in-page (the tilt shows on different edges over time).
    await page.bringToFront();
    await g(() => { const gm = window.__HSP__.game, s = gm.slabs[0], S = gm.S; gm.render(); window.__p1 = gm.ctx.getImageData(Math.round((s.x - 12) * S), Math.round((s.y - 12) * S), Math.round((s.w + 24) * S), Math.round((s.h + 24) * S)).data; });
    let changed = 0;
    for (let i = 0; i < 8 && changed < 50; i++) {
      await page.waitForTimeout(300);
      changed = await g(() => { const gm = window.__HSP__.game, s = gm.slabs[0], S = gm.S; gm.render(); const d = gm.ctx.getImageData(Math.round((s.x - 12) * S), Math.round((s.y - 12) * S), Math.round((s.w + 24) * S), Math.round((s.h + 24) * S)).data; let n = 0; for (let k = 0; k < d.length; k++) if (d[k] !== window.__p1[k]) n++; return n; });
    }
    assert.ok(changed >= 50, `slab pixels change while it wobbles (${changed} changed)`);
    await shot('hotseat-seek.png');
    await page.mouse.click(100, 700); // miss
    assert.equal(await g(() => window.__HSP__.game.guessesUsed), 1);
    assert.equal(await sh().locator('.stat b').nth(1).textContent(), '2');
    await clickBtn('Hint');
    assert.ok(await g(() => Boolean(window.__HSP__.game.hintCircle)));
    await page.mouse.click(cx, cy); // hit (path-based hit test at DPR 2)
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    const txt = await sh().locator('.modal').textContent();
    assert.match(txt, /Found!/);
    assert.match(txt, /Hider camo/);
    await shot('hotseat-result.png');
    await clickBtn('Swap roles');
    await page.waitForFunction(() => window.__HSP__.game.round === 2 && window.__HSP__.game.phase === 'brief');
  });

  await step('limited stamp ink is consumed and the meter shows', async () => {
    await start('hotseat', { difficulty: 'normal', seekTime: 45, guesses: 3, hideTime: 0, stampInk: '30', wobble: 'still', sound: false });
    await clickBtn('Start painting');
    const s = await g(() => { const s = window.__HSP__.game.active; return { x: s.x, y: s.y, w: s.w, h: s.h, ink: s.ink, max: s.inkMax }; });
    assert.equal(s.max, Math.round(s.w * s.h * 0.3));
    await page.keyboard.press('s');
    await page.mouse.move(s.x + 10, s.y + 10); await page.mouse.down(); await page.mouse.move(s.x + s.w - 10, s.y + s.h - 10, { steps: 10 }); await page.mouse.up();
    const after = await g(() => window.__HSP__.game.active.ink);
    assert.ok(after < s.ink, 'stamp consumed ink');
    await clickBtn('Hide it!');
    await clickBtn('I am the seeker');
    assert.equal(await g(() => window.__HSP__.game.wobbleAmp), 0, 'still setting disables wobble');
    assert.equal(await g(() => window.__HSP__.game.fxRaf), 0, 'no animation loop when still');
  });

  await step('hotseat with 2 hiders: overlap is refused, seeker must find both, per-hider results', async () => {
    await start('hotseat', { difficulty: 'normal', seekTime: 45, guesses: 0, hideTime: 0, hiders: 2, sound: false });
    assert.match(await sh().locator('.modal').textContent(), /Hider 1 of 2/);
    await clickBtn('Start painting');
    await clickBtn('Hide it!');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'handoff');
    assert.match(await sh().locator('.modal').textContent(), /Pass the device to hider 2/);
    await clickBtn('I am hider 2');
    assert.match(await sh().locator('.modal').textContent(), /Hider 2 of 2/);
    await clickBtn('Start painting');
    assert.equal(await g(() => window.__HSP__.game.slabs.length), 2);
    // Second slab spawns on top of the first: hiding must be refused.
    await clickBtn('Hide it!');
    assert.equal(await g(() => window.__HSP__.game.phase), 'paint', 'overlap refused');
    const s = await g(() => { const s = window.__HSP__.game.active; return { x: s.x, y: s.y, w: s.w, h: s.h }; });
    await page.keyboard.down('Shift');
    await page.mouse.move(s.x + s.w / 2, s.y + s.h / 2); await page.mouse.down(); await page.mouse.move(300, 650, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    await clickBtn('Hide it!');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'handoff');
    assert.match(await sh().locator('.modal').textContent(), /Pass the device to the seeker/);
    await clickBtn('I am the seeker');
    const slabs = await g(() => window.__HSP__.game.slabs.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })));
    await page.mouse.click(slabs[1].x + slabs[1].w / 2, slabs[1].y + slabs[1].h / 2);
    assert.equal(await g(() => window.__HSP__.game.phase), 'seek', 'one of two found keeps seeking');
    assert.equal(await sh().locator('.stat b').nth(2).textContent(), '1/2');
    await page.mouse.click(slabs[0].x + slabs[0].w / 2, slabs[0].y + slabs[0].h / 2);
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    const txt = await sh().locator('.modal').textContent();
    assert.match(txt, /All found/);
    assert.match(txt, /Hider 1 · camo/);
    assert.match(txt, /Hider 2 · camo/);
    await shot('hotseat-two-hiders.png');
  });

  await step('hotseat: hiding on a flat area gives the seeker a free hint; out of guesses reveals the slab', async () => {
    await start('hotseat', { difficulty: 'normal', seekTime: 45, guesses: 1, hideTime: 0 });
    await clickBtn('Start painting');
    const s0 = await g(() => { const s = window.__HSP__.game.active; return { x: s.x, y: s.y, w: s.w, h: s.h }; });
    await page.keyboard.down('Shift');
    await page.mouse.move(s0.x + s0.w / 2, s0.y + s0.h / 2); await page.mouse.down(); await page.mouse.move(640, 745, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(250);
    assert.equal(await sh().locator('.stat b').nth(2).textContent(), 'flat ⚠', 'HUD warns about the flat spot');
    await clickBtn('Hide it!');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'handoff');
    assert.equal(await g(() => window.__HSP__.game.slabs[0].flat), true);
    assert.match(await sh().locator('.modal').textContent(), /flat area/);
    await clickBtn('I am the seeker');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'seek');
    const hint = await g(() => window.__HSP__.game.hintCircle);
    const sl = await g(() => { const s = window.__HSP__.game.slabs[0]; return { cx: s.x + s.w / 2, cy: s.y + s.h / 2 }; });
    assert.ok(hint && Math.hypot(hint.x - sl.cx, hint.y - sl.cy) < hint.r, 'free hint circle covers the flat slab');
    await shot('flat-hint.png');
    await page.mouse.click(30, 780);
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    assert.match(await sh().locator('.modal').textContent(), /Not found/);
  });

  let code;
  await step('hide-share: produces a decodable code', async () => {
    await start('hide-share', { difficulty: 'normal', seekTime: 30, guesses: 5, hideTime: 0 });
    await sh().locator('.choice', { hasText: 'Ghost' }).click();
    await clickBtn('Start painting');
    await page.keyboard.press('b');
    const s = await g(() => { const s = window.__HSP__.game.slabs[0]; return { x: s.x, y: s.y, w: s.w, h: s.h }; });
    await page.mouse.move(s.x + 10, s.y + 20); await page.mouse.down(); await page.mouse.move(s.x + s.w - 10, s.y + s.h - 20, { steps: 6 }); await page.mouse.up();
    await clickBtn('Hide it!');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'share');
    code = await sh().locator('textarea.code').inputValue();
    assert.ok(code.startsWith('HSP1.'));
    const level = await g((c) => window.HSP.decodeShareCode(c), code);
    assert.equal(level.slabs.length, 1);
    assert.equal(level.slabs[0].shape, 'ghost');
    assert.equal(level.seekTime, 30);
    assert.equal(level.wobble, 'normal');
    await shot('share.png');
  });

  await step('seek-code: rejects garbage, accepts the code, slab is findable', async () => {
    await start('seek-code', { difficulty: 'normal', seekTime: 45, guesses: 3, hideTime: 0 });
    await sh().locator('textarea.code').fill('garbage');
    await clickBtn('Start seeking');
    await page.waitForFunction(() => /Not a Hide/.test(document.querySelector('#hsp-host').shadowRoot.querySelector('.modal').textContent));
    await sh().locator('textarea.code').fill(code);
    await clickBtn('Start seeking');
    await page.waitForFunction(() => /Ready to seek/.test(document.querySelector('#hsp-host').shadowRoot.querySelector('.modal').textContent));
    assert.equal(await g(() => window.__HSP__.game.settings.seekTime), 30, 'seek time taken from the code');
    await clickBtn('Go!');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'seek');
    const s = await g(() => { const s = window.__HSP__.game.slabs[0]; return { x: s.x, y: s.y, w: s.w, h: s.h }; });
    await page.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    assert.match(await sh().locator('.modal').textContent(), /Found!/);
  });

  await step('hiders on this page: shared and pasted slabs are kept, seek-page hunts them, found ones can be removed', async () => {
    const pages = await g(() => JSON.parse(JSON.stringify(window.__pages)));
    const keys = Object.keys(pages);
    assert.equal(keys.length, 1, 'one page in the registry');
    assert.equal(pages[keys[0]].slabs.length, 1, 'share + paste of the same code stored once');
    assert.ok(await g(() => window.__sent.some((m) => m.type === 'HSP_STORE_HIDE')));
    await start('seek-page', { seekTime: 30, guesses: 3, hideTime: 0, sound: false });
    await page.waitForFunction(() => /1 hider on this page/.test(document.querySelector('#hsp-host').shadowRoot.querySelector('.modal').textContent));
    await clickBtn('Go!');
    await page.waitForFunction(() => window.__HSP__.game.phase === 'seek');
    const s = await g(() => { const s = window.__HSP__.game.slabs[0]; return { x: s.x, y: s.y, w: s.w, h: s.h, id: s.id }; });
    assert.ok(s.id, 'slab carries its registry id');
    await page.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    await clickBtn('Remove the 1 found');
    await page.waitForFunction(() => /Nobody is hiding here yet/.test(document.querySelector('#hsp-host').shadowRoot.querySelector('.modal').textContent));
    assert.equal(await g(() => Object.keys(window.__pages).every((k) => window.__pages[k].slabs.length === 0)), true);
    await clickBtn('Hide one now');
    assert.match(await sh().locator('.modal').textContent(), /Hide & Share/);
  });

  await step('phone viewport: wrapping HUD, thumb controls, long-press lens, shake, look-around, tap to find', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await start('solo', { difficulty: 'easy', sound: false });
    assert.equal(await g(() => window.__HSP__.game.vw), 390);
    await clickBtn('Start round');
    const hud = await sh().locator('.hud').boundingBox();
    assert.ok(hud.width <= 390 && hud.height >= 60, `HUD fits the phone (${hud.width}x${hud.height})`);
    const hudH = await g(() => window.__HSP__.game.hudH());
    assert.ok(hudH >= hud.height - 1, 'game uses the real HUD height');
    for (const b of await sh().locator('.hud .btn').all()) {
      const box = await b.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.height >= 36, 'HUD buttons are on-screen and thumb-sized');
    }
    const slabs = await g(() => window.__HSP__.game.slabs.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })));
    assert.equal(slabs.length, 3);
    for (const s of slabs) assert.ok(s.y >= hudH && s.x + s.w <= 390 && s.y + s.h <= 844, 'slabs fit the phone below the HUD');
    // Long-press on an empty spot opens the lens and does not count as a guess.
    const empty = await g((slabs) => { for (let y = 200; y < 830; y += 6) for (let x = 6; x < 384; x += 6) { if (!slabs.some((s) => x >= s.x - 6 && x <= s.x + s.w + 6 && y >= s.y - 6 && y <= s.y + s.h + 6)) return { x, y }; } return null; }, slabs);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.waitForTimeout(450);
    assert.ok(await g(() => Boolean(window.__HSP__.game.lens)), 'lens appears on hold');
    await page.mouse.move(empty.x + 20, empty.y + 10, { steps: 4 });
    await page.mouse.up();
    assert.equal(await g(() => window.__HSP__.game.guessesUsed), 0, 'a hold is not a guess');
    assert.equal(await g(() => window.__HSP__.game.lens), null, 'lens hides on release');
    await page.mouse.move(385, 820);
    const look = await g(() => window.__HSP__.game.look);
    assert.ok(look.dx > 0.9 && look.dy > 0.9, 'look-around follows the pointer');
    const before = await g(() => window.__HSP__.game.timeLeft());
    await clickBtn('Shake');
    const after = await g(() => ({ left: window.__HSP__.game.timeLeft(), shaking: window.__HSP__.game.shakeUntil > performance.now() }));
    assert.ok(after.shaking && after.left < before - 4500, 'shake jolts and costs 5s');
    await shot('phone-seek.png');
    for (const s of slabs) await page.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
    await page.waitForFunction(() => window.__HSP__.game.phase === 'result');
    assert.match(await sh().locator('.modal').textContent(), /All found/);
    await shot('phone-result.png');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
  });

  await step('strict-CSP flat page: overlay renders, chameleons avoid empty margins, painting works', async () => {
    const strict = await context.newPage();
    const cspViolations = [];
    strict.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
    await strict.goto(url.replace('/arena', '/strict'));
    // Sanity: the CSP really is enforced on this page.
    await strict.evaluate(() => { const st = document.createElement('style'); st.textContent = 'body{outline:1px solid red}'; document.head.append(st); });
    await strict.waitForTimeout(100);
    assert.ok(cspViolations.length > 0, 'the test page enforces its CSP');
    cspViolations.length = 0;
    await strict.exposeFunction('__pwCapture', async () => 'data:image/png;base64,' + (await strict.screenshot({ type: 'png' })).toString('base64'));
    await strict.evaluate(RUNTIME_STUB);
    // <script> tags are blocked by script-src 'none'; content scripts are not, so mimic them with evaluate().
    await strict.evaluate(fs.readFileSync(path.join(ROOT, 'content/lib.js'), 'utf8'));
    await strict.evaluate(fs.readFileSync(path.join(ROOT, 'content/game.js'), 'utf8'));
    const screenshot = 'data:image/png;base64,' + (await strict.screenshot({ type: 'png' })).toString('base64');
    await strict.evaluate(({ screenshot }) => window.__hspListener({ type: 'HSP_START', mode: 'solo', settings: { difficulty: 'normal', sound: false }, screenshot }, {}, () => {}), { screenshot });
    await strict.waitForFunction(() => window.__HSP__.game && window.__HSP__.game.ctx && !window.__HSP__.game.modalWrap.hidden);
    const shost = strict.locator('#hsp-host');
    const hudBox = await shost.locator('.hud').boundingBox();
    assert.ok(hudBox && hudBox.height > 40 && hudBox.width > 1000, 'HUD is styled despite style-src CSP');
    await shost.locator('button', { hasText: 'Start round' }).click();
    const slabs = await strict.evaluate(() => window.__HSP__.game.slabs.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, busy: s.busy })));
    assert.equal(slabs.length, 3);
    const thr = await strict.evaluate(() => window.HSP.FLAT_THRESHOLD);
    for (const s of slabs) assert.ok(s.busy >= thr, `slab avoided the empty margins (busy ${s.busy.toFixed(3)} at ${s.x},${s.y})`);
    await strict.screenshot({ path: path.join(OUT, 'strict-wiki-solo.png') });
    for (const s of slabs) await strict.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
    await strict.waitForFunction(() => window.__HSP__.game.phase === 'result');
    // Recapture path (blob decode) and a paint round on the same strict page.
    await shost.locator('button', { hasText: 'Next round, new snapshot' }).click();
    await strict.waitForFunction(() => window.__HSP__.game.phase === 'brief' && window.__HSP__.game.round === 2);
    await strict.evaluate(() => window.__hspListener({ type: 'HSP_HIDE' }, {}, () => {}));
    const shot2 = 'data:image/png;base64,' + (await strict.screenshot({ type: 'png' })).toString('base64');
    await strict.evaluate(({ screenshot }) => window.__hspListener({ type: 'HSP_START', mode: 'hotseat', settings: { seekTime: 30, guesses: 3, hideTime: 0, sound: false }, screenshot }, {}, () => {}), { screenshot: shot2 });
    await strict.waitForFunction(() => window.__HSP__.game && window.__HSP__.game.ctx && !window.__HSP__.game.modalWrap.hidden);
    await shost.locator('button', { hasText: 'Start painting' }).click();
    await strict.keyboard.press('e');
    await strict.mouse.click(90, 400); // sidebar background #f8f9fa
    assert.equal(await strict.evaluate(() => window.__HSP__.game.color), '#f8f9fa');
    await strict.keyboard.press('f');
    const a = await strict.evaluate(() => { const s = window.__HSP__.game.active; return { x: s.x, y: s.y, w: s.w, h: s.h }; });
    await strict.mouse.click(a.x + a.w / 2, a.y + a.h / 2);
    await strict.waitForTimeout(250);
    const swatch = await shost.locator('.swatch').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.equal(swatch, 'rgb(248, 249, 250)', 'swatch colour set via CSSOM survives CSP');
    assert.deepEqual(cspViolations, [], 'the game triggered no CSP violations');
    await strict.screenshot({ path: path.join(OUT, 'strict-wiki-paint.png') });
    await strict.close();
  });

  await step('escape asks before quitting; leaving removes the overlay', async () => {
    await clickBtn('Look at the page');
    await page.keyboard.press('Escape');
    assert.match(await sh().locator('.modal').textContent(), /Leave the game/);
    await clickBtn('Keep playing');
    await page.keyboard.press('Escape');
    await clickBtn('Leave');
    assert.equal(await page.locator('#hsp-host').count(), 0);
    assert.equal(await g(() => window.__HSP__.game), null);
  });

  await context.close();
  server.close();
  if (failures.length) { console.log(`\n${failures.length} step(s) failed`); process.exit(1); }
  console.log('\nall smoke steps passed; screenshots in', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
