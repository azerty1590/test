#!/usr/bin/env node
// Repack a binary .glb as glTF JSON with its buffer embedded as a data URI.
// Same model, text container: plain .json is served by every static host.
// Usage: node tools/glb-to-json.js model.glb [more.glb ...]   (writes model.json next to each)
const fs = require('fs');
for (const file of process.argv.slice(2)) {
  const glb = fs.readFileSync(file);
  if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error(file + ' is not a .glb');
  let off = 12, json = null, bin = null;
  while (off < glb.length) {
    const len = glb.readUInt32LE(off), type = glb.toString('ascii', off + 4, off + 8);
    const body = glb.slice(off + 8, off + 8 + len);
    if (type === 'JSON') json = JSON.parse(body.toString('utf8')); else if (type.startsWith('BIN')) bin = body;
    off += 8 + len;
  }
  if (bin) json.buffers[0].uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
  const out = file.replace(/\.glb$/i, '.json');
  fs.writeFileSync(out, JSON.stringify(json));
  console.log(out, fs.statSync(out).size);
}
