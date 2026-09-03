const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const buttons = [...document.querySelectorAll('.mode')];
const settingIds = ['difficulty', 'seekTime', 'guesses', 'hideTime', 'hiders', 'sound'];

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
    sound: s.sound !== 'off',
  };
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
