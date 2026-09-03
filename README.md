# Hide & Seek Paint · Chrome extension

Turn **any web page** into a hide-and-seek arena. A hider gets a blank grey slab, paints it to blend into the page behind it and hides it. A seeker then has a few seconds and a few clicks to find it. Inspired by paint-camouflage hide-and-seek games, but playable on every site you open.

## Modes

| Mode | What happens |
| --- | --- |
| **Hide & Seek** (hot-seat) | Player 1 paints and hides a slab, hands over the device, player 2 seeks. Roles swap each round. Set **Hiders** to 2 or 3 for party rounds where every hider paints in turn and the seeker must find them all. |
| **Chameleon Hunt** (solo) | The extension hides several slabs that copy the page almost perfectly. Each has a tiny giveaway: a slightly shifted colour, a nudged pattern and a little eye. Find them all before time runs out. Rounds get bigger. |
| **Hide & Share** | Paint and hide, then copy a code. A friend opens the same page and pastes it in **Seek from Code**. |
| **Seek from Code** | Paste a friend's code and hunt. |

## Painting tools

- **Brush** (`B`), size `[` / `]`, opacity slider
- **Eyedropper** (`E`): pick any colour from the page. Recently picked colours become swatches.
- **Stamp** (`S`): copies the real pixels behind the slab. It has a limited ink budget (30 % of the slab), so most of the camouflage still has to be painted by hand.
- **Fill** (`F`), **Move** (`M` or Shift+drag), slab resize slider, undo (`Ctrl+Z`), reset.
- A live **camo score** tells the hider how close the slab is to what is behind it.

Seekers get a countdown, limited guesses, warmer/colder feedback, and a hint button that costs 10 seconds. Short synthesised sound cues can be turned off in the popup.

## Install (unpacked)

1. Clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. Open any website, click the 🦎 toolbar icon (or press `Alt+Shift+H`) and pick a mode.

Works in Chrome, Edge, Brave and other Chromium browsers that support Manifest V3.

## How it works

When you start a round, the extension takes a screenshot of the visible part of the tab (`chrome.tabs.captureVisibleTab`, granted through `activeTab` when you click the icon) and draws it on a full-viewport canvas in a shadow DOM overlay. Slabs are separate canvases at device-pixel resolution so they blend pixel-for-pixel with the snapshot. Everything runs locally: the screenshot never leaves the browser, and share codes contain only the painted slab and its position.

Pages the browser refuses to capture (`chrome://`, the Web Store) cannot be used as arenas.

## Development

```
npm test          # unit tests for the pure game logic (content/lib.js)
npm run smoke     # headless-Chromium end-to-end run of every mode (needs playwright + chromium)
npm run icons     # regenerate icons/*.png
npm run pack      # zip the extension for distribution
```

The smoke test loads the unpacked extension into headless Chromium at device scale factor 2, checks the service worker and popup, then plays every mode against a locally served page. Playwright is resolved from `NODE_PATH` if it is installed globally:

```
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) npm run smoke
```

Layout:

```
manifest.json        MV3 manifest
background.js        service worker: screenshot, injection, stats
popup/               toolbar popup: mode picker, settings, stats
content/lib.js       pure helpers (scoring, placement, share codes)
content/game.js      in-page game (shadow DOM overlay, paint tools, seeking, solo hunt)
scripts/make-icons.js dependency-free PNG icon generator
tests/               node:test unit tests
```
