#!/usr/bin/env node
// Sanity-check levels.js: rectangular maps, one start, sealed rooms, reachable hostiles and doors,
// and enough doors for every wave. Usage: node tools/check-levels.js
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'levels.js'));
const data = global.window.STANDSTILL;
const WALK = /[.Pgrdsn1-9]/, TYPES = 'grdsn';
let bad = 0;
const fail = (id, msg) => { bad++; console.log('FAIL ' + id + ': ' + msg); };

function check(id, map, waves) {
  const rows = map.length, cols = map[0].length;
  if (map.some((r) => r.length !== cols)) return fail(id, 'rows differ in length');
  let start = null, doors = 0, hostiles = 0;
  const marks = [];
  map.forEach((row, r) => [...row].forEach((ch, c) => {
    if (!/[#=o.Pgrdsn1-9]/.test(ch)) fail(id, 'unknown symbol "' + ch + '" at row ' + r + ' col ' + c);
    if (ch === 'P') { if (start) fail(id, 'more than one P'); start = [r, c]; }
    if (/[1-9]/.test(ch)) { doors++; marks.push([r, c, ch]); }
    if (TYPES.includes(ch)) { hostiles++; marks.push([r, c, ch]); }
  }));
  if (!start) return fail(id, 'no P');
  const seen = new Set([start[0] * cols + start[1]]), todo = [start];
  while (todo.length) {
    const [r, c] = todo.pop();
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) return fail(id, 'room leaks at row ' + r + ' col ' + c);
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc, k = nr * cols + nc;
      if (!seen.has(k) && WALK.test(map[nr][nc])) { seen.add(k); todo.push([nr, nc]); }
    }
  }
  for (const [r, c, ch] of marks) if (!seen.has(r * cols + c)) fail(id, '"' + ch + '" at row ' + r + ' col ' + c + ' cannot be reached');
  for (const w of waves || []) {
    if ([...w].some((ch) => !TYPES.includes(ch))) fail(id, 'wave "' + w + '" has an unknown letter');
    if (!doors) fail(id, 'has waves but no doors');
    hostiles += w.length;
  }
  if (!hostiles && waves) fail(id, 'no hostiles');
  return hostiles;
}

data.chapters.forEach((ch, ci) => ch.levels.forEach((lv, li) => {
  const id = (ci + 1) + '-' + (li + 1) + ' ' + lv.name;
  const n = check(id, lv.map, lv.waves || []);
  if (typeof n === 'number') console.log('ok   ' + id + ': ' + lv.map[0].length + 'x' + lv.map.length + ', ' + n + ' hostiles');
}));
check('arena', data.arena);
console.log(bad ? bad + ' problem(s)' : 'all levels pass');
process.exit(bad ? 1 : 0);
