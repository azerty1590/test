// Background service worker: injects the game into the active tab and
// takes viewport screenshots on request. Screenshots never leave the browser.

const GAME_FILES = ['content/lib.js', 'content/game.js'];

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
