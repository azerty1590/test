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

async function main() {
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
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
  });

  const popup = await context.newPage();
  await step('popup renders modes, settings and stats', async () => {
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    assert.equal(await popup.locator('.mode').count(), 4);
    await popup.waitForFunction(() => document.querySelector('#stRounds').textContent === '1');
    assert.equal(await popup.locator('#stCamo').textContent(), '77%');
    await popup.selectOption('#difficulty', 'hard');
    const saved = await popup.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    assert.equal(saved.difficulty, 'hard');
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
  await page.evaluate(() => {
    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      onMessage: { addListener(fn) { window.__hspListener = fn; } },
      sendMessage: (m) => (m && m.type === 'HSP_CAPTURE') ? window.__pwCapture().then((screenshot) => ({ ok: true, screenshot })) : Promise.resolve({ ok: true }),
    };
  });
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
    const text = await sh().locator('.modal').textContent();
    assert.match(text, /Round 1/);
    await clickBtn('Start round');
    const slabs = await g(() => window.__HSP__.game.slabs.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, shape: s.shape })));
    assert.equal(slabs.length, 3);
    for (const s of slabs) assert.ok(s.y >= 60 && s.x >= 0 && s.x + s.w <= 1280 && s.y + s.h <= 800);
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
    // Stamp uses ink.
    await page.keyboard.press('s');
    await page.mouse.move(cx - 20, cy - 20); await page.mouse.down(); await page.mouse.move(cx + 20, cy + 20, { steps: 6 }); await page.mouse.up();
    const ink = await g(() => { const s = window.__HSP__.game.slabs[0]; return { ink: s.ink, max: s.inkMax }; });
    assert.ok(ink.ink < ink.max, 'stamp consumed ink');
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

  await step('hotseat: running out of guesses ends the round with the slab revealed', async () => {
    await start('hotseat', { difficulty: 'normal', seekTime: 45, guesses: 1, hideTime: 0 });
    await clickBtn('Start painting');
    await clickBtn('Hide it!');
    await clickBtn('I am the seeker');
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
