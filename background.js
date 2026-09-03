// Background service worker: injects the game into the active tab, takes
// viewport screenshots on request, keeps the per-page registry of hidden
// slabs and shows their count on the toolbar badge. Nothing leaves the browser.

importScripts('content/lib.js');

const GAME_FILES = ['content/lib.js', 'content/game.js'];
const MAX_SLABS_PER_PAGE = 12;
const MAX_PAGES = 40;

// ---- "hiders on this page" registry ----
async function getPages() {
  const { pages = {} } = await chrome.storage.local.get('pages');
  return pages;
}

async function getPage(url) {
  const pages = await getPages();
  return pages[HSP.pageKey(url)] || { url, slabs: [] };
}

async function storeHide(entry) {
  const okImg = entry && entry.slab && typeof entry.slab.img === 'string' && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(entry.slab.img);
  if (!entry || !entry.url || !okImg || !/^https?:/i.test(entry.url)) throw new Error('Bad hide entry');
  const key = HSP.pageKey(entry.url);
  const pages = await getPages();
  const page = pages[key] || { url: entry.url, slabs: [] };
  const id = String(entry.slab.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
  if (!page.slabs.some((s) => s.id === id)) {
    page.slabs.push({
      id,
      x: entry.slab.x, y: entry.slab.y, w: entry.slab.w, h: entry.slab.h,
      shape: entry.slab.shape, camo: entry.slab.camo, img: entry.slab.img,
      vw: entry.vw, vh: entry.vh, wobble: entry.wobble, t: Date.now(),
    });
    page.slabs = page.slabs.slice(-MAX_SLABS_PER_PAGE);
  }
  page.url = entry.url;
  page.t = Date.now();
  pages[key] = page;
  const keys = Object.keys(pages);
  if (keys.length > MAX_PAGES) {
    keys.sort((a, b) => (pages[a].t || 0) - (pages[b].t || 0));
    for (const k of keys.slice(0, keys.length - MAX_PAGES)) delete pages[k];
  }
  await chrome.storage.local.set({ pages });
  return { id, count: page.slabs.length };
}

async function removeHides(url, ids) {
  const key = HSP.pageKey(url);
  const pages = await getPages();
  const page = pages[key];
  if (!page) return { count: 0 };
  const drop = new Set((ids || []).map(String));
  page.slabs = page.slabs.filter((s) => !drop.has(String(s.id)));
  if (page.slabs.length) pages[key] = page; else delete pages[key];
  await chrome.storage.local.set({ pages });
  return { count: page.slabs.length };
}

// ---- toolbar badge ----
async function refreshBadge(tabId, url) {
  if (tabId == null) return;
  let count = 0;
  if (url && /^https?:/i.test(url)) count = (await getPage(url)).slabs.length;
  // A share link in the address bar outranks the count: someone is hiding in it.
  const hasLink = Boolean(url && HSP.parseShareLink(url));
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: hasLink ? '#ff8bd1' : '#7cf2a7' });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#0c1a12' });
    await chrome.action.setBadgeText({ tabId, text: hasLink ? '!' : count ? String(count) : '' });
  } catch { /* tab may be gone */ }
}

// With the optional "tabs" permission granted these carry the URL, so the
// badge follows the user from page to page. Without it, tab.url is undefined
// and the badge is only refreshed when the popup opens or a game runs.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => { if (tab && tab.url) refreshBadge(tabId, tab.url); }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if ((info.status === 'complete' || info.url) && tab && tab.url) refreshBadge(tabId, tab.url);
});

function captureTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      if (err || !dataUrl) reject(new Error(err ? err.message : 'Capture failed'));
      else resolve(dataUrl);
    });
  });
}

async function isGameLoaded(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__HSP_LOADED__),
    });
    return Boolean(res && res.result);
  } catch {
    return false;
  }
}

async function startGame(tab, payload) {
  if (!tab || tab.id == null) throw new Error('No active tab');
  const url = tab.url || '';
  if (/^(chrome|chrome-extension|edge|about|devtools):/i.test(url) || /chrome\.google\.com\/webstore|chromewebstore\.google\.com/i.test(url)) {
    throw new Error('This page cannot be captured by extensions. Try any regular website.');
  }
  try {
    if (await isGameLoaded(tab.id)) {
      // Tear down a running game so its overlay is not baked into the new snapshot.
      await chrome.tabs.sendMessage(tab.id, { type: 'HSP_HIDE' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 150));
    } else {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: GAME_FILES });
    }
  } catch (e) {
    if (/Cannot access|must request permission|Extension manifest/i.test(e.message)) {
      throw new Error('This page cannot be captured by extensions. Try any regular website.');
    }
    throw e;
  }
  const screenshot = await captureTab(tab.windowId);
  await chrome.tabs.sendMessage(tab.id, { type: 'HSP_START', screenshot, ...payload });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'HSP_LAUNCH') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => startGame(tab, msg.payload || {}))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'HSP_CAPTURE') {
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    captureTab(windowId)
      .then((screenshot) => sendResponse({ ok: true, screenshot }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'HSP_STORE_HIDE') {
    storeHide(msg.entry)
      .then(async (r) => { if (sender.tab) await refreshBadge(sender.tab.id, msg.entry.url); sendResponse({ ok: true, ...r }); })
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'HSP_GET_PAGE') {
    getPage(msg.url)
      .then((page) => sendResponse({ ok: true, page }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'HSP_REMOVE_HIDES') {
    removeHides(msg.url, msg.ids)
      .then(async (r) => { if (sender.tab) await refreshBadge(sender.tab.id, msg.url); sendResponse({ ok: true, ...r }); })
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'HSP_BADGE') {
    refreshBadge(msg.tabId, msg.url)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'HSP_RECORD_STATS') {
    recordStats(msg.stats || {})
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  return false;
});

const DEFAULT_STATS = {
  roundsPlayed: 0,
  slabsFound: 0,
  soloBestScore: 0,
  soloBestRound: 0,
  bestSeekMs: 0,
  bestCamo: 0,
};

async function recordStats(delta) {
  const { stats = {} } = await chrome.storage.local.get('stats');
  const s = { ...DEFAULT_STATS, ...stats };
  s.roundsPlayed += delta.rounds || 0;
  s.slabsFound += delta.found || 0;
  if (delta.soloScore != null) s.soloBestScore = Math.max(s.soloBestScore, delta.soloScore);
  if (delta.soloRound != null) s.soloBestRound = Math.max(s.soloBestRound, delta.soloRound);
  if (delta.seekMs != null && delta.seekMs > 0) {
    s.bestSeekMs = s.bestSeekMs ? Math.min(s.bestSeekMs, delta.seekMs) : delta.seekMs;
  }
  if (delta.camo != null) s.bestCamo = Math.max(s.bestCamo, delta.camo);
  await chrome.storage.local.set({ stats: s });
}
