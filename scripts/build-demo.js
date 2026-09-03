// Builds the standalone web demo: demo/index.html (full page for GitHub Pages
// or a double-click) and demo/artifact.html (the same page as a body fragment).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
let frag = read('demo/template.html')
  .replace('/*__LIB__*/', () => safe(read('content/lib.js')))
  .replace('/*__GAME__*/', () => safe(read('content/game.js')));
const version = JSON.parse(read('manifest.json')).version;
frag = `<!-- Hide & Seek Paint web demo v${version}. Built by scripts/build-demo.js from content/lib.js + content/game.js; do not edit by hand. -->\n` + frag;
fs.writeFileSync(path.join(ROOT, 'demo/artifact.html'), frag);
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="color-scheme" content="dark">\n</head>\n<body>\n${frag}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(ROOT, 'demo/index.html'), full);
console.log(`wrote demo/index.html (${(full.length / 1024).toFixed(0)} KB) and demo/artifact.html`);
