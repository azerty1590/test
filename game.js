/* Doodle Freeze — a notebook-page FPS where you can stop time.
   three.js r128 (global build) + Kenney models/sounds. No build step. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;

  // Mirrors the CSS tokens in index.html.
  const C = { paper: 0xf7f2e4, ink: 0x23262e, blue: 0x2456d6, red: 0xe2413a, pencil: 0x7d8391, hilite: 0xffd84a };
  const col = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  const gameEl = $('game');
  const canvas = $('c');

  if (!window.THREE) { $('loadmsg').textContent = 'The 3D library did not load, so the game cannot start.'; return; }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    $('loadmsg').textContent = 'This browser could not start WebGL, so the game cannot run here.';
    return;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.autoClear = false;
  renderer.setClearColor(C.paper);

  // ------------------------------------------------------------------ world constants
  const S = 1.4;            // scale applied to Kenney wall pieces
  const ARENA = 18.9;       // half-size of the square arena (18 wall tiles per side)
  const EYE = 1.55;
  const HI = { w: 1.5 * S, d: 0.7 * S, h: 1.7 * S };
  const LO = { w: 2.2 * S, d: 0.7 * S, h: 0.8 * S };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.paper, 26, 74);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.08, 220);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8b4, 0.82));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  // First-person blaster lives in its own scene so it never pokes through walls.
  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(50, 1, 0.02, 10);
  vmScene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8b4, 0.9));
  const vmSun = new THREE.DirectionalLight(0xffffff, 0.5);
  vmSun.position.set(2, 4, 3);
  vmScene.add(vmSun);

  // ------------------------------------------------------------------ doodle materials
  // desat: 0 = time flowing, 1 = page frozen (world loses its colour, ink bullets keep theirs)
  const paperCol = new THREE.Color(C.paper);
  const frostCol = (() => {
    const l = paperCol.r * 0.299 + paperCol.g * 0.587 + paperCol.b * 0.114;
    return new THREE.Color(l * 0.93, l * 0.97, Math.min(1, l * 1.06));
  })();
  const U = {
    desat: { value: 0 },
    boil: { value: 0 },      // line wobble clock, runs on world time so it stops with the page
    boilVM: { value: 0 },    // same, real time, for the player's own blaster
    px: { value: 0.003 },    // world units per CSS pixel at depth 1
    fog: { value: paperCol.clone() },
    ink: { value: new THREE.Color(C.ink) },
  };
  const DESAT_MAX = 0.82;

  function patch(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDesat = U.desat;
      sh.fragmentShader = 'uniform float uDesat;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n' +
        '  float dl_ = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
        '  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dl_) * vec3(0.93, 0.97, 1.06), uDesat);'
      );
    };
    return mat;
  }

  const grad = new THREE.DataTexture(new Uint8Array([165, 222, 255]), 3, 1, THREE.LuminanceFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.generateMipmaps = false;
  grad.needsUpdate = true;

  const toonCache = new Map();
  function toon(map, tint, inst) {
    const key = (map ? map.uuid : '-') + ':' + (tint || 0xffffff) + ':' + (inst ? 1 : 0);
    let m = toonCache.get(key);
    if (!m) {
      m = patch(new THREE.MeshToonMaterial({ map: map || null, color: col(tint || 0xffffff), gradientMap: grad }));
      toonCache.set(key, m);
    }
    return m;
  }

  // Ink outline: back faces pushed out along smoothed normals, a constant few pixels wide,
  // re-jittered ~9 times a second so the lines "boil" like a flipbook.
  function makeOutline(boil, width) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uPx: U.px, uBoil: boil, uW: { value: width }, uInk: U.ink, uFog: U.fog, uNear: { value: 26 }, uFar: { value: 74 } },
      vertexShader: [
        'attribute vec3 snormal;',
        'uniform float uPx, uBoil, uW;',
        'varying float vD;',
        'void main() {',
        '  #ifdef USE_INSTANCING',
        '    mat4 mm = modelViewMatrix * instanceMatrix;',
        '  #else',
        '    mat4 mm = modelViewMatrix;',
        '  #endif',
        '  vec4 mv = mm * vec4(position, 1.0);',
        '  vec3 n = normalize(mat3(mm) * snormal);',
        '  float h = fract(sin(dot(position + floor(uBoil), vec3(12.9898, 78.233, 37.719))) * 43758.5453);',
        '  float d = max(-mv.z, 0.0);',
        '  mv.xyz += n * clamp(d * uPx * uW * (0.7 + 0.6 * h), 0.003, 0.3);',
        '  vD = d;',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uInk, uFog;',
        'uniform float uNear, uFar;',
        'varying float vD;',
        'void main() { gl_FragColor = vec4(mix(uInk, uFog, smoothstep(uNear, uFar, vD)), 1.0); }',
      ].join('\n'),
    });
  }
  const outlineMat = makeOutline(U.boil, 2.3);
  const outlineInst = makeOutline(U.boil, 2.3);
  const outlineVM = makeOutline(U.boilVM, 2.0);
  outlineVM.uniforms.uNear.value = 500; outlineVM.uniforms.uFar.value = 600;

  function addSmoothNormals(geo) {
    if (geo.attributes.snormal) return;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const acc = new Map(), keys = new Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.round(pos.getX(i) * 500) + '_' + Math.round(pos.getY(i) * 500) + '_' + Math.round(pos.getZ(i) * 500);
      keys[i] = k;
      let a = acc.get(k);
      if (!a) { a = [0, 0, 0]; acc.set(k, a); }
      a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = acc.get(keys[i]);
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
    }
    geo.setAttribute('snormal', new THREE.BufferAttribute(out, 3));
  }

  // Turn a loaded Kenney model into a doodle: toon fill + ink outline child on every mesh.
  function prep(root, lineMat) {
    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      const map = m.material.map;
      if (map) map.encoding = THREE.sRGBEncoding;
      m.material = toon(map);
      addSmoothNormals(m.geometry);
      const o = new THREE.Mesh(m.geometry, lineMat || outlineMat);
      o.userData.ol = true;
      m.add(o);
    }
    return root;
  }
  const fillMeshes = (root) => { const a = []; root.traverse((o) => { if (o.isMesh && !o.userData.ol) a.push(o); }); return a; };

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function trs(x, y, z, ry, sx, sy, sz) {
    _e.set(0, ry, 0); _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
  }
  // plain: draw the piece as uncoloured line art (a pale pencil tint) instead of its Kenney colours
  function instancedFrom(root, matrices, plain) {
    root.updateMatrixWorld(true);
    const src = fillMeshes(root)[0];
    const n = matrices.length;
    const fill = new THREE.InstancedMesh(src.geometry, plain ? toon(null, plain, true) : toon(src.material.map, 0xffffff, true), n);
    const line = new THREE.InstancedMesh(src.geometry, outlineInst, n);
    matrices.forEach((mat, i) => { _m.multiplyMatrices(mat, src.matrixWorld); fill.setMatrixAt(i, _m); line.setMatrixAt(i, _m); });
    fill.frustumCulled = line.frustumCulled = false;
    const g = new THREE.Group();
    g.add(fill, line);
    return g;
  }

  // ------------------------------------------------------------------ hand-drawn textures
  function scribble(ctx, pts, jit, passes) {
    for (let k = 0; k < (passes || 2); k++) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = p[0] + rand(-jit, jit), y = p[1] + rand(-jit, jit);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
  }
  function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function floorTexture() {
    const t = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#f7f2e4'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(120,110,80,' + rand(0.02, 0.07) + ')'; g.fillRect(rand(0, w), rand(0, h), 1.5, 1.5); }
      g.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const major = i % 4 === 0;
        g.strokeStyle = major ? 'rgba(96,150,210,.62)' : 'rgba(130,175,220,.42)';
        g.lineWidth = major ? 3 : 2;
        const c = i * 64 + 2;
        const a = [], b = [];
        for (let s = 0; s <= 8; s++) { a.push([c, s * 64]); b.push([s * 64, c]); }
        scribble(g, a, 0.8, 1); scribble(g, b, 0.8, 1);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(120 / 4.2, 120 / 4.2);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function skyTexture() {
    const t = canvasTex(2048, 1024, (g, w, h) => {
      g.fillStyle = '#f7f2e4'; g.fillRect(0, 0, w, h);
      const horizon = h * 0.73;
      g.lineCap = 'round'; g.lineJoin = 'round';
      // ruled notebook lines
      g.strokeStyle = 'rgba(130,175,220,.5)'; g.lineWidth = 2.5;
      for (let y = 40; y < horizon - 60; y += 46) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      // pencil hills along the horizon (tileable: heights repeat at both ends)
      g.strokeStyle = 'rgba(125,131,145,.85)'; g.lineWidth = 3;
      const hill = (x) => horizon - 34 - 26 * Math.sin(x / w * TAU * 5) - 16 * Math.sin(x / w * TAU * 13 + 1.3) - 9 * Math.sin(x / w * TAU * 29);
      const pts = [];
      for (let x = 0; x <= w; x += 16) pts.push([x, hill(x)]);
      scribble(g, pts, 1.6, 2);
      g.lineWidth = 1.6; g.strokeStyle = 'rgba(125,131,145,.45)';
      for (let x = 6; x < w; x += 22) { const y = hill(x); scribble(g, [[x, y + 6], [x - 10, y + 6 + rand(14, 30)]], 1, 1); }
      // doodles in the margins of the sky
      g.strokeStyle = 'rgba(125,131,145,.8)'; g.lineWidth = 3;
      const sunAt = (cx, cy, r) => {
        const ring = []; for (let a = 0; a <= TAU + 0.3; a += 0.3) ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        scribble(g, ring, 2, 2);
        for (let a = 0; a < TAU; a += TAU / 10) scribble(g, [[cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3], [cx + Math.cos(a) * r * 1.8, cy + Math.sin(a) * r * 1.8]], 2, 1);
      };
      sunAt(360, 300, 62);
      const bird = (x, y, s) => scribble(g, [[x - s, y - s * 0.5], [x - s * 0.4, y - s * 0.75], [x, y], [x + s * 0.4, y - s * 0.75], [x + s, y - s * 0.5]], 1.5, 1);
      [[820, 250, 22], [880, 300, 16], [1500, 210, 24], [1570, 270, 15], [1210, 420, 18], [150, 500, 14]].forEach((b) => bird(b[0], b[1], b[2]));
      const star = (cx, cy, r) => { const p = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * TAU / 10, rr = i % 2 ? r * 0.45 : r; p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } scribble(g, p, 1.5, 2); };
      star(1120, 180, 30); star(1840, 380, 22); star(640, 470, 18);
      const spiral = (cx, cy) => { const p = []; for (let a = 0; a < 14; a += 0.35) p.push([cx + Math.cos(a) * a * 3.2, cy + Math.sin(a) * a * 3.2]); scribble(g, p, 1, 1); };
      spiral(1700, 150); spiral(980, 520);
    });
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }
  function bangTexture() {
    return canvasTex(128, 128, (g) => {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.font = '900 120px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 14; g.strokeStyle = '#23262e'; g.strokeText('!', 64, 68);
      g.fillStyle = '#e2413a'; g.fillText('!', 64, 68);
    });
  }
  function flashTexture() {
    return canvasTex(128, 128, (g) => {
      g.translate(64, 64); g.lineJoin = 'round';
      const p = [];
      for (let i = 0; i <= 18; i++) { const a = i * TAU / 18, r = i % 2 ? rand(20, 30) : rand(46, 60); p.push([Math.cos(a) * r, Math.sin(a) * r]); }
      g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
      g.fillStyle = '#ffd84a'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#23262e'; g.stroke();
    });
  }

  // ------------------------------------------------------------------ collision world
  const obstacles = [];
  function addBox(x, z, hx, hz, h) { obstacles.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, h }); }

  function resolveCircle(p, r) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const cx = clamp(p.x, o.x0, o.x1), cz = clamp(p.z, o.z0, o.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      else {
        const l = p.x - o.x0, rr = o.x1 - p.x, t = p.z - o.z0, b = o.z1 - p.z, m = Math.min(l, rr, t, b);
        if (m === l) p.x = o.x0 - r; else if (m === rr) p.x = o.x1 + r; else if (m === t) p.z = o.z0 - r; else p.z = o.z1 + r;
      }
    }
    const lim = ARENA - r;
    p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
  }
  function insideAny(x, z, r) {
    for (const o of obstacles) if (x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r) return true;
    return false;
  }
  // First hit of a segment against the cover boxes: returns t in [0,1], or 2 when clear.
  function segHit(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let best = 2;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      let t0 = 0, t1 = 1, a, b, s;
      if (Math.abs(dx) < 1e-9) { if (x0 < o.x0 || x0 > o.x1) continue; }
      else { a = (o.x0 - x0) / dx; b = (o.x1 - x0) / dx; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      if (Math.abs(dy) < 1e-9) { if (y0 < 0 || y0 > o.h) continue; }
      else { a = (0 - y0) / dy; b = (o.h - y0) / dy; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (z0 < o.z0 || z0 > o.z1) continue; }
      else { a = (o.z0 - z0) / dz; b = (o.z1 - z0) / dz; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      if (t0 < best) best = t0;
    }
    return best;
  }

  // ------------------------------------------------------------------ assets
  const models = {};
  const tex = {};
  const FILES = {
    blaster: 'assets/fps/blaster.json', drone: 'assets/fps/enemy-flying.json',
    wallHigh: 'assets/fps/wall-high.json', wallLow: 'assets/fps/wall-low.json',
    cloud: 'assets/fps/cloud.json', grass: 'assets/fps/grass.json',
    bot: 'assets/plat/character.json', brick: 'assets/plat/brick.json',
  };
  let botClips = [];

  function loadAll() {
    const loader = new THREE.GLTFLoader();
    const jobs = Object.keys(FILES).map((k) => new Promise((res, rej) => {
      loader.load(FILES[k], (g) => { models[k] = g.scene; if (k === 'bot') botClips = g.animations; res(); }, undefined, () => rej(new Error(FILES[k])));
    }));
    jobs.push(new Promise((res) => {
      new THREE.TextureLoader().load('assets/img/blob_shadow.png', (t) => { tex.shadow = t; res(); }, undefined, () => res());
    }));
    return Promise.all(jobs);
  }

  // ------------------------------------------------------------------ static world
  const clouds = [];
  let cloudGroup = null;
  function buildWorld() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), patch(new THREE.MeshBasicMaterial({ map: floorTexture() })));
    floor.material.map.repeat.set(240 / 4.2, 240 / 4.2);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const sky = new THREE.Mesh(
      new THREE.CylinderGeometry(110, 110, 150, 40, 1, true),
      patch(new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }))
    );
    sky.position.y = EYE + 150 / 2 - 150 * 0.27; // put the drawn horizon at eye level
    sky.renderOrder = -1;
    scene.add(sky);

    // perimeter
    const edge = [];
    for (let i = 0; i < 18; i++) {
      const p = -ARENA + HI.w * (i + 0.5), o = ARENA + HI.d / 2;
      edge.push(trs(p, 0, -o, 0, S), trs(p, 0, o, 0, S), trs(-o, 0, p, Math.PI / 2, S), trs(o, 0, p, Math.PI / 2, S));
    }
    // walls stay uncoloured so red and blue ink always reads against them
    scene.add(instancedFrom(models.wallHigh, edge, 0xf1ead6));

    // cover, mirrored into all four quadrants
    const hi = [], lo = [], br = [];
    const quad = (fn) => { for (let q = 0; q < 4; q++) fn(q); };
    const rot = (x, z, q) => { for (let i = 0; i < q; i++) { const t = x; x = -z; z = t; } return [x, z]; };
    const wall = (list, dim, x, z, r) => quad((q) => {
      const p = rot(x, z, q), turned = (r + q) % 2 === 1;
      list.push(trs(p[0], 0, p[1], turned ? Math.PI / 2 : 0, S));
      addBox(p[0], p[1], (turned ? dim.d : dim.w) / 2, (turned ? dim.w : dim.d) / 2, dim.h);
    });
    const bricks = (x, z, n) => quad((q) => {
      const p = rot(x, z, q);
      for (let i = 0; i < n; i++) br.push(trs(p[0], i * S, p[1], q * 0.3, S));
      addBox(p[0], p[1], S / 2, S / 2, n * S);
    });
    wall(lo, LO, 5.2, 0, 1);
    wall(hi, HI, 8.4, 8.6, 0); wall(hi, HI, 8.4 + HI.w, 8.6, 0);
    wall(hi, HI, 3.4, 12.6, 1);
    wall(lo, LO, 13.4, 13.6, 0);
    wall(lo, LO, 11.5, -2.2, 1);
    bricks(14.2, -6.4, 2); bricks(14.2 + S, -6.4, 1); bricks(14.2, -6.4 - S, 1);
    bricks(9.6, 2.9, 1);
    scene.add(instancedFrom(models.wallHigh, hi, 0xf6efdc), instancedFrom(models.wallLow, lo, 0xdfe9f4), instancedFrom(models.brick, br, 0xfbe7a6));

    // grass tufts
    const tufts = [];
    for (let i = 0; i < 70; i++) {
      const x = rand(-ARENA + 1, ARENA - 1), z = rand(-ARENA + 1, ARENA - 1);
      if (insideAny(x, z, 0.5)) continue;
      tufts.push(trs(x, 0, z, rand(0, TAU), rand(1.2, 2.2)));
    }
    for (let i = 0; i < 60; i++) { const a = rand(0, TAU), r = rand(ARENA + 3, 46); tufts.push(trs(Math.cos(a) * r, 0, Math.sin(a) * r, rand(0, TAU), rand(1.5, 3))); }
    scene.add(instancedFrom(models.grass, tufts));

    // clouds drift on world time
    for (let i = 0; i < 11; i++) {
      const a = rand(0, TAU), r = rand(24, 62);
      clouds.push({ x: Math.cos(a) * r, y: rand(13, 26), z: Math.sin(a) * r, ry: rand(0, TAU), sx: rand(6, 11), sy: rand(2.4, 4), sz: rand(4, 7), v: rand(0.25, 0.7) });
    }
    cloudGroup = instancedFrom(models.cloud, clouds.map((c) => trs(c.x, c.y, c.z, c.ry, c.sx, c.sy, c.sz)), 0xffffff);
    cloudGroup.userData.base = fillMeshes(models.cloud)[0].matrixWorld.clone();
    scene.add(cloudGroup);
  }
  function updateClouds(dtW) {
    if (!cloudGroup || dtW <= 0) return;
    const fill = cloudGroup.children[0], line = cloudGroup.children[1];
    clouds.forEach((c, i) => {
      c.x += c.v * dtW; if (c.x > 70) c.x = -70;
      _m.multiplyMatrices(trs(c.x, c.y, c.z, c.ry, c.sx, c.sy, c.sz), cloudGroup.userData.base);
      fill.setMatrixAt(i, _m); line.setMatrixAt(i, _m);
    });
    fill.instanceMatrix.needsUpdate = line.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ pooled ink: bullets, droplets, splats, shadows
  const MAXB = 240;
  const bullets = [];
  let bulletFill, bulletLine, bulletSeq = 0;
  const BLUE = col(C.blue), RED = col(C.red), INKC = col(C.ink), GOLD = col(C.hilite);

  const MAXD = 160;
  const drops = [];
  let dropMesh;
  const MAXS = 70;
  let splatMesh, splatN = 0, splatI = 0;
  const MAXSH = 16;
  let shadowMesh;

  function buildPools() {
    const sph = new THREE.SphereGeometry(1, 12, 9);
    bulletFill = new THREE.InstancedMesh(sph, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), MAXB);
    bulletLine = new THREE.InstancedMesh(sph, new THREE.MeshBasicMaterial({ color: INKC, side: THREE.BackSide, fog: false }), MAXB);
    for (let i = 0; i < MAXB; i++) bulletFill.setColorAt(i, BLUE);
    bulletFill.count = bulletLine.count = 0;
    bulletFill.frustumCulled = bulletLine.frustumCulled = false;
    scene.add(bulletLine, bulletFill);

    dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), MAXD);
    for (let i = 0; i < MAXD; i++) dropMesh.setColorAt(i, BLUE);
    dropMesh.count = 0; dropMesh.frustumCulled = false;
    scene.add(dropMesh);

    // irregular ink blot lying on the floor
    const pos = [0, 0, 0], idx = [], N = 16;
    for (let i = 0; i < N; i++) { const a = i / N * TAU, r = rand(0.62, 1.08); pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    for (let i = 0; i < N; i++) idx.push(0, 1 + ((i + 1) % N), 1 + i);
    const blot = new THREE.BufferGeometry();
    blot.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    blot.setIndex(idx);
    splatMesh = new THREE.InstancedMesh(blot, patch(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide })), MAXS);
    for (let i = 0; i < MAXS; i++) splatMesh.setColorAt(i, BLUE);
    splatMesh.count = 0; splatMesh.frustumCulled = false; splatMesh.renderOrder = 1;
    scene.add(splatMesh);

    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    shadowMesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex.shadow || null, color: tex.shadow ? 0xffffff : 0x000000, transparent: true, opacity: tex.shadow ? 0.55 : 0.18, depthWrite: false }), MAXSH);
    shadowMesh.count = 0; shadowMesh.frustumCulled = false; shadowMesh.renderOrder = 2;
    scene.add(shadowMesh);
  }

  function spawnBullet(team, x, y, z, dx, dy, dz, speed, r, dmg, owner) {
    let b = null;
    for (let i = 0; i < bullets.length; i++) if (!bullets[i].alive) { b = bullets[i]; break; }
    if (!b) { if (bullets.length >= MAXB) return null; b = {}; bullets.push(b); }
    b.alive = true; b.team = team; b.x = x; b.y = y; b.z = z; b.dx = dx; b.dy = dy; b.dz = dz;
    b.speed = speed; b.r = r; b.dmg = dmg; b.owner = owner; b.life = team === 0 ? 4 : 7; b.free = 0;
    b.flipped = false; b.frozenShot = false; b.id = bulletSeq++;
    return b;
  }
  function spawnDrops(x, y, z, color, n, power) {
    for (let i = 0; i < n; i++) {
      let d = null;
      for (let j = 0; j < drops.length; j++) if (!drops[j].alive) { d = drops[j]; break; }
      if (!d) { if (drops.length >= MAXD) return; d = {}; drops.push(d); }
      const a = rand(0, TAU), u = rand(-0.3, 1), sp = rand(0.4, 1) * power;
      d.alive = true; d.x = x; d.y = y; d.z = z;
      d.vx = Math.cos(a) * sp * Math.sqrt(1 - u * u * 0.6); d.vz = Math.sin(a) * sp * Math.sqrt(1 - u * u * 0.6); d.vy = u * sp + power * 0.4;
      d.r = rand(0.035, 0.085); d.life = rand(0.6, 1.3); d.color = color;
    }
  }
  function addSplat(x, z, r, color) {
    _e.set(0, rand(0, TAU), 0); _q.setFromEuler(_e);
    _m.compose(_p.set(x, 0.012 + splatI * 0.0004, z), _q, _s.set(r * rand(0.8, 1.2), 1, r * rand(0.8, 1.2)));
    splatMesh.setMatrixAt(splatI, _m); splatMesh.setColorAt(splatI, color);
    splatI = (splatI + 1) % MAXS; splatN = Math.min(MAXS, splatN + 1);
    splatMesh.count = splatN;
    splatMesh.instanceMatrix.needsUpdate = true; splatMesh.instanceColor.needsUpdate = true;
  }
  function clearInk() {
    for (const b of bullets) b.alive = false;
    for (const d of drops) d.alive = false;
    splatN = splatI = 0; splatMesh.count = 0;
  }

  // ------------------------------------------------------------------ audio
  const AC = window.AudioContext || window.webkitAudioContext;
  let actx = null, master = null, soundOn = true;
  const buffers = {};
  const SFX = { shoot: 'blaster', eshoot: 'enemy_attack', ehurt: 'enemy_hurt', edie: 'enemy_destroy', reload: 'weapon_change' };
  function initAudio() {
    if (actx || !AC) { if (actx && actx.state === 'suspended') actx.resume(); return; }
    try { actx = new AC(); } catch (e) { actx = null; return; }
    master = actx.createGain(); master.gain.value = soundOn ? 0.8 : 0; master.connect(actx.destination);
    Object.keys(SFX).forEach((k) => {
      fetch('assets/sfx/' + SFX[k] + '.mp3').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((ab) => new Promise((res, rej) => actx.decodeAudioData(ab, res, rej)))
        .then((buf) => { buffers[k] = buf; }).catch(() => {});
    });
  }
  function tone(f0, f1, dur, type, vol, delay) {
    if (!actx) return;
    const t = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function sfx(name, vol, rate) {
    if (!actx || !soundOn) return;
    const buf = buffers[name];
    if (buf) {
      const s = actx.createBufferSource(), g = actx.createGain();
      s.buffer = buf; s.playbackRate.value = rate || 1; g.gain.value = vol === undefined ? 1 : vol;
      s.connect(g); g.connect(master); s.start();
      return;
    }
    switch (name) { // synth stand-ins, also used for sounds with no sample
      case 'shoot': tone(720, 180, 0.09, 'square', 0.12); break;
      case 'eshoot': tone(300, 110, 0.14, 'sawtooth', 0.1 * (vol || 1)); break;
      case 'ehurt': tone(500, 260, 0.07, 'triangle', 0.15); break;
      case 'edie': tone(380, 60, 0.3, 'sawtooth', 0.16); break;
      case 'reload': tone(240, 480, 0.12, 'triangle', 0.12); break;
      case 'freeze': tone(900, 90, 0.45, 'sine', 0.3); tone(1400, 200, 0.3, 'triangle', 0.08); break;
      case 'thaw': tone(120, 880, 0.3, 'sine', 0.26); break;
      case 'flip': tone(660, 1320, 0.1, 'triangle', 0.22); tone(990, 1980, 0.14, 'triangle', 0.18, 0.08); break;
      case 'hurt': tone(170, 45, 0.25, 'sine', 0.5); tone(90, 40, 0.2, 'square', 0.12); break;
      case 'tick': tone(1500, 1200, 0.03, 'square', 0.05); break;
      case 'clear': tone(523, 523, 0.12, 'triangle', 0.2); tone(659, 659, 0.12, 'triangle', 0.2, 0.11); tone(784, 784, 0.22, 'triangle', 0.2, 0.22); break;
      case 'empty': tone(200, 150, 0.05, 'square', 0.08); break;
      case 'over': tone(330, 80, 0.8, 'sawtooth', 0.2); break;
    }
  }

  // ------------------------------------------------------------------ game state
  const P = { x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, energy: 100, ammo: 12, reloadT: 0, fireCd: 0, vx: 0, vz: 0, bob: 0, shake: 0, sinceFreeze: 9 };
  const MAG = 12;
  let state = 'load';         // load | menu | play | pause | over
  let frozen = false, ts = 1; // ts: world time scale, eased toward 0 or 1
  let wave = 0, score = 0, combo = 0, comboT = 0, best = 0;
  let queue = [], spawnCd = 0, maxAlive = 4, betweenT = 0;
  let worldClock = 0, realClock = 0, tickT = 0;
  const enemies = [];
  const debris = [];
  const tut = { freezeShown: false, usedFreeze: false, flipShown: false };

  try { best = +localStorage.getItem('doodlefreeze.best') || 0; } catch (e) { best = 0; }

  const TYPES = {
    walker:   { base: 'bot',   scale: 1.9, hp: 2, r: 0.62, cy: 0.95, speed: 2.5, near: 6, far: 13, cd: 2.5, tele: 0.45, bspeed: 10, dmg: 12, score: 100, gun: true },
    rusher:   { base: 'bot',   scale: 1.4, hp: 1, r: 0.5,  cy: 0.7,  speed: 4.9, melee: true, dmg: 22, tint: 0xff8f80, score: 120 },
    drone:    { base: 'drone', scale: 1.5, hp: 2, r: 0.64, cy: 0.42, speed: 3.0, near: 7, far: 13, cd: 2.6, tele: 0.4, bspeed: 11, dmg: 12, fly: 3.0, twin: true, score: 150 },
    spreader: { base: 'drone', scale: 2.2, hp: 4, r: 0.92, cy: 0.62, speed: 1.8, near: 8, far: 14, cd: 3.4, tele: 0.6, bspeed: 8,  dmg: 10, fly: 3.7, fan: 5, tint: 0xc9a2ff, score: 300 },
  };
  const COST = { walker: 1, rusher: 1, drone: 1.4, spreader: 3 };

  let bangTex, flashTex;
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });

  function makeEnemy(type, x, z) {
    const def = TYPES[type];
    const model = models[def.base].clone(true);
    model.scale.setScalar(def.scale);
    const parts = fillMeshes(model);
    for (const p of parts) { if (def.tint) p.material = toon(p.material.map, def.tint); p._base = p.material; }
    const root = new THREE.Group();
    root.add(model);
    if (def.gun) {
      const gun = models.blaster.clone(true);
      gun.scale.setScalar(0.4); gun.position.set(-0.36, 0.2, 0.12);
      model.add(gun);
      for (const p of fillMeshes(gun)) { p._base = p.material; parts.push(p); }
    }
    const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: bangTex, depthTest: false, fog: false }));
    bang.scale.setScalar(0.9); bang.position.y = def.fly ? def.cy + def.r + 0.7 : def.scale * 0.9 + 0.55; bang.visible = false; bang.renderOrder = 5;
    root.add(bang);
    const e = {
      type, def, root, model, parts, bang, alive: true, hp: def.hp, x, z, y: def.fly || 0, r: def.r, cy: def.cy,
      yaw: 0, vx: 0, vz: 0, spawnT: 0, fireCd: rand(1.6, 3.0), tele: 0, burstT: 0, side: 1,
      strafe: Math.random() < 0.5 ? -1 : 1, strafeT: rand(1.5, 3), phase: rand(0, TAU),
      los: false, losT: 0, flash: 0, stuck: 0, detourT: 0, detourDir: 1, wind: 0, atkCd: 0, mixer: null, idle: null, walk: null,
    };
    if (def.base === 'bot') {
      e.mixer = new THREE.AnimationMixer(model);
      const clip = (n) => THREE.AnimationClip.findByName(botClips, n);
      if (clip('idle') && clip('walk')) {
        e.idle = e.mixer.clipAction(clip('idle')); e.walk = e.mixer.clipAction(clip('walk'));
        e.idle.play(); e.walk.play(); e.walk.setEffectiveWeight(0);
        e.mixer.update(rand(0, 0.5));
      }
    }
    root.position.set(x, e.y, z);
    scene.add(root);
    enemies.push(e);
    return e;
  }

  function spawnPoint() {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU), r = rand(13, ARENA - 1.5);
      const x = clamp(Math.cos(a) * r * 1.2, -ARENA + 1.5, ARENA - 1.5), z = clamp(Math.sin(a) * r * 1.2, -ARENA + 1.5, ARENA - 1.5);
      if (insideAny(x, z, 0.9)) continue;
      if (Math.hypot(x - P.x, z - P.z) < 11) continue;
      return [x, z];
    }
    return [P.x > 0 ? -ARENA + 2 : ARENA - 2, P.z > 0 ? -ARENA + 2 : ARENA - 2];
  }

  function composeWave(n) {
    if (n === 1) return ['walker', 'walker', 'walker'];
    const pool = ['walker', 'walker'];
    if (n >= 2) pool.push('drone');
    if (n >= 3) pool.push('rusher', 'rusher');
    if (n >= 4) pool.push('spreader');
    if (n >= 6) pool.push('drone', 'spreader');
    const list = [];
    let budget = 2.4 + n * 1.5, guard = 0;
    while (budget > 0.9 && guard++ < 200) {
      const t = pick(pool);
      if (COST[t] > budget + 0.4) continue;
      list.push(t); budget -= COST[t];
    }
    return list;
  }

  // ------------------------------------------------------------------ HUD
  const hud = {
    hp: $('hpfill'), fz: $('fzfill'), fzbar: $('fzbar'), wave: $('wave'), left: $('left'), score: $('score'), ammo: $('ammo'),
    banner: $('banner'), pops: $('pops'), hint: $('hint'), hitm: $('hitm'), dmg: $('dmgdir'), hurt: $('hurt'), cross: $('cross'),
    freeze: $('freeze'), fire: $('fire'),
  };
  for (let i = 0; i < MAG; i++) hud.ammo.appendChild(document.createElement('i'));
  const cache = {};
  function setText(el, key, v) { if (cache[key] !== v) { cache[key] = v; el.textContent = v; } }
  let bannerTimer = 0, hintTimer = 0, hurtA = 0, dmgT = 0;
  function banner(text, sub, secs) {
    hud.banner.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; hud.banner.appendChild(s); }
    hud.banner.classList.add('on'); bannerTimer = secs || 1.8;
  }
  function hint(text, secs) { hud.hint.textContent = text; hud.hint.classList.add('on'); hintTimer = secs || 4; }
  function pop(text) {
    const d = document.createElement('div');
    d.textContent = text; d.style.top = (hud.pops.childElementCount * 22) + 'px';
    hud.pops.appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }
  function updateHUD(dt) {
    const hp = Math.max(0, P.hp) / 100, en = P.energy / 100;
    if (cache.hp !== hp) { cache.hp = hp; hud.hp.style.transform = 'scaleX(' + hp.toFixed(3) + ')'; }
    const e3 = Math.round(en * 100);
    if (cache.en !== e3) { cache.en = e3; hud.fz.style.transform = 'scaleX(' + en.toFixed(3) + ')'; hud.freeze.style.setProperty('--e', e3); }
    const low = !frozen && P.energy < 20;
    if (cache.low !== low) { cache.low = low; hud.fzbar.classList.toggle('low', low); hud.freeze.classList.toggle('low', low); }
    setText(hud.wave, 'wave', 'Page ' + wave);
    const left = enemies.length + queue.length;
    setText(hud.left, 'left', left ? left + (left === 1 ? ' doodle left' : ' doodles left') : '');
    setText(hud.score, 'score', String(score));
    const am = P.reloadT > 0 ? -1 : P.ammo;
    if (cache.am !== am) {
      cache.am = am;
      hud.ammo.classList.toggle('reloading', am < 0);
      for (let i = 0; i < MAG; i++) hud.ammo.children[i].className = i < (am < 0 ? 0 : am) ? '' : 'off';
    }
    const lbl = frozen ? 'GO!' : 'FREEZE';
    if (cache.fl !== lbl) { cache.fl = lbl; hud.freeze.firstElementChild.textContent = lbl; }
    if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) hud.banner.classList.remove('on');
    if (hintTimer > 0 && (hintTimer -= dt) <= 0) hud.hint.classList.remove('on');
    if (hurtA > 0) { hurtA = Math.max(0, hurtA - dt * 1.6); hud.hurt.style.opacity = hurtA.toFixed(2); }
    if (dmgT > 0 && (dmgT -= dt) <= 0) hud.dmg.style.opacity = 0;
  }

  // ------------------------------------------------------------------ player
  const eye = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  function aimBasis() {
    const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch), sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    fwd.set(-sy * cp, sp, -cy * cp);
    right.set(cy, 0, -sy);
    up.crossVectors(right, fwd);
    eye.set(P.x, EYE, P.z);
  }

  let vmFill = null;
  let gun = null, muzzle = null, recoil = 0, gunDip = 0, flashT = 0, swayX = 0, swayY = 0;
  function buildViewModel() {
    gun = new THREE.Group();
    const m = models.blaster.clone(true);
    // the player is not frozen with the page: real-time outlines and a fill that keeps its colour
    m.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.ol) o.material = outlineVM;
      else o.material = vmFill || (vmFill = new THREE.MeshToonMaterial({ map: o.material.map, gradientMap: grad }));
    });
    m.scale.setScalar(0.27); m.rotation.y = Math.PI;
    gun.add(m);
    muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, depthTest: false, transparent: true }));
    muzzle.scale.setScalar(0.24); muzzle.position.set(0, 0.16, -0.3); muzzle.visible = false;
    gun.add(muzzle);
    vmScene.add(gun);
  }

  function startReload() {
    if (P.reloadT > 0 || P.ammo === MAG) return;
    P.reloadT = 1.0; sfx('reload', 0.7);
  }

  function setFrozen(on) {
    if (on === frozen) return;
    if (on && P.energy < 20) { sfx('empty'); return; }
    frozen = on;
    gameEl.classList.toggle('frozen', on);
    sfx(on ? 'freeze' : 'thaw');
    if (on) {
      P.sinceFreeze = 0; tickT = 0.4;
      if (!tut.usedFreeze) { tut.usedFreeze = true; hud.hint.classList.remove('on'); hintTimer = 0; }
      if (!tut.flipShown) { tut.flipShown = true; hint('Aim at a hanging red bullet and shoot it. It goes back to whoever fired it.', 5.5); }
    }
  }

  // Looks along the crosshair for an enemy bullet to turn around.
  function findFlip() {
    let best = null, bt = 45;
    const real = ts > 0.5;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive || b.team !== 1) continue;
      const rx = b.x - eye.x, ry = b.y - eye.y, rz = b.z - eye.z;
      const t = rx * fwd.x + ry * fwd.y + rz * fwd.z;
      if (t < 0.5 || t > bt) continue;
      const d2 = rx * rx + ry * ry + rz * rz - t * t, tol = (real ? 0.2 : 0.3) + t * 0.022;
      if (d2 < tol * tol) { best = b; bt = t; }
    }
    if (best && segHit(eye.x, eye.y, eye.z, best.x, best.y, best.z) <= 1) return null;
    return best;
  }
  function flipBullet(b) {
    const o = b.owner;
    let dx = -b.dx, dy = -b.dy, dz = -b.dz;
    if (o && o.alive) {
      dx = o.x - b.x; dy = o.y + o.cy - b.y; dz = o.z - b.z;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    }
    b.team = 0; b.flipped = true; b.dx = dx; b.dy = dy; b.dz = dz;
    b.speed = Math.max(26, b.speed * 2.3); b.dmg = 4; b.r *= 1.3; b.life = 6; b.free = 0;
    spawnDrops(b.x, b.y, b.z, GOLD, 6, 2.2);
    sfx('flip');
  }

  function assistTarget() {
    let best = null, bc = -1;
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = e.x - eye.x, ey = e.y + e.cy - eye.y, ez = e.z - eye.z, d = Math.hypot(ex, ey, ez);
      if (d < 0.6 || d > 46) continue;
      const c = (ex * fwd.x + ey * fwd.y + ez * fwd.z) / d;
      const need = Math.cos(Math.min(0.22, 0.05 + Math.atan(e.r / d) * 0.95));
      if (c > need && c > bc && segHit(eye.x, eye.y, eye.z, e.x, e.y + e.cy, e.z) > 1) { best = e; bc = c; }
    }
    return best;
  }

  function fire() {
    if (P.reloadT > 0 || P.fireCd > 0) return;
    if (P.ammo <= 0) { startReload(); return; }
    P.fireCd = 0.17; P.ammo--;
    aimBasis();
    recoil = 1; flashT = 0.06;
    if (muzzle) { muzzle.visible = true; muzzle.material.rotation = rand(0, TAU); }

    const fb = findFlip();
    if (fb) {
      flipBullet(fb);
      pop('Sent back!');
    } else {
      let ax, ay, az;
      const tgt = assistTarget();
      if (tgt) {
        const lead = ts > 0.5 ? Math.hypot(tgt.x - eye.x, tgt.z - eye.z) / 46 : 0;
        ax = tgt.x + tgt.vx * lead; ay = tgt.y + tgt.cy; az = tgt.z + tgt.vz * lead;
      } else {
        const far = 60;
        let t = segHit(eye.x, eye.y, eye.z, eye.x + fwd.x * far, eye.y + fwd.y * far, eye.z + fwd.z * far);
        if (t > 1) t = 1;
        if (fwd.y < -0.01) t = Math.min(t, (eye.y / -fwd.y) / far);
        const d = Math.max(3, t * far);
        ax = eye.x + fwd.x * d; ay = eye.y + fwd.y * d; az = eye.z + fwd.z * d;
      }
      const mx = eye.x + right.x * 0.2 - up.x * 0.16 + fwd.x * 0.45;
      const my = eye.y - up.y * 0.16 + fwd.y * 0.45;
      const mz = eye.z + right.z * 0.2 - up.z * 0.16 + fwd.z * 0.45;
      let dx = ax - mx, dy = ay - my, dz = az - mz;
      const l = Math.hypot(dx, dy, dz) || 1;
      const b = spawnBullet(0, mx, my, mz, dx / l, dy / l, dz / l, 46, 0.1, 1, null);
      if (b && ts < 0.5) { b.free = 1.3; b.frozenShot = true; }
      sfx('shoot', 0.55, rand(0.95, 1.1));
    }
    if (P.ammo === 0) startReload();
  }

  function hurtPlayer(dmg, sx, sz) {
    if (state !== 'play') return;
    P.hp -= dmg; P.shake = 0.35; hurtA = 0.9; hud.hurt.style.opacity = 0.9;
    const dx = sx - P.x, dz = sz - P.z;
    const ang = Math.atan2(dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw), -dx * Math.sin(P.yaw) - dz * Math.cos(P.yaw));
    hud.dmg.style.transform = 'rotate(' + (ang * 180 / Math.PI).toFixed(1) + 'deg)';
    hud.dmg.style.opacity = 1; dmgT = 0.9;
    sfx('hurt');
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* not available */ }
    if (P.hp <= 0) gameOver();
  }

  // ------------------------------------------------------------------ enemies
  function enemyShoot(e) {
    const def = e.def, fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), rx = fz, rz = -fx;
    let ox, oy, oz;
    if (def.fly) { const off = def.fan ? 0 : e.side * 0.42 * def.scale; ox = e.x + rx * off + fx * 0.5; oy = e.y + def.cy; oz = e.z + rz * off + fz * 0.5; }
    else { ox = e.x - rx * 0.45 + fx * 0.75; oy = 0.95; oz = e.z - rz * 0.45 + fz * 0.75; }
    const speed = Math.min(def.bspeed + 5, def.bspeed + wave * 0.3);
    const d = Math.hypot(P.x - ox, P.z - oz), lead = Math.min(0.55, wave * 0.06) * d / speed;
    let dx = P.x + P.vx * lead - ox, dy = 1.15 - oy, dz = P.z + P.vz * lead - oz;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const n = def.fan || 1;
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * 0.17 + rand(-0.03, 0.03), ca = Math.cos(a), sa = Math.sin(a);
      spawnBullet(1, ox, oy, oz, dx * ca - dz * sa, dy + rand(-0.02, 0.02), dx * sa + dz * ca, speed, def.fan ? 0.15 : 0.13, def.dmg, e);
    }
    sfx('eshoot', clamp(1.2 - d / 26, 0.15, 0.8), def.fan ? 0.7 : rand(0.95, 1.1));
    if (!tut.freezeShown && wave === 1) { tut.freezeShown = true; hint(isTouch ? 'Tap FREEZE. Bullets stop, you don’t.' : 'Press Space to freeze. Bullets stop, you don’t.', 9); }
  }

  const tmpP = { x: 0, z: 0 };
  function updateEnemy(e, dtW, dt) {
    const def = e.def;
    if (e.flash > 0 && (e.flash -= dt) <= 0) for (const p of e.parts) p.material = p._base;
    if (dtW <= 0) return;
    if (e.spawnT < 1) {
      e.spawnT = Math.min(1, e.spawnT + dtW / 0.55);
      const k = e.spawnT - 1, s = 1 + 2.4 * k * k * k + 1.4 * k * k; // ease-out-back
      e.root.scale.setScalar(Math.max(0.001, s));
    }
    const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz) || 1e-4, ux = dx / dist, uz = dz / dist;
    let mx = 0, mz = 0, moving = false;

    if (def.melee) {
      if (e.wind > 0) {
        e.wind -= dtW;
        if (e.wind <= 0) { e.bang.visible = false; if (dist < 2.1) hurtPlayer(def.dmg, e.x, e.z); e.atkCd = 0.9; }
      } else {
        e.atkCd -= dtW;
        if (dist < 1.5 && e.atkCd <= 0) { e.wind = 0.32; e.bang.visible = true; }
        else if (dist > 1.25) { mx = ux; mz = uz; }
      }
    } else {
      if ((e.losT -= dtW) <= 0) {
        e.losT = 0.2;
        e.los = segHit(e.x, e.y + def.cy, e.z, P.x, EYE - 0.3, P.z) > 1;
      }
      if ((e.strafeT -= dtW) <= 0) { e.strafeT = rand(1.4, 3.2); e.strafe = -e.strafe; }
      if (e.burstT > 0 && (e.burstT -= dtW) <= 0) { e.side = -e.side; enemyShoot(e); }
      if (e.tele > 0) {
        e.tele -= dtW;
        e.bang.scale.setScalar(0.7 + 0.5 * (1 - e.tele / def.tele));
        if (e.tele <= 0) { e.bang.visible = false; enemyShoot(e); if (def.twin) e.burstT = 0.2; }
      } else {
        let f = 0;
        if (dist > def.far || (!def.fly && !e.los)) f = 1; else if (dist < def.near) f = -0.8;
        const sw = f === 0 ? 1 : 0.45;
        mx = ux * f - uz * e.strafe * sw; mz = uz * f + ux * e.strafe * sw;
        e.fireCd -= dtW;
        if (e.fireCd <= 0 && e.los && dist < 27 && e.spawnT >= 1) {
          e.tele = def.tele; e.bang.visible = true;
          e.fireCd = def.cd * Math.max(0.6, 1 - wave * 0.04) * rand(0.85, 1.25);
          if (!def.fly) { mx = 0; mz = 0; }
        }
      }
    }
    if (e.detourT > 0) { e.detourT -= dtW; mx = -uz * e.detourDir + ux * 0.25; mz = ux * e.detourDir + uz * 0.25; }

    const ml = Math.hypot(mx, mz);
    const px = e.x, pz = e.z;
    if (ml > 0.01) {
      const sp = def.speed * dtW / ml;
      e.x += mx * sp; e.z += mz * sp; moving = true;
    }
    // keep a little personal space from other doodles of the same kind (ground/air)
    for (const o of enemies) {
      if (o === e || !!o.def.fly !== !!def.fly) continue;
      const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz), min = e.r + o.r + 0.15;
      if (od < min && od > 1e-4) { const push = (min - od) * 0.5; e.x += ox / od * push; e.z += oz / od * push; }
    }
    if (def.fly) {
      const lim = ARENA - 1; e.x = clamp(e.x, -lim, lim); e.z = clamp(e.z, -lim, lim);
      e.phase += dtW * 2.2; e.y = def.fly + Math.sin(e.phase) * 0.3;
    } else {
      tmpP.x = e.x; tmpP.z = e.z; resolveCircle(tmpP, e.r * 0.85); e.x = tmpP.x; e.z = tmpP.z;
      if (moving) {
        const want = def.speed * dtW, got = Math.hypot(e.x - px, e.z - pz);
        if (got < want * 0.35) { if ((e.stuck += dtW) > 0.3) { e.stuck = 0; e.detourT = 0.9; e.detourDir = Math.random() < 0.5 ? -1 : 1; } }
        else e.stuck = 0;
      }
    }
    e.vx = (e.x - px) / dtW; e.vz = (e.z - pz) / dtW;

    let da = Math.atan2(ux, uz) - e.yaw;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    e.yaw += da * Math.min(1, dtW * 8);
    e.root.position.set(e.x, e.y, e.z);
    e.root.rotation.y = e.yaw;
    if (def.fly) e.model.rotation.x = Math.sin(e.phase * 0.7) * 0.08 + 0.12;
    if (e.mixer) {
      if (e.walk) {
        const w = clamp(Math.hypot(e.vx, e.vz) / def.speed, 0, 1);
        e.walk.setEffectiveWeight(w); e.idle.setEffectiveWeight(1 - w);
        e.walk.timeScale = def.melee ? 1.6 : 1;
      }
      e.mixer.update(dtW);
    }
  }

  function damageEnemy(e, b) {
    e.hp -= b.dmg;
    e.flash = 0.09;
    for (const p of e.parts) p.material = flashMat;
    hud.hitm.classList.remove('on'); void hud.hitm.offsetWidth; hud.hitm.classList.add('on');
    spawnDrops(b.x, b.y, b.z, BLUE, 5, 2.5);
    if (e.hp <= 0) killEnemy(e, b); else sfx('ehurt', 0.7);
  }

  function killEnemy(e, b) {
    e.alive = false;
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    // burst into its drawn parts
    e.root.updateMatrixWorld(true);
    for (const p of e.parts) {
      p.material = p._base;
      scene.attach(p);
      const a = rand(0, TAU), sp = rand(2, 5.5);
      debris.push({
        o: p, vx: Math.cos(a) * sp + (b ? b.dx * 4 : 0), vy: rand(3, 6.5), vz: Math.sin(a) * sp + (b ? b.dz * 4 : 0),
        ax: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), av: rand(4, 11), life: rand(2.2, 3.2), s: p.scale.x,
      });
    }
    scene.remove(e.root);
    e.bang.material.dispose();
    if (e.mixer) e.mixer.stopAllAction();
    spawnDrops(e.x, e.y + e.cy, e.z, INKC, 14, 4.5);
    addSplat(e.x, e.z, e.r * rand(1.4, 2), INKC);
    sfx('edie', 0.8, rand(0.9, 1.1));

    combo = comboT > 0 ? combo + 1 : 1; comboT = 3;
    let pts = e.def.score, label = '';
    if (b && b.flipped) { pts += 150; label = 'Return to sender '; }
    else if (b && b.frozenShot) { pts += 50; label = 'Freeze shot '; }
    pts = Math.round(pts * (1 + 0.25 * (combo - 1)));
    score += pts;
    pop(label + '+' + pts + (combo > 1 ? '  x' + combo : ''));
    P.energy = Math.min(100, P.energy + 12);
  }

  function updateDebris(dtW) {
    if (dtW <= 0) return;
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], o = d.o;
      d.vy -= 15 * dtW;
      o.position.x += d.vx * dtW; o.position.y += d.vy * dtW; o.position.z += d.vz * dtW;
      if (o.position.y < 0.12) { o.position.y = 0.12; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.av *= 0.5; }
      o.rotateOnWorldAxis(d.ax, d.av * dtW);
      d.life -= dtW;
      if (d.life < 0.5) o.scale.setScalar(Math.max(0.001, d.s * d.life / 0.5));
      if (d.life <= 0) { scene.remove(o); debris.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------------ bullets
  function updateBullets(dtW, dt) {
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      let step = b.speed * dtW;
      if (b.free > 0) { const extra = Math.min(b.free, b.speed * dt * (1 - ts)); b.free -= extra; step += extra; }
      if (step < 1e-6) continue;
      b.life -= step / b.speed;
      const nx = b.x + b.dx * step, ny = b.y + b.dy * step, nz = b.z + b.dz * step;
      let hitT = 2, kind = 0, victim = null;
      const tw = segHit(b.x, b.y, b.z, nx, ny, nz);
      if (tw <= 1) { hitT = tw; kind = 1; }
      if (ny < 0.04 && b.y > ny) { const tf = (b.y - 0.04) / (b.y - ny); if (tf < hitT) { hitT = Math.max(0, tf); kind = 2; } }
      const sx = nx - b.x, sy = ny - b.y, sz = nz - b.z, sl2 = step * step;
      if (b.team === 0) {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          const cx = e.x - b.x, cy = e.y + e.cy - b.y, cz = e.z - b.z;
          const t = clamp((cx * sx + cy * sy + cz * sz) / sl2, 0, 1);
          const qx = cx - sx * t, qy = cy - sy * t, qz = cz - sz * t, R = e.r + b.r;
          if (qx * qx + qy * qy + qz * qz < R * R && t < hitT) { hitT = t; kind = 3; victim = e; }
        }
      } else if (state === 'play' && ts > 0.05) {
        const cx = P.x - b.x, cz = P.z - b.z, h2 = sx * sx + sz * sz;
        const t = h2 > 1e-9 ? clamp((cx * sx + cz * sz) / h2, 0, 1) : 0;
        const qx = cx - sx * t, qz = cz - sz * t, yy = b.y + sy * t, R = 0.4 + b.r;
        if (qx * qx + qz * qz < R * R && yy > 0.1 && yy < 1.85 && t < hitT) { hitT = t; kind = 4; }
      }
      if (kind) {
        b.x += sx * hitT; b.y += sy * hitT; b.z += sz * hitT;
        b.alive = false;
        const c = b.team === 0 ? BLUE : RED;
        if (kind === 3) damageEnemy(victim, b);
        else if (kind === 4) hurtPlayer(b.dmg, b.owner ? b.owner.x : b.x - b.dx, b.owner ? b.owner.z : b.z - b.dz);
        else { spawnDrops(b.x, Math.max(0.05, b.y), b.z, c, 4, 1.8); if (kind === 2) addSplat(b.x, b.z, rand(0.16, 0.3), c); }
        continue;
      }
      b.x = nx; b.y = ny; b.z = nz;
      const out = Math.abs(b.x) > ARENA || Math.abs(b.z) > ARENA;
      if ((out && b.y < HI.h) || b.life <= 0) {
        b.alive = false;
        if (out) spawnDrops(clamp(b.x, -ARENA, ARENA), b.y, clamp(b.z, -ARENA, ARENA), b.team === 0 ? BLUE : RED, 4, 1.8);
      }
    }
  }

  const bq = new THREE.Quaternion(), bz = new THREE.Vector3(0, 0, 1), bd = new THREE.Vector3();
  function drawInk() {
    let n = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      bd.set(b.dx, b.dy, b.dz); bq.setFromUnitVectors(bz, bd);
      const st = Math.min(3.2, b.speed * 0.055 * (b.free > 0 ? 1 : ts));
      let r = b.r;
      if (b.team === 1 && ts < 0.6) r *= 1 + 0.16 * Math.sin(realClock * 7 + b.id);
      _p.set(b.x - b.dx * r * st, b.y - b.dy * r * st, b.z - b.dz * r * st);
      _m.compose(_p, bq, _s.set(r, r, r * (1 + st)));
      bulletFill.setMatrixAt(n, _m);
      bulletFill.setColorAt(n, b.team === 0 ? BLUE : RED);
      const lr = r + 0.03 + 0.0035 * Math.hypot(b.x - camera.position.x, b.z - camera.position.z);
      _m.compose(_p, bq, _s.set(lr, lr, r * (1 + st) + (lr - r)));
      bulletLine.setMatrixAt(n, _m);
      n++;
    }
    bulletFill.count = bulletLine.count = n;
    bulletFill.instanceMatrix.needsUpdate = bulletLine.instanceMatrix.needsUpdate = true;
    bulletFill.instanceColor.needsUpdate = true;

    n = 0;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.alive) continue;
      const r = d.r * Math.min(1, d.life * 3);
      _m.makeScale(r, r, r); _m.setPosition(d.x, d.y, d.z);
      dropMesh.setMatrixAt(n, _m); dropMesh.setColorAt(n, d.color); n++;
    }
    dropMesh.count = n;
    dropMesh.instanceMatrix.needsUpdate = true; dropMesh.instanceColor.needsUpdate = true;

    n = 0;
    for (let i = 0; i < enemies.length && n < MAXSH; i++) {
      const e = enemies[i], s = e.r * (e.def.fly ? 2.2 : 3) * Math.min(1, e.spawnT * 1.2);
      _m.makeScale(s, 1, s); _m.setPosition(e.x, 0.03, e.z);
      shadowMesh.setMatrixAt(n++, _m);
    }
    shadowMesh.count = n; shadowMesh.instanceMatrix.needsUpdate = true;
  }

  function updateDrops(dtW) {
    if (dtW <= 0) return;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.alive) continue;
      d.vy -= 12 * dtW; d.x += d.vx * dtW; d.y += d.vy * dtW; d.z += d.vz * dtW;
      d.life -= dtW;
      if (d.y < 0.02) { d.alive = false; if (Math.random() < 0.3) addSplat(d.x, d.z, d.r * 2.2, d.color); }
      else if (d.life <= 0) d.alive = false;
    }
  }

  // ------------------------------------------------------------------ flow
  const sheets = { menu: $('menu'), pause: $('pause'), over: $('over'), scrim: $('pscrim'), hud: $('hud') };
  function show(el, on) { el.hidden = !on; }

  function clearEnemies() {
    for (const e of enemies) { scene.remove(e.root); e.bang.material.dispose(); }
    enemies.length = 0;
    for (const d of debris) scene.remove(d.o);
    debris.length = 0;
  }

  function startWave(n) {
    wave = n;
    queue = composeWave(n);
    maxAlive = Math.min(8, 3 + Math.floor(n / 2));
    spawnCd = 0.6;
    banner('Page ' + n, n === 1 ? 'Erase every doodle' : queue.length + ' doodles incoming', 2);
    if (n === 1) hint(isTouch ? 'Left thumb moves. Right thumb aims. Hold FIRE to shoot.' : 'Click to grab the mouse, then aim and shoot.', 5);
  }

  function startGame() {
    initAudio();
    clearEnemies(); clearInk();
    Object.assign(P, { x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, energy: 100, ammo: MAG, reloadT: 0, fireCd: 0, vx: 0, vz: 0, bob: 0, shake: 0 });
    score = 0; combo = 0; comboT = 0; betweenT = 0;
    frozen = false; ts = 1; gameEl.classList.remove('frozen');
    tut.freezeShown = tut.usedFreeze; // only teach until it has been used once
    camera.clearViewOffset();
    state = 'play';
    show(sheets.menu, false); show(sheets.over, false); show(sheets.pause, false); show(sheets.scrim, false); show(sheets.hud, true);
    gameEl.classList.add('playing');
    input.fire = false; input.mx = input.my = 0;
    startWave(1);
    if (!isTouch) lockPointer();
  }

  function gameOver() {
    state = 'over';
    frozen = true; gameEl.classList.add('frozen'); gameEl.classList.remove('playing');
    releasePointer();
    hud.hint.classList.remove('on'); hud.banner.classList.remove('on'); endJoy(); input.fire = false;
    sfx('over');
    const isBest = score > best;
    if (isBest) { best = score; try { localStorage.setItem('doodlefreeze.best', String(best)); } catch (e) { /* storage unavailable */ } }
    $('oscore').textContent = score;
    $('osub').textContent = 'You reached page ' + wave + '. ' + (isBest && score > 0 ? 'New best!' : 'Best ' + best + '.');
    show(sheets.over, true); show(sheets.scrim, true);
    $('again').focus({ preventScroll: true });
  }

  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause'; releasePointer(); gameEl.classList.remove('playing');
    input.fire = false; endJoy();
    show(sheets.pause, true); show(sheets.scrim, true);
  }
  function resumeGame() {
    if (state !== 'pause') return;
    state = 'play'; gameEl.classList.add('playing');
    show(sheets.pause, false); show(sheets.scrim, false);
    if (!isTouch) lockPointer();
  }

  function toMenu() {
    state = 'menu';
    releasePointer();
    gameEl.classList.remove('playing');
    show(sheets.pause, false); show(sheets.over, false); show(sheets.scrim, false); show(sheets.hud, false); show(sheets.menu, true);
    $('best').textContent = best ? 'Best ' + best : '';
    buildTableau();
  }

  // The title screen is the pitch: a frozen stand-off with bullets hanging mid-air.
  function buildTableau() {
    clearEnemies(); clearInk();
    frozen = true; ts = 0; gameEl.classList.add('frozen');
    const cast = [['walker', 3.6, -6.2], ['walker', -4.6, -5.2], ['drone', 0.6, -8.2], ['rusher', -1.4, -3.6], ['spreader', 6.5, -10.5]];
    const target = new THREE.Vector3(0.6, 1.3, 2.2);
    for (const c of cast) {
      const e = makeEnemy(c[0], c[1], c[2]);
      e.spawnT = 1; e.yaw = Math.atan2(target.x - e.x, target.z - e.z);
      e.root.rotation.y = e.yaw; e.root.position.set(e.x, e.y, e.z);
      if (e.mixer) e.mixer.update(rand(0, 0.4));
      if (e.def.melee) continue;
      const n = e.def.fan ? 5 : 3;
      for (let k = 0; k < n; k++) {
        const ox = e.x, oy = e.y + e.def.cy, oz = e.z;
        let dx = target.x - ox + rand(-1.6, 1.6), dy = target.y - oy + rand(-0.5, 0.5), dz = target.z - oz + rand(-1, 1);
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        const f = rand(0.2, 0.85) * l;
        spawnBullet(1, ox + dx * f, oy + dy * f, oz + dz * f, dx, dy, dz, 11, 0.14, 10, e);
      }
    }
    for (let k = 0; k < 4; k++) {
      const e = enemies[k % 3];
      let dx = e.x - target.x, dy = e.y + e.cy - target.y, dz = e.z - target.z;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const f = 1.2 + k * 0.9;
      spawnBullet(0, target.x + dx * f + rand(-0.3, 0.3), target.y + dy * f, target.z + dz * f, dx, dy, dz, 46, 0.1, 1, null);
    }
  }

  // ------------------------------------------------------------------ input
  let isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);
  gameEl.classList.toggle('touch', isTouch);
  const input = { jx: 0, jy: 0, fire: false, mx: 0, my: 0, keys: {} };
  let sens = 1, locked = false, movePtr = null, lookPtr = null, firePtr = null, joyOX = 0, joyOY = 0, lastLX = 0, lastLY = 0, lastFX = 0, lastFY = 0;
  const touchEl = $('touch'), joyEl = $('joy'), knobEl = $('knob');

  try {
    const s = +localStorage.getItem('doodlefreeze.sens'); if (s >= 40 && s <= 220) { sens = s / 100; $('sens').value = s; }
    if (localStorage.getItem('doodlefreeze.snd') === '0') { soundOn = false; $('snd').checked = false; }
  } catch (e) { /* storage unavailable */ }

  function lockPointer() {
    if (!canvas.requestPointerLock) return;
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* optional */ }
  }
  function releasePointer() { if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock(); }
  document.addEventListener('pointerlockchange', () => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    if (was && !locked && state === 'play') pauseGame();
  });

  function setTouch() { if (!isTouch) { isTouch = true; gameEl.classList.add('touch'); resize(); } }
  function rel(e) { const r = gameEl.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; }
  function endJoy() { movePtr = null; input.jx = input.jy = 0; joyEl.hidden = true; }
  const JR = 52;

  touchEl.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      if (e.button === 2) { setFrozen(!frozen); return; }
      if (e.button === 0) { input.fire = true; if (!locked) lockPointer(); }
      return;
    }
    setTouch();
    try { touchEl.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    const p = rel(e);
    if (p[0] < p[2] * 0.45 && movePtr === null) {
      movePtr = e.pointerId; joyOX = p[0]; joyOY = p[1];
      joyEl.hidden = false; joyEl.style.left = joyOX + 'px'; joyEl.style.top = joyOY + 'px'; knobEl.style.transform = '';
    } else if (lookPtr === null) { lookPtr = e.pointerId; lastLX = e.clientX; lastLY = e.clientY; }
  });
  touchEl.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      if (state === 'play' && (locked || (e.buttons & 1))) { input.mx += e.movementX || 0; input.my += e.movementY || 0; }
      return;
    }
    if (e.pointerId === movePtr) {
      const p = rel(e);
      let dx = p[0] - joyOX, dy = p[1] - joyOY;
      const l = Math.hypot(dx, dy);
      if (l > JR) { dx *= JR / l; dy *= JR / l; }
      input.jx = dx / JR; input.jy = dy / JR;
      knobEl.style.transform = 'translate(' + dx.toFixed(0) + 'px,' + dy.toFixed(0) + 'px)';
    } else if (e.pointerId === lookPtr) {
      input.mx += (e.clientX - lastLX) * 2.4; input.my += (e.clientY - lastLY) * 2.4;
      lastLX = e.clientX; lastLY = e.clientY;
    }
  });
  const touchEnd = (e) => {
    if (e.pointerType === 'mouse') { if (e.button === 0) input.fire = false; return; }
    if (e.pointerId === movePtr) endJoy();
    if (e.pointerId === lookPtr) lookPtr = null;
  };
  touchEl.addEventListener('pointerup', touchEnd);
  touchEl.addEventListener('pointercancel', touchEnd);
  document.addEventListener('mousemove', (e) => { if (locked && state === 'play' && e.target !== touchEl) { input.mx += e.movementX; input.my += e.movementY; } });
  document.addEventListener('mousedown', (e) => {
    if (!locked || state !== 'play') return; // with the pointer locked, clicks land on the canvas, not the touch layer
    if (e.button === 0) input.fire = true; else if (e.button === 2) setFrozen(!frozen);
  });
  document.addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });
  gameEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // FIRE doubles as an aim pad: hold it and drag to keep tracking a target.
  hud.fire.addEventListener('pointerdown', (e) => {
    e.preventDefault(); setTouch();
    try { hud.fire.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    firePtr = e.pointerId; lastFX = e.clientX; lastFY = e.clientY; input.fire = true; hud.fire.classList.add('down');
  });
  hud.fire.addEventListener('pointermove', (e) => {
    if (e.pointerId !== firePtr) return;
    input.mx += (e.clientX - lastFX) * 2.4; input.my += (e.clientY - lastFY) * 2.4;
    lastFX = e.clientX; lastFY = e.clientY;
  });
  const fireEnd = (e) => { if (e.pointerId === firePtr) { firePtr = null; input.fire = false; hud.fire.classList.remove('down'); } };
  hud.fire.addEventListener('pointerup', fireEnd);
  hud.fire.addEventListener('pointercancel', fireEnd);
  hud.freeze.addEventListener('pointerdown', (e) => { e.preventDefault(); setTouch(); if (state === 'play') setFrozen(!frozen); });
  $('reload').addEventListener('pointerdown', (e) => { e.preventDefault(); if (state === 'play') startReload(); });

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    input.keys[e.code] = true;
    if (e.repeat) return;
    if (state === 'play') {
      if (e.code === 'Space' || e.code === 'KeyF' || e.code === 'ShiftLeft' || e.code === 'KeyQ') { e.preventDefault(); setFrozen(!frozen); }
      else if (e.code === 'KeyR') startReload();
      else if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
    } else if (state === 'pause' && (e.code === 'KeyP' || e.code === 'Escape')) resumeGame();
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
  window.addEventListener('blur', () => { input.keys = {}; input.fire = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

  $('play').addEventListener('click', () => { if (state === 'menu') startGame(); });
  $('again').addEventListener('click', startGame);
  $('tomenu').addEventListener('click', toMenu);
  $('quit').addEventListener('click', toMenu);
  $('resume').addEventListener('click', resumeGame);
  $('pausebtn').addEventListener('click', pauseGame);
  $('sens').addEventListener('input', (e) => { sens = e.target.value / 100; try { localStorage.setItem('doodlefreeze.sens', e.target.value); } catch (err) { /* storage unavailable */ } });
  $('snd').addEventListener('change', (e) => {
    soundOn = e.target.checked; if (master) master.gain.value = soundOn ? 0.8 : 0;
    try { localStorage.setItem('doodlefreeze.snd', soundOn ? '1' : '0'); } catch (err) { /* storage unavailable */ }
  });

  // ------------------------------------------------------------------ per-frame update
  function updatePlay(dt) {
    // look
    const k = 0.0022 * sens;
    P.yaw -= input.mx * k; P.pitch = clamp(P.pitch - input.my * k, -1.35, 1.35);
    swayX += (clamp(-input.mx * 0.0006, -0.05, 0.05) - swayX) * Math.min(1, dt * 10);
    swayY += (clamp(input.my * 0.0006, -0.05, 0.05) - swayY) * Math.min(1, dt * 10);
    input.mx = input.my = 0;

    // move (always real time: the page freezes, you do not)
    let f = -input.jy, s = input.jx;
    const K = input.keys;
    if (K.KeyW || K.ArrowUp) f += 1; if (K.KeyS || K.ArrowDown) f -= 1;
    if (K.KeyD || K.ArrowRight) s += 1; if (K.KeyA || K.ArrowLeft) s -= 1;
    const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), SPEED = 5.6;
    const tvx = (-sy * f + cy * s) * SPEED, tvz = (-cy * f - sy * s) * SPEED;
    const acc = Math.min(1, dt * 14);
    P.vx += (tvx - P.vx) * acc; P.vz += (tvz - P.vz) * acc;
    P.x += P.vx * dt; P.z += P.vz * dt;
    for (const e of enemies) {
      if (e.def.fly) continue;
      const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz), min = e.r + 0.3;
      if (d < min && d > 1e-4) { P.x = e.x + dx / d * min; P.z = e.z + dz / d * min; }
    }
    resolveCircle(P, 0.4);
    P.bob += Math.hypot(P.vx, P.vz) * dt * 1.7;

    // time
    if (frozen) {
      P.energy -= 27 * dt; P.sinceFreeze = 0;
      if ((tickT -= dt) <= 0) { tickT = 0.5; sfx('tick'); }
      if (P.energy <= 0) { P.energy = 0; setFrozen(false); }
    } else {
      P.sinceFreeze += dt;
      if (P.sinceFreeze > 0.6) P.energy = Math.min(100, P.energy + 8.5 * dt);
    }
    ts += ((frozen ? 0 : 1) - ts) * Math.min(1, dt * (frozen ? 16 : 9));
    if (frozen && ts < 0.002) ts = 0;
    if (!frozen && ts > 0.998) ts = 1;
    const dtW = dt * ts;
    worldClock += dtW;

    // gun
    P.fireCd -= dt;
    if (P.reloadT > 0 && (P.reloadT -= dt) <= 0) { P.ammo = MAG; }
    if (input.fire) fire();
    aimBasis();
    const flipNow = !!findFlip();
    if (cache.flip !== flipNow) { cache.flip = flipNow; hud.cross.classList.toggle('flip', flipNow); }

    // world
    if (queue.length && enemies.length < maxAlive && (spawnCd -= dtW) <= 0) {
      const p = spawnPoint();
      const e = makeEnemy(queue.pop(), p[0], p[1]);
      spawnDrops(e.x, e.y + e.cy, e.z, INKC, 8, 3);
      spawnCd = rand(0.5, 1.1);
    }
    for (let i = enemies.length - 1; i >= 0; i--) updateEnemy(enemies[i], dtW, dt);
    updateBullets(dtW, dt);
    updateDrops(dtW); updateDebris(dtW); updateClouds(dtW);

    if (comboT > 0 && (comboT -= dt) <= 0) combo = 0;
    if (state === 'play' && !queue.length && !enemies.length) {
      if (betweenT <= 0) {
        betweenT = 2.8; P.hp = Math.min(100, P.hp + 30); score += 100 * wave;
        banner('Page ' + wave + ' clear', '+30 health · +' + 100 * wave + ' points', 2.2); sfx('clear');
      } else if ((betweenT -= dt) <= 0) { betweenT = 0; startWave(wave + 1); }
    }

    // camera
    P.shake = Math.max(0, P.shake - dt);
    const sh = P.shake * 0.12, moveAmt = Math.min(1, Math.hypot(P.vx, P.vz) / SPEED);
    camera.position.set(P.x + rand(-sh, sh), EYE + Math.sin(P.bob * 2) * 0.035 * moveAmt + rand(-sh, sh), P.z);
    camera.rotation.set(P.pitch + rand(-sh, sh) * 0.3, P.yaw, 0);

    // blaster
    if (gun) {
      recoil = Math.max(0, recoil - dt * 9);
      gunDip += ((P.reloadT > 0 ? 1 : 0) - gunDip) * Math.min(1, dt * 12);
      if (flashT > 0 && (flashT -= dt) <= 0) muzzle.visible = false;
      gun.position.set(gunX + swayX + Math.cos(P.bob) * 0.012 * moveAmt, -0.3 + swayY - gunDip * 0.3 + Math.abs(Math.sin(P.bob)) * 0.014 * moveAmt, -0.74 + recoil * 0.08);
      gun.rotation.set(recoil * 0.16 - gunDip * 0.7, 0.05 + swayX * 2, 0);
    }
    updateHUD(dt);
  }

  let menuT = 0;
  function updateMenu(dt) {
    menuT += dt;
    const a = Math.sin(menuT * 0.16) * 0.42 + 0.2;
    camera.position.set(0.6 + Math.sin(a) * 7.2, 2.3 + Math.sin(menuT * 0.23) * 0.25, -2.2 + Math.cos(a) * 9.2);
    camera.lookAt(0.8, 1.5, -4.5);
  }

  function resize() {
    const w = Math.max(1, gameEl.clientWidth), h = Math.max(1, gameEl.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const aspect = w / h;
    // keep at least ~62 degrees of horizontal view when the phone is upright
    let vfov = 68;
    if (aspect < 1) vfov = clamp(2 * Math.atan(Math.tan(62 * Math.PI / 360) / aspect) * 180 / Math.PI, 68, 96);
    camera.fov = vfov; camera.aspect = aspect; camera.updateProjectionMatrix();
    vmCam.fov = aspect < 1 ? 85 : 50; // upright phones: pull the blaster back so it does not fill the screen
    vmCam.aspect = aspect; vmCam.updateProjectionMatrix();
    U.px.value = 2 * Math.tan(vfov * Math.PI / 360) / h;
    viewW = w; viewH = h;
    gunX = isTouch ? 0.09 : 0.22; // on phones, keep the blaster clear of the thumb buttons
  }
  let viewW = 1, viewH = 1, gunX = 0.2;
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(gameEl);

  const clearC = new THREE.Color();
  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    realClock += dt;
    if (state === 'play') updatePlay(dt);
    else if (state === 'menu') updateMenu(dt);
    else if (state === 'over') { ts += (0 - ts) * Math.min(1, dt * 6); updateHUD(dt); }

    U.boil.value = worldClock * 9 + 100;
    U.boilVM.value = realClock * 9;
    U.desat.value = (1 - ts) * DESAT_MAX;
    U.fog.value.copy(paperCol).lerp(frostCol, U.desat.value);
    clearC.copy(U.fog.value); renderer.setClearColor(clearC);

    if (state === 'menu' && viewW > viewH * 1.15) camera.setViewOffset(viewW, viewH, -viewW * 0.17, 0, viewW, viewH);
    else if (camera.view) camera.clearViewOffset();

    drawInk();
    renderer.clear();
    renderer.render(scene, camera);
    if (gun && (state === 'play' || state === 'pause')) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
  }

  // ------------------------------------------------------------------ boot
  resize();
  loadAll().then(() => {
    bangTex = bangTexture(); flashTex = flashTexture();
    Object.keys(models).forEach((k) => prep(models[k]));
    buildWorld(); buildPools(); buildViewModel();
    const btn = $('play');
    btn.disabled = false; btn.textContent = 'Play';
    toMenu();
    last = performance.now();
    requestAnimationFrame(frame);
  }).catch((err) => {
    $('play').textContent = 'Stuck';
    $('loadmsg').textContent = 'Could not load ' + (err && err.message ? err.message : 'the game files') + '. Check the connection and reload.';
  });

  // small hook for automated checks
  window.__doodle = { P, enemies, bullets, get state() { return state; }, get ts() { return ts; }, get wave() { return wave; }, get score() { return score; }, setFrozen, start: startGame };
})();
