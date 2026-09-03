const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const buttons = [...document.querySelectorAll('.mode')];
const settingIds = ['difficulty', 'seekTime', 'guesses', 'hideTime', 'hiders', 'wobble', 'stampInk', 'sound'];

function showStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle('ok', Boolean(ok));
}

function readSettings() {
  const s = {};
  for (const id of settingIds) s[id] = document.getElementById(id).value;
  return {
    difficulty: s.difficulty,
    seekTime: Number(s.seekTime),
    guesses: Number(s.guesses),
    hideTime: Number(s.hideTime),
    hiders: Number(s.hiders),
    wobble: s.wobble,
    stampInk: s.stampInk,
    sound: s.sound !== 'off',
  };
}

let activeTab = null;

async function loadPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    const url = tab && tab.url;
    const countEl = $('#pageCount');
    const label = $('#pageLabel');
    const btn = $('#seekPage');
    if (!url || !/^https?:/i.test(url)) {
      countEl.textContent = '–';
      label.textContent = 'not a playable page';
      btn.disabled = true;
      return;
    }
    const linkCode = window.HSP && window.HSP.parseShareLink(url);
    const linkBtn = $('#seekLink');
    linkBtn.hidden = !linkCode;
    if (linkCode) linkBtn.dataset.code = linkCode;
    const res = await chrome.runtime.sendMessage({ type: 'HSP_GET_PAGE', url });
    const n = res && res.ok ? res.page.slabs.length : 0;
    countEl.textContent = String(n);
    label.textContent = n === 1 ? 'hider on this page' : 'hiders on this page';
    btn.disabled = n === 0;
    chrome.runtime.sendMessage({ type: 'HSP_BADGE', tabId: tab.id, url }).catch(() => {});
  } catch {
    $('#pageCount').textContent = '–';
  }
}

async function loadBadgeToggle() {
  const box = $('#badgeAll');
  try {
    box.checked = await chrome.permissions.contains({ permissions: ['tabs'] });
  } catch {
    box.disabled = true;
  }
  box.addEventListener('change', async () => {
    try {
      if (box.checked) {
        box.checked = await chrome.permissions.request({ permissions: ['tabs'] });
        if (box.checked) showStatus('The icon now counts hiders on every page you visit.', true);
      } else {
        await chrome.permissions.remove({ permissions: ['tabs'] });
      }
    } catch (e) {
      box.checked = false;
      showStatus(`Could not change the permission: ${e.message}`);
    }
  });
}

async function loadState() {
  const { settings, stats } = await chrome.storage.local.get(['settings', 'stats']);
  if (settings) {
    for (const id of settingIds) {
      if (settings[id] == null) continue;
      const v = id === 'sound' ? (settings[id] ? 'on' : 'off') : String(settings[id]);
      document.getElementById(id).value = v;
    }
  }
  const st = stats || {};
  $('#stRounds').textContent = st.roundsPlayed || 0;
  $('#stFound').textContent = st.slabsFound || 0;
  $('#stSolo').textContent = st.soloBestScore || 0;
  $('#stCamo').textContent = st.bestCamo ? `${st.bestCamo}%` : '0';
}

for (const id of settingIds) {
  document.getElementById(id).addEventListener('change', () => {
    chrome.storage.local.set({ settings: readSettings() });
  });
}

for (const btn of buttons) {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    buttons.forEach((b) => (b.disabled = true));
    showStatus('Taking a snapshot of the page…', true);
    const payload = { mode, settings: readSettings() };
    if (btn.dataset.code) payload.code = btn.dataset.code;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'HSP_LAUNCH', payload });
      if (!res || !res.ok) throw new Error(res ? res.error : 'No response');
      window.close();
    } catch (e) {
      showStatus(`Could not start: ${e.message}`);
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}

loadState();
loadPage();
loadBadgeToggle();
