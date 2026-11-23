/* Standstill — a first-person shooter where the clock only runs while you move.
   three.js r128 (global build) + Kenney models/sounds. No build step. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;

  // Mirrors the CSS tokens in index.html.
  const C = {
    bg: 0x0d1524, floor: 0x0f192b, wall: 0x1c2c4a, far: 0x142038, line: 0xa9c8ff,
    gunner: 0xffb224, rusher: 0xff7d3c, drone: 0xffd166, spreader: 0xffe9a6, rim: 0xfff3d6,
    shot: 0xff3d6e, you: 0x8ef6ff, gun: 0xd4def0,
  };
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
  renderer.setClearColor(C.bg);

  // ------------------------------------------------------------------ world constants
  const S = 1.4;                       // scale applied to the wall pieces
  const HI = { w: 1.5 * S, d: 0.7 * S, h: 1.7 * S };
  const LO = { w: 2.2 * S, d: 0.7 * S, h: 0.8 * S };
  const TILES = 14;                    // perimeter wall tiles per side
  const ARENA = TILES * HI.w / 2;      // half-size of the square room
  const EYE = 1.55;
  const IDLE = 0.04;                   // how fast the clock crawls when you hold still
  const SPEED = 5.6;
  const FIRE_CD = 0.42;                // seconds of *world* time between your shots

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.bg, 16, 58);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.08, 200);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7f93bd, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  // First-person blaster lives in its own scene so it never pokes through walls.
  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(50, 1, 0.02, 10);
  vmScene.add(new THREE.HemisphereLight(0xffffff, 0x7f93bd, 0.95));
  const vmSun = new THREE.DirectionalLight(0xffffff, 0.5);
  vmSun.position.set(2, 4, 3);
  vmScene.add(vmSun);

  // ------------------------------------------------------------------ materials
  // dim: 0 while the clock runs, up to DIM_MAX when it crawls. The room cools and darkens;
  // bullets are left out of it so they stay the brightest things on screen.
  const bgCol = new THREE.Color(C.bg);
  const DIM_TINT = [0.72, 0.84, 1.12];
  const bgDim = (() => {
    const l = bgCol.r * 0.299 + bgCol.g * 0.587 + bgCol.b * 0.114;
    return new THREE.Color(l * DIM_TINT[0], l * DIM_TINT[1], l * DIM_TINT[2]);
  })();
  const U = { dim: { value: 0 }, px: { value: 0.003 }, fog: { value: bgCol.clone() } };
  const DIM_MAX = 0.5;

  function patch(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDim = U.dim;
      sh.fragmentShader = 'uniform float uDim;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n' +
        '  float dl_ = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
        '  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dl_) * vec3(' + DIM_TINT.join(', ') + '), uDim);'
      );
    };
    return mat;
  }

  const grad = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.LuminanceFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.generateMipmaps = false;
  grad.needsUpdate = true;

  // Everything is a flat colour with three hard shading steps. No textures.
  const flatCache = new Map();
  // vivid: skip the dimming, for things that must stay readable while the clock crawls (hostiles)
  function flat(hex, inst, vivid) {
    const key = hex + ':' + (inst ? 1 : 0) + (vivid ? 'v' : '');
    let m = flatCache.get(key);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color: col(hex), gradientMap: grad });
      if (!vivid) patch(m);
      flatCache.set(key, m);
    }
    return m;
  }

  // Edge lines: back faces pushed out along smoothed normals, a constant few pixels wide.
  function makeOutline(hex, width, fogged) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uPx: U.px, uW: { value: width }, uInk: { value: new THREE.Color(hex) }, uFog: U.fog, uNear: { value: fogged ? 16 : 900 }, uFar: { value: fogged ? 58 : 1000 } },
      vertexShader: [
        'attribute vec3 snormal;',
        'uniform float uPx, uW;',
        'varying float vD;',
        'void main() {',
        '  #ifdef USE_INSTANCING',
        '    mat4 mm = modelViewMatrix * instanceMatrix;',
        '  #else',
        '    mat4 mm = modelViewMatrix;',
        '  #endif',
        '  vec4 mv = mm * vec4(position, 1.0);',
        '  vec3 n = normalize(mat3(mm) * snormal);',
        '  float d = max(-mv.z, 0.0);',
        '  mv.xyz += n * clamp(d * uPx * uW, 0.002, 0.35);',
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
  const lineWorld = makeOutline(C.line, 1.5, true);   // instanced room geometry
  const lineBody = makeOutline(C.rim, 2.0, true);     // hostiles and their debris
  const lineVM = makeOutline(C.line, 1.6, false);     // your blaster

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

  // Strip a loaded model down to flat fills, and give every mesh an edge-line child.
  function prep(root) {
    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      m.material = flat(C.wall);
      addSmoothNormals(m.geometry);
      const o = new THREE.Mesh(m.geometry, lineBody);
      o.userData.ol = true;
      m.add(o);
    }
    return root;
  }
  const fillMeshes = (root) => { const a = []; root.traverse((o) => { if (o.isMesh && !o.userData.ol) a.push(o); }); return a; };
  function paint(root, fillMat, lineMat) {
    root.traverse((o) => { if (o.isMesh) o.material = o.userData.ol ? lineMat : fillMat; });
    return root;
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function trs(x, y, z, ry, sx, sy, sz) {
    _e.set(0, ry, 0); _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
  }
  function instancedFrom(root, matrices, hex) {
    root.updateMatrixWorld(true);
    const src = fillMeshes(root)[0];
    const n = matrices.length;
    const fill = new THREE.InstancedMesh(src.geometry, flat(hex, true), n);
    const line = new THREE.InstancedMesh(src.geometry, lineWorld, n);
    matrices.forEach((mat, i) => { _m.multiplyMatrices(mat, src.matrixWorld); fill.setMatrixAt(i, _m); line.setMatrixAt(i, _m); });
    fill.frustumCulled = line.frustumCulled = false;
    const g = new THREE.Group();
    g.add(fill, line);
    return g;
  }

  // ------------------------------------------------------------------ small drawn textures
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
      g.fillStyle = '#0f192b'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        const c = i * 128;
        g.fillStyle = i === 0 ? 'rgba(169,200,255,.42)' : 'rgba(169,200,255,.16)';
        g.fillRect(c, 0, i === 0 ? 3 : 2, h); g.fillRect(0, c, w, i === 0 ? 3 : 2);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(240 / 4.2, 240 / 4.2);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  // Countdown ring shown over a hostile that is about to fire.
  function warnTexture() {
    return canvasTex(128, 128, (g) => {
      g.strokeStyle = '#ff3d6e'; g.lineWidth = 10;
      g.beginPath(); g.arc(64, 64, 50, 0, TAU); g.stroke();
      g.fillStyle = '#ff3d6e'; g.beginPath(); g.arc(64, 64, 14, 0, TAU); g.fill();
    });
  }
  function flashTexture() {
    return canvasTex(128, 128, (g) => {
      g.translate(64, 64); g.fillStyle = '#e8fdff';
      g.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8, r = i % 2 ? 12 : 60; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill();
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

  // ------------------------------------------------------------------ rooms
  function buildShell() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), patch(new THREE.MeshBasicMaterial({ map: floorTexture() })));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const edge = [];
    for (let i = 0; i < TILES; i++) {
      const p = -ARENA + HI.w * (i + 0.5), o = ARENA + HI.d / 2;
      edge.push(trs(p, 0, -o, 0, S), trs(p, 0, o, 0, S), trs(-o, 0, p, Math.PI / 2, S), trs(o, 0, p, Math.PI / 2, S));
    }
    scene.add(instancedFrom(models.wallHigh, edge, C.wall));

    // silent slabs out in the dark, for depth
    const far = [];
    for (let i = 0; i < 34; i++) {
      const a = i / 34 * TAU + rand(-0.06, 0.06), r = rand(ARENA + 9, 52);
      far.push(trs(Math.cos(a) * r, 0, Math.sin(a) * r, rand(0, TAU), rand(2.5, 7), rand(5, 26), rand(2.5, 7)));
    }
    scene.add(instancedFrom(models.brick, far, C.far));
  }

  // Each layout places a handful of pieces in one quadrant; they are mirrored into all four.
  const LAYOUTS = [
    (w, b) => { w('lo', 4.4, 0, 1); w('hi', 7.4, 7.4, 0); b(10.6, -3.6, 2); w('lo', 10.4, 10.9, 0); },
    (w, b) => { w('hi', 4.3, 4.3, 0); w('lo', 9.6, 0, 1); b(11.2, 8.2, 1); b(6.2, -11, 2); },
    (w, b) => { w('lo', 3.2, 5.6, 0); w('hi', 9.2, 2.2, 1); b(11.6, 11.6, 2); b(11.6 - S, 11.6, 1); },
    (w, b) => { b(3.6, 3.6, 1); w('lo', 8.2, -4.2, 1); w('hi', 11, 6.2, 0); w('lo', 5.2, 11.4, 0); },
  ];
  let coverGroup = null, layoutNow = -1;
  function buildCover(index) {
    if (index === layoutNow) return;
    layoutNow = index;
    if (coverGroup) {
      scene.remove(coverGroup);
      coverGroup.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    }
    obstacles.length = 0;
    const lists = { hi: [], lo: [], br: [] };
    const rot = (x, z, q) => { for (let i = 0; i < q; i++) { const t = x; x = -z; z = t; } return [x, z]; };
    const wall = (kind, x, z, r) => {
      const dim = kind === 'hi' ? HI : LO;
      for (let q = 0; q < 4; q++) {
        const p = rot(x, z, q), turned = (r + q) % 2 === 1;
        lists[kind].push(trs(p[0], 0, p[1], turned ? Math.PI / 2 : 0, S));
        addBox(p[0], p[1], (turned ? dim.d : dim.w) / 2, (turned ? dim.w : dim.d) / 2, dim.h);
      }
    };
    const bricks = (x, z, n) => {
      for (let q = 0; q < 4; q++) {
        const p = rot(x, z, q);
        for (let i = 0; i < n; i++) lists.br.push(trs(p[0], i * S, p[1], 0, S));
        addBox(p[0], p[1], S / 2, S / 2, n * S);
      }
    };
    LAYOUTS[index](wall, bricks);
    coverGroup = new THREE.Group();
    if (lists.hi.length) coverGroup.add(instancedFrom(models.wallHigh, lists.hi, C.wall));
    if (lists.lo.length) coverGroup.add(instancedFrom(models.wallLow, lists.lo, C.wall));
    if (lists.br.length) coverGroup.add(instancedFrom(models.brick, lists.br, C.wall));
    scene.add(coverGroup);
  }

  // ------------------------------------------------------------------ pooled bullets, sparks, shadows
  const MAXB = 200;
  const bullets = [];
  let bulletHead, bulletTrail, bulletSeq = 0;
  const YOU = col(C.you), SHOT = col(C.shot), RIM = col(C.rim);
  const YOU_T = col(C.you).multiplyScalar(0.45), SHOT_T = col(C.shot).multiplyScalar(0.5);

  const MAXD = 160;
  const drops = [];
  let dropMesh;
  const MAXSH = 16;
  let shadowMesh;

  function buildPools() {
    const sph = new THREE.SphereGeometry(1, 12, 9);
    bulletHead = new THREE.InstancedMesh(sph, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), MAXB);
    bulletTrail = new THREE.InstancedMesh(sph, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), MAXB);
    for (let i = 0; i < MAXB; i++) { bulletHead.setColorAt(i, YOU); bulletTrail.setColorAt(i, YOU_T); }
    bulletHead.count = bulletTrail.count = 0;
    bulletHead.frustumCulled = bulletTrail.frustumCulled = false;
    scene.add(bulletTrail, bulletHead);

    dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), MAXD);
    for (let i = 0; i < MAXD; i++) dropMesh.setColorAt(i, YOU);
    dropMesh.count = 0; dropMesh.frustumCulled = false;
    scene.add(dropMesh);

    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    shadowMesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex.shadow || null, color: tex.shadow ? 0xffffff : 0x000000, transparent: true, opacity: tex.shadow ? 0.7 : 0.3, depthWrite: false }), MAXSH);
    shadowMesh.count = 0; shadowMesh.frustumCulled = false; shadowMesh.renderOrder = 2;
    scene.add(shadowMesh);
  }

  function spawnBullet(team, x, y, z, dx, dy, dz, speed, r, owner) {
    let b = null;
    for (let i = 0; i < bullets.length; i++) if (!bullets[i].alive) { b = bullets[i]; break; }
    if (!b) { if (bullets.length >= MAXB) return null; b = {}; bullets.push(b); }
    b.alive = true; b.team = team; b.x = x; b.y = y; b.z = z; b.dx = dx; b.dy = dy; b.dz = dz;
    b.speed = speed; b.r = r; b.owner = owner; b.life = team === 0 ? 3 : 6; b.age = 0; b.id = bulletSeq++;
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
      d.r = rand(0.03, 0.07); d.life = rand(0.5, 1.1); d.color = color;
    }
  }
  function clearInk() {
    for (const b of bullets) b.alive = false;
    for (const d of drops) d.alive = false;
  }

  // ------------------------------------------------------------------ audio
  const AC = window.AudioContext || window.webkitAudioContext;
  let actx = null, master = null, soundOn = true, hum = null, humGain = null;
  const buffers = {};
  const SFX = { shoot: 'blaster', eshoot: 'enemy_attack', ehurt: 'enemy_hurt', edie: 'enemy_destroy' };
  function initAudio() {
    if (actx || !AC) { if (actx && actx.state === 'suspended') actx.resume(); return; }
    try { actx = new AC(); } catch (e) { actx = null; return; }
    master = actx.createGain(); master.gain.value = soundOn ? 0.8 : 0; master.connect(actx.destination);
    // a low hum that rises with the clock, so you can hear time running
    hum = actx.createOscillator(); humGain = actx.createGain();
    hum.type = 'triangle'; hum.frequency.value = 46; humGain.gain.value = 0;
    hum.connect(humGain); humGain.connect(master); hum.start();
    Object.keys(SFX).forEach((k) => {
      fetch('assets/sfx/' + SFX[k] + '.mp3').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((ab) => new Promise((res, rej) => actx.decodeAudioData(ab, res, rej)))
        .then((buf) => { buffers[k] = buf; }).catch(() => {});
    });
  }
  function setHum(level) {
    if (!hum) return;
    const t = actx.currentTime;
    hum.frequency.setTargetAtTime(46 + 64 * level, t, 0.08);
    humGain.gain.setTargetAtTime(level < 0 ? 0 : 0.035 + 0.11 * level, t, 0.08);
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
      case 'block': tone(1200, 2400, 0.07, 'triangle', 0.2); break;
      case 'dead': tone(170, 40, 0.5, 'sine', 0.5); tone(330, 70, 0.7, 'sawtooth', 0.14); break;
      case 'clear': tone(523, 523, 0.12, 'triangle', 0.2); tone(659, 659, 0.12, 'triangle', 0.2, 0.11); tone(784, 784, 0.22, 'triangle', 0.2, 0.22); break;
      case 'dry': tone(200, 150, 0.04, 'square', 0.05); break;
    }
  }

  // ------------------------------------------------------------------ game state
  const P = { x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, bob: 0, fireCd: 0, pulse: 0, lookF: 0 };
  let state = 'load';      // load | menu | play | pause | dead
  let ts = IDLE;           // world time scale: the whole game
  let room = 0, best = 0, kills = 0;
  let queue = [], spawnCd = 0, maxAlive = 3, betweenT = 0;
  let worldClock = 0, realClock = 0;
  const enemies = [];
  const debris = [];
  const tut = { move: false };

  try { best = +localStorage.getItem('standstill.best') || 0; } catch (e) { best = 0; }

  const TYPES = {
    gunner:   { base: 'bot',   scale: 1.9, hp: 1, r: 0.62, cy: 0.95, speed: 2.4, near: 5, far: 11, cd: 2.0, tele: 0.5,  bspeed: 14, color: C.gunner, gun: true },
    rusher:   { base: 'bot',   scale: 1.5, hp: 1, r: 0.52, cy: 0.75, speed: 4.3, melee: true, color: C.rusher },
    drone:    { base: 'drone', scale: 1.4, hp: 1, r: 0.6,  cy: 0.4,  speed: 3.0, near: 6, far: 11, cd: 2.4, tele: 0.45, bspeed: 15, fly: 2.7, twin: true, color: C.drone },
    spreader: { base: 'drone', scale: 2.1, hp: 2, r: 0.88, cy: 0.6,  speed: 1.8, near: 7, far: 12, cd: 3.2, tele: 0.65, bspeed: 11, fly: 3.4, fan: 5, color: C.spreader },
  };
  const COST = { gunner: 1, rusher: 0.8, drone: 1.3, spreader: 2.6 };

  let warnTex, flashTex;
  const hitMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });

  function makeEnemy(type, x, z) {
    const def = TYPES[type];
    const model = paint(models[def.base].clone(true), flat(def.color, false, true), lineBody);
    model.scale.setScalar(def.scale);
    const parts = fillMeshes(model);
    const root = new THREE.Group();
    root.add(model);
    if (def.gun) {
      const gun = paint(models.blaster.clone(true), flat(C.gun, false, true), lineBody);
      gun.scale.setScalar(0.4); gun.position.set(-0.36, 0.2, 0.12);
      model.add(gun);
      for (const p of fillMeshes(gun)) parts.push(p);
    }
    for (const p of parts) p._base = p.material;
    const warn = new THREE.Sprite(new THREE.SpriteMaterial({ map: warnTex, depthTest: false, fog: false }));
    warn.position.y = def.fly ? def.cy + def.r + 0.7 : def.scale * 0.9 + 0.55; warn.visible = false; warn.renderOrder = 5;
    root.add(warn);
    const e = {
      type, def, root, model, parts, warn, alive: true, hp: def.hp, x, z, y: def.fly || 0, r: def.r, cy: def.cy,
      yaw: 0, vx: 0, vz: 0, fireCd: rand(0.9, 1.9), tele: 0, burstT: 0, side: 1,
      strafe: Math.random() < 0.5 ? -1 : 1, strafeT: rand(1.5, 3), phase: rand(0, TAU),
      los: false, losT: 0, flash: 0, stuck: 0, detourT: 0, detourDir: 1, wind: 0, atkCd: 0.4, mixer: null, idle: null, walk: null,
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
    e.yaw = Math.atan2(P.x - x, P.z - z);
    root.position.set(x, e.y, z); root.rotation.y = e.yaw;
    scene.add(root);
    enemies.push(e);
    return e;
  }

  function spawnPoint() {
    for (let i = 0; i < 60; i++) {
      const x = rand(-ARENA + 1.5, ARENA - 1.5), z = rand(-ARENA + 1.5, ARENA - 1.5);
      if (insideAny(x, z, 0.9)) continue;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < 8.5 || d > 17) continue;
      if (i < 40 && enemies.some((e) => Math.hypot(e.x - x, e.z - z) < 5)) continue; // spread them around you
      return [x, z];
    }
    return [P.x > 0 ? -ARENA + 2 : ARENA - 2, P.z > 0 ? -ARENA + 2 : ARENA - 2];
  }

  function composeRoom(n) {
    if (n === 1) return ['gunner', 'gunner'];
    if (n === 2) return ['gunner', 'gunner', 'gunner'];
    if (n === 3) return ['gunner', 'rusher', 'gunner', 'rusher'];
    const pool = ['gunner', 'gunner', 'rusher', 'drone'];
    if (n >= 5) pool.push('spreader', 'drone');
    const list = [];
    let budget = 2.2 + n * 0.85, guard = 0;
    while (budget > 0.7 && guard++ < 200) {
      const t = pick(pool);
      if (COST[t] > budget + 0.3) continue;
      list.push(t); budget -= COST[t];
    }
    return list;
  }

  // ------------------------------------------------------------------ HUD
  const hud = {
    room: $('room'), left: $('left'), tfill: $('tfill'), tnum: $('tnum'), cross: $('cross'), dot: $('dot'),
    banner: $('banner'), pops: $('pops'), hint: $('hint'), fire: $('fire'), vig: $('vig'), flash: $('flash'),
  };
  const cache = {};
  function setText(el, key, v) { if (cache[key] !== v) { cache[key] = v; el.textContent = v; } }
  const pad = (n) => (n < 10 ? '0' : '') + n;
  let bannerTimer = 0, hintTimer = 0, flashA = 0;
  function banner(text, sub, secs) {
    hud.banner.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; hud.banner.appendChild(s); }
    hud.banner.classList.add('on'); bannerTimer = secs || 1.8;
  }
  function hint(text, secs) { hud.hint.textContent = text; hud.hint.classList.add('on'); hintTimer = secs || 4; }
  function pop(text) {
    const d = document.createElement('div');
    d.textContent = text; d.style.top = (hud.pops.childElementCount * 20) + 'px';
    hud.pops.appendChild(d);
    setTimeout(() => d.remove(), 1050);
  }
  function flash(a) { flashA = a; hud.flash.style.opacity = a; }
  function updateHUD(dt) {
    setText(hud.room, 'room', 'Room ' + pad(room));
    const left = enemies.length + queue.length;
    setText(hud.left, 'left', left ? left + ' left' : 'clear');
    const t2 = Math.round(ts * 100);
    if (cache.ts !== t2) {
      cache.ts = t2;
      hud.tfill.style.transform = 'scaleX(' + (t2 / 100).toFixed(2) + ')';
      hud.tnum.textContent = '×' + (t2 / 100).toFixed(2);
      hud.vig.style.opacity = ((1 - t2 / 100) * 0.9).toFixed(2);
    }
    const r = Math.round((1 - P.fireCd / FIRE_CD) * 40) / 40;
    if (cache.r !== r) { cache.r = r; hud.cross.style.setProperty('--r', r); }
    if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) hud.banner.classList.remove('on');
    if (hintTimer > 0 && (hintTimer -= dt) <= 0) hud.hint.classList.remove('on');
    if (flashA > 0) { flashA = Math.max(0, flashA - dt * 2.4); hud.flash.style.opacity = flashA.toFixed(2); }
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

  let gun = null, muzzle = null, recoil = 0, flashT = 0, swayX = 0, swayY = 0;
  function buildViewModel() {
    gun = new THREE.Group();
    // you are never slowed with the room, so the blaster keeps full colour
    const m = paint(models.blaster.clone(true), new THREE.MeshToonMaterial({ color: col(C.gun), gradientMap: grad }), lineVM);
    m.scale.setScalar(0.27); m.rotation.y = Math.PI;
    gun.add(m);
    muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, depthTest: false, transparent: true }));
    muzzle.scale.setScalar(0.26); muzzle.position.set(0, 0.16, -0.3); muzzle.visible = false;
    gun.add(muzzle);
    vmScene.add(gun);
  }

  // An enemy bullet sitting under the crosshair: your shot will go for it instead.
  function findBlock() {
    let best = null, bt = 40;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive || b.team !== 1) continue;
      const rx = b.x - eye.x, ry = b.y - eye.y, rz = b.z - eye.z;
      const t = rx * fwd.x + ry * fwd.y + rz * fwd.z;
      if (t < 0.6 || t > bt) continue;
      const d2 = rx * rx + ry * ry + rz * rz - t * t, tol = 0.22 + t * 0.02;
      if (d2 < tol * tol) { best = b; bt = t; }
    }
    if (best && segHit(eye.x, eye.y, eye.z, best.x, best.y, best.z) <= 1) return null;
    return best;
  }

  function assistTarget() {
    let best = null, bc = -1;
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = e.x - eye.x, ey = e.y + e.cy - eye.y, ez = e.z - eye.z, d = Math.hypot(ex, ey, ez);
      if (d < 0.6 || d > 40) continue;
      const c = (ex * fwd.x + ey * fwd.y + ez * fwd.z) / d;
      const need = Math.cos(Math.min(0.2, 0.045 + Math.atan(e.r / d) * 0.95));
      if (c > need && c > bc && segHit(eye.x, eye.y, eye.z, e.x, e.y + e.cy, e.z) > 1) { best = e; bc = c; }
    }
    return best;
  }

  const PSPEED = 40;
  function fire() {
    if (P.fireCd > 0) return;
    P.fireCd = FIRE_CD; P.pulse = 0.16; // a shot costs you a slice of time
    aimBasis();
    recoil = 1; flashT = 0.06;
    if (muzzle) { muzzle.visible = true; muzzle.material.rotation = rand(0, TAU); }
    let ax, ay, az;
    const blk = findBlock(), tgt = blk ? null : assistTarget();
    if (blk) { ax = blk.x; ay = blk.y; az = blk.z; }
    else if (tgt) {
      const lead = Math.hypot(tgt.x - eye.x, tgt.z - eye.z) / PSPEED;
      ax = tgt.x + tgt.vx * lead; ay = tgt.y + tgt.cy; az = tgt.z + tgt.vz * lead;
    } else {
      const far = 50;
      let t = segHit(eye.x, eye.y, eye.z, eye.x + fwd.x * far, eye.y + fwd.y * far, eye.z + fwd.z * far);
      if (t > 1) t = 1;
      if (fwd.y < -0.01) t = Math.min(t, (eye.y / -fwd.y) / far);
      const d = Math.max(3, t * far);
      ax = eye.x + fwd.x * d; ay = eye.y + fwd.y * d; az = eye.z + fwd.z * d;
    }
    const mx = eye.x + right.x * 0.16 - up.x * 0.14 + fwd.x * 0.45;
    const my = eye.y - up.y * 0.14 + fwd.y * 0.45;
    const mz = eye.z + right.z * 0.16 - up.z * 0.14 + fwd.z * 0.45;
    const dx = ax - mx, dy = ay - my, dz = az - mz, l = Math.hypot(dx, dy, dz) || 1;
    spawnBullet(0, mx, my, mz, dx / l, dy / l, dz / l, PSPEED, 0.09, null);
    sfx('shoot', 0.55, rand(0.95, 1.1));
  }

  function die() {
    if (state !== 'play') return;
    state = 'dead';
    gameEl.classList.remove('playing');
    releasePointer(); endJoy(); input.fire = false;
    hud.hint.classList.remove('on'); hud.banner.classList.remove('on');
    flash(0.85); sfx('dead'); setHum(-1);
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* not available */ }
    $('osub').textContent = 'Room ' + pad(room) + ' · best ' + pad(Math.max(best, room));
    show(sheets.over, true); show(sheets.scrim, true);
    $('again').focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ enemies
  function enemyShoot(e) {
    const def = e.def, fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), rx = fz, rz = -fx;
    let ox, oy, oz;
    if (def.fly) { const off = def.fan ? 0 : e.side * 0.42 * def.scale; ox = e.x + rx * off + fx * 0.5; oy = e.y + def.cy; oz = e.z + rz * off + fz * 0.5; }
    else { ox = e.x - rx * 0.45 + fx * 0.75; oy = 0.95; oz = e.z - rz * 0.45 + fz * 0.75; }
    const speed = def.bspeed + Math.min(5, room * 0.35);
    // lead the target a little more each room: running in a straight line stops working
    const d = Math.hypot(P.x - ox, P.z - oz), lead = Math.min(0.9, 0.3 + room * 0.07) * d / speed;
    let dx = P.x + P.vx * lead - ox, dy = 1.2 - oy, dz = P.z + P.vz * lead - oz;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const n = def.fan || 1;
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * 0.15 + rand(-0.02, 0.02), ca = Math.cos(a), sa = Math.sin(a);
      spawnBullet(1, ox, oy, oz, dx * ca - dz * sa, dy + rand(-0.012, 0.012), dx * sa + dz * ca, speed, def.fan ? 0.14 : 0.12, e);
    }
    sfx('eshoot', clamp(1.2 - d / 22, 0.2, 0.8), def.fan ? 0.7 : rand(0.95, 1.1));
  }

  const tmpP = { x: 0, z: 0 };
  function updateEnemy(e, dtW, dt) {
    const def = e.def;
    if (e.flash > 0 && (e.flash -= dt) <= 0) for (const p of e.parts) p.material = p._base;
    if (dtW <= 0) return;
    const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz) || 1e-4, ux = dx / dist, uz = dz / dist;
    let mx = 0, mz = 0, moving = false;

    if (def.melee) {
      if (e.wind > 0) {
        e.wind -= dtW;
        e.warn.scale.setScalar(0.3 + 1.1 * Math.max(0, e.wind / 0.34));
        if (e.wind <= 0) { e.warn.visible = false; e.atkCd = 0.9; if (dist < 2.1) die(); }
      } else {
        e.atkCd -= dtW;
        if (dist < 1.55 && e.atkCd <= 0) { e.wind = 0.34; e.warn.visible = true; }
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
        e.warn.scale.setScalar(0.3 + 1.1 * Math.max(0, e.tele / def.tele)); // the ring closes, then it fires
        if (e.tele <= 0) { e.warn.visible = false; enemyShoot(e); if (def.twin) e.burstT = 0.22; }
      } else {
        let f = 0;
        if (dist > def.far || (!def.fly && !e.los)) f = 1; else if (dist < def.near) f = -0.8;
        const sw = f === 0 ? 1 : 0.45;
        mx = ux * f - uz * e.strafe * sw; mz = uz * f + ux * e.strafe * sw;
        e.fireCd -= dtW;
        if (e.fireCd <= 0 && e.los && dist < 24) {
          e.tele = def.tele; e.warn.visible = true;
          e.fireCd = def.cd * Math.max(0.55, 1 - room * 0.04) * rand(0.85, 1.25);
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
    e.hp -= 1;
    spawnDrops(b.x, b.y, b.z, YOU, 5, 2.5);
    if (e.hp <= 0) { killEnemy(e, b); return; }
    e.flash = 0.09;
    for (const p of e.parts) p.material = hitMat;
    sfx('ehurt', 0.7);
  }

  function killEnemy(e, b) {
    e.alive = false;
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    // comes apart into its pieces, which then tumble on the same clock as everything else
    e.root.updateMatrixWorld(true);
    for (const p of e.parts) {
      p.material = p._base;
      scene.attach(p);
      const a = rand(0, TAU), sp = rand(2, 5.5);
      debris.push({
        o: p, vx: Math.cos(a) * sp + (b ? b.dx * 5 : 0), vy: rand(3, 6.5), vz: Math.sin(a) * sp + (b ? b.dz * 5 : 0),
        ax: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), av: rand(4, 11), life: rand(2.2, 3.2), s: p.scale.x,
      });
    }
    scene.remove(e.root);
    e.warn.material.dispose();
    if (e.mixer) e.mixer.stopAllAction();
    spawnDrops(e.x, e.y + e.cy, e.z, RIM, 14, 4.5);
    sfx('edie', 0.8, rand(0.9, 1.1));
    kills++;
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
  function updateBullets(dtW) {
    if (dtW <= 0) return;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      const step = b.speed * dtW;
      b.life -= dtW; b.age += dtW;
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
        // your shot can knock one of theirs out of the air
        for (let j = 0; j < bullets.length; j++) {
          const o = bullets[j];
          if (!o.alive || o.team !== 1) continue;
          const cx = o.x - b.x, cy = o.y - b.y, cz = o.z - b.z;
          const t = clamp((cx * sx + cy * sy + cz * sz) / sl2, 0, 1);
          const qx = cx - sx * t, qy = cy - sy * t, qz = cz - sz * t;
          if (qx * qx + qy * qy + qz * qz < 0.1 && t < hitT) { hitT = t; kind = 5; victim = o; }
        }
      } else if (state === 'play') {
        const cx = P.x - b.x, cz = P.z - b.z, h2 = sx * sx + sz * sz;
        const t = h2 > 1e-9 ? clamp((cx * sx + cz * sz) / h2, 0, 1) : 0;
        const qx = cx - sx * t, qz = cz - sz * t, yy = b.y + sy * t, R = 0.3 + b.r;
        if (qx * qx + qz * qz < R * R && yy > 0.15 && yy < 1.8 && t < hitT) { hitT = t; kind = 4; }
      }
      if (kind) {
        b.x += sx * hitT; b.y += sy * hitT; b.z += sz * hitT;
        b.alive = false;
        if (kind === 3) damageEnemy(victim, b);
        else if (kind === 4) die();
        else if (kind === 5) { victim.alive = false; spawnDrops(b.x, b.y, b.z, SHOT, 7, 3); spawnDrops(b.x, b.y, b.z, YOU, 4, 2); sfx('block'); pop('Blocked'); }
        else spawnDrops(b.x, Math.max(0.05, b.y), b.z, b.team === 0 ? YOU : SHOT, 4, 1.8);
        continue;
      }
      b.x = nx; b.y = ny; b.z = nz;
      const out = Math.abs(b.x) > ARENA || Math.abs(b.z) > ARENA;
      if ((out && b.y < HI.h) || b.life <= 0) {
        b.alive = false;
        if (out) spawnDrops(clamp(b.x, -ARENA, ARENA), b.y, clamp(b.z, -ARENA, ARENA), b.team === 0 ? YOU : SHOT, 4, 1.8);
      }
    }
  }

  const bq = new THREE.Quaternion(), bz = new THREE.Vector3(0, 0, 1), bd = new THREE.Vector3();
  function drawPools() {
    let n = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      // the streak behind a bullet never shrinks, so you can read where it is going while standing still
      const len = Math.min(b.team === 0 ? 1.5 : 1.1, b.age * b.speed * 0.5 + 0.05);
      let r = b.r;
      if (b.team === 1) r *= 1 + 0.12 * Math.sin(realClock * 8 + b.id);
      _m.makeScale(r, r, r); _m.setPosition(b.x, b.y, b.z);
      bulletHead.setMatrixAt(n, _m); bulletHead.setColorAt(n, b.team === 0 ? YOU : SHOT);
      bd.set(b.dx, b.dy, b.dz); bq.setFromUnitVectors(bz, bd);
      _m.compose(_p.set(b.x - b.dx * len, b.y - b.dy * len, b.z - b.dz * len), bq, _s.set(b.r * 0.55, b.r * 0.55, len));
      bulletTrail.setMatrixAt(n, _m); bulletTrail.setColorAt(n, b.team === 0 ? YOU_T : SHOT_T);
      n++;
    }
    bulletHead.count = bulletTrail.count = n;
    bulletHead.instanceMatrix.needsUpdate = bulletTrail.instanceMatrix.needsUpdate = true;
    bulletHead.instanceColor.needsUpdate = bulletTrail.instanceColor.needsUpdate = true;

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
      const e = enemies[i], s = e.r * (e.def.fly ? 2.2 : 3);
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
      if (d.y < 0.02 || d.life <= 0) d.alive = false;
    }
  }

  // ------------------------------------------------------------------ flow
  const sheets = { menu: $('menu'), pause: $('pause'), over: $('over'), scrim: $('pscrim'), hud: $('hud') };
  function show(el, on) { el.hidden = !on; }

  function clearEnemies() {
    for (const e of enemies) { scene.remove(e.root); e.warn.material.dispose(); }
    enemies.length = 0;
    for (const d of debris) scene.remove(d.o);
    debris.length = 0;
  }

  function startRoom(n) {
    room = n;
    if (room > best) { best = room; try { localStorage.setItem('standstill.best', String(best)); } catch (e) { /* storage unavailable */ } }
    clearEnemies(); clearInk();
    buildCover((n - 1) % LAYOUTS.length);
    Object.assign(P, { x: 0, z: 0, pitch: 0, vx: 0, vz: 0, fireCd: 0, pulse: 0, lookF: 0 });
    ts = IDLE; betweenT = 0;
    queue = composeRoom(n);
    maxAlive = Math.min(7, 2 + Math.ceil(n / 2));
    // the first hostiles are already in the room when you arrive
    const first = Math.min(maxAlive, queue.length);
    for (let i = 0; i < first; i++) { const p = spawnPoint(); makeEnemy(queue.pop(), p[0], p[1]); }
    // start out facing one of them
    if (enemies[0]) P.yaw = Math.atan2(-(enemies[0].x - P.x), -(enemies[0].z - P.z));
    spawnCd = 1.2;
    state = 'play';
    show(sheets.menu, false); show(sheets.over, false); show(sheets.pause, false); show(sheets.scrim, false); show(sheets.hud, true);
    gameEl.classList.add('playing');
    input.fire = false; input.mx = input.my = 0;
    camera.clearViewOffset();
    banner('Room ' + pad(n), (enemies.length + queue.length) + ' hostiles', 1.8);
    if (!tut.move) hint(isTouch ? 'Nothing moves until you do. Left thumb walks, right thumb aims, FIRE shoots.' : 'Nothing moves until you do. Click to take the mouse, then walk, aim and shoot.', 30);
    if (!isTouch) lockPointer();
  }

  function startGame() { initAudio(); kills = 0; startRoom(1); }
  function retry() { initAudio(); startRoom(room || 1); }

  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause'; releasePointer(); gameEl.classList.remove('playing');
    input.fire = false; endJoy(); setHum(-1);
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
    releasePointer(); setHum(-1);
    gameEl.classList.remove('playing');
    show(sheets.pause, false); show(sheets.over, false); show(sheets.scrim, false); show(sheets.hud, false); show(sheets.menu, true);
    $('best').textContent = best > 1 ? 'Best: room ' + pad(best) : '';
    hud.vig.style.opacity = 0; cache.ts = -1;
    buildTableau();
  }

  // The title screen is the pitch: a stand-off with the clock stopped and bullets in the air.
  function buildTableau() {
    clearEnemies(); clearInk();
    buildCover(0);
    ts = 0;
    P.x = 0.6; P.z = 2.2;
    const cast = [['gunner', 3.4, -6.4], ['gunner', -5.2, -6.0], ['drone', 0.4, -8.4], ['rusher', -2.6, -2.4], ['spreader', 6.6, -10.2]];
    const target = new THREE.Vector3(0.6, 1.3, 2.2);
    for (const c of cast) {
      const e = makeEnemy(c[0], c[1], c[2]);
      if (e.def.melee) continue;
      const n = e.def.fan ? 5 : 3;
      for (let k = 0; k < n; k++) {
        const ox = e.x, oy = e.y + e.def.cy, oz = e.z;
        let dx = target.x - ox + rand(-1.6, 1.6), dy = target.y - oy + rand(-0.5, 0.5), dz = target.z - oz + rand(-1, 1);
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        const f = rand(0.2, 0.85) * l;
        const b = spawnBullet(1, ox + dx * f, oy + dy * f, oz + dz * f, dx, dy, dz, 14, 0.13, e);
        if (b) b.age = 1;
      }
    }
    for (let k = 0; k < 3; k++) {
      const e = enemies[k];
      let dx = e.x - target.x, dy = e.y + e.cy - target.y, dz = e.z - target.z;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const f = 1.6 + k * 1.3;
      const b = spawnBullet(0, target.x + dx * f, target.y + dy * f, target.z + dz * f, dx, dy, dz, PSPEED, 0.09, null);
      if (b) b.age = 1;
    }
  }

  // ------------------------------------------------------------------ input
  let isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);
  gameEl.classList.toggle('touch', isTouch);
  const input = { jx: 0, jy: 0, fire: false, mx: 0, my: 0, keys: {} };
  let sens = 1, locked = false, movePtr = null, lookPtr = null, firePtr = null, joyOX = 0, joyOY = 0, lastLX = 0, lastLY = 0, lastFX = 0, lastFY = 0;
  const touchEl = $('touch'), joyEl = $('joy'), knobEl = $('knob');

  try {
    const s = +localStorage.getItem('standstill.sens'); if (s >= 40 && s <= 220) { sens = s / 100; $('sens').value = s; }
    if (localStorage.getItem('standstill.snd') === '0') { soundOn = false; $('snd').checked = false; }
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
      // a small dead zone, so a resting thumb really does stop the clock
      const m = Math.hypot(dx, dy) / JR, k = m < 0.18 ? 0 : (m - 0.18) / 0.82 / (m || 1);
      input.jx = dx / JR * k; input.jy = dy / JR * k;
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
    if (e.button === 0) input.fire = true;
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

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    input.keys[e.code] = true;
    if (e.repeat) return;
    if (state === 'play') {
      if (e.code === 'Space') { e.preventDefault(); input.fire = true; }
      else if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
    } else if (state === 'pause' && (e.code === 'KeyP' || e.code === 'Escape')) resumeGame();
    else if (state === 'dead' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR')) { e.preventDefault(); retry(); }
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; if (e.code === 'Space') input.fire = false; });
  window.addEventListener('blur', () => { input.keys = {}; input.fire = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

  $('play').addEventListener('click', () => { if (state === 'menu') startGame(); });
  $('again').addEventListener('click', retry);
  $('tomenu').addEventListener('click', toMenu);
  $('quit').addEventListener('click', toMenu);
  $('resume').addEventListener('click', resumeGame);
  $('pausebtn').addEventListener('click', pauseGame);
  $('sens').addEventListener('input', (e) => { sens = e.target.value / 100; try { localStorage.setItem('standstill.sens', e.target.value); } catch (err) { /* storage unavailable */ } });
  $('snd').addEventListener('change', (e) => {
    soundOn = e.target.checked; if (master) master.gain.value = soundOn ? 0.8 : 0;
    try { localStorage.setItem('standstill.snd', soundOn ? '1' : '0'); } catch (err) { /* storage unavailable */ }
  });

  // ------------------------------------------------------------------ per-frame update
  function updatePlay(dt) {
    // look
    const k = 0.0022 * sens;
    const turned = Math.hypot(input.mx, input.my) * k;
    P.yaw -= input.mx * k; P.pitch = clamp(P.pitch - input.my * k, -1.35, 1.35);
    swayX += (clamp(-input.mx * 0.0006, -0.05, 0.05) - swayX) * Math.min(1, dt * 10);
    swayY += (clamp(input.my * 0.0006, -0.05, 0.05) - swayY) * Math.min(1, dt * 10);
    input.mx = input.my = 0;

    // move: always at full speed, in real time
    let f = -input.jy, s = input.jx;
    const K = input.keys;
    if (K.KeyW || K.ArrowUp) f += 1; if (K.KeyS || K.ArrowDown) f -= 1;
    if (K.KeyD || K.ArrowRight) s += 1; if (K.KeyA || K.ArrowLeft) s -= 1;
    const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
    const moveIn = Math.min(1, l);
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
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
    const moveAmt = Math.min(1, Math.hypot(P.vx, P.vz) / SPEED);
    P.bob += moveAmt * SPEED * dt * 1.7;

    // the clock: it runs as fast as you move, a little when you turn, and in a burst when you shoot
    P.lookF += (clamp(turned / dt / 3.5, 0, 1) - P.lookF) * Math.min(1, dt * 10);
    P.pulse = Math.max(0, P.pulse - dt);
    const target = Math.max(IDLE, moveIn, moveAmt * 0.9, P.lookF * 0.3, P.pulse > 0 ? 0.9 : 0);
    ts += (target - ts) * Math.min(1, dt * (target > ts ? 14 : 8));
    const dtW = dt * ts;
    worldClock += dtW;
    setHum(ts);
    if (!tut.move && moveIn > 0.5) { tut.move = true; hintTimer = Math.min(hintTimer, 1.5); }

    // blaster readies on the world clock, so standing still does not reload it
    P.fireCd = Math.max(0, P.fireCd - dtW);
    if (input.fire) { if (P.fireCd <= 0) fire(); }
    aimBasis();
    const blk = !!findBlock();
    if (cache.blk !== blk) { cache.blk = blk; hud.dot.classList.toggle('block', blk); }

    // room
    if (queue.length && enemies.length < maxAlive && (spawnCd -= dtW) <= 0) {
      const p = spawnPoint();
      const e = makeEnemy(queue.pop(), p[0], p[1]);
      spawnDrops(e.x, e.y + e.cy, e.z, RIM, 10, 3);
      spawnCd = rand(0.8, 1.6);
    }
    for (let i = enemies.length - 1; i >= 0; i--) updateEnemy(enemies[i], dtW, dt);
    updateBullets(dtW);
    updateDrops(dtW); updateDebris(dtW);

    if (state === 'play' && !queue.length && !enemies.length) {
      if (betweenT <= 0) { betweenT = 1.5; banner('Clear', 'Room ' + pad(room), 1.3); sfx('clear'); }
      else if ((betweenT -= dt) <= 0) { flash(0.6); startRoom(room + 1); }
    }

    // camera
    camera.position.set(P.x, EYE + Math.sin(P.bob * 2) * 0.035 * moveAmt, P.z);
    camera.rotation.set(P.pitch, P.yaw, 0);

    // blaster
    if (gun) {
      recoil = Math.max(0, recoil - dt * 9);
      if (flashT > 0 && (flashT -= dt) <= 0) muzzle.visible = false;
      const ready = 1 - P.fireCd / FIRE_CD;
      gun.position.set(gunX + swayX + Math.cos(P.bob) * 0.012 * moveAmt, -0.3 + swayY - (1 - ready) * 0.035 + Math.abs(Math.sin(P.bob)) * 0.014 * moveAmt, -0.74 + recoil * 0.08);
      gun.rotation.set(recoil * 0.16 + (1 - ready) * 0.12, 0.05 + swayX * 2, 0);
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

  let viewW = 1, viewH = 1, gunX = 0.2;
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
    gunX = isTouch ? 0.09 : 0.22; // on phones, keep the blaster clear of the fire button
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(gameEl);

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    realClock += dt;
    if (state === 'play') updatePlay(dt);
    else if (state === 'menu') updateMenu(dt);
    else if (state === 'dead') { ts += (0 - ts) * Math.min(1, dt * 10); updateHUD(dt); }

    U.dim.value = (1 - Math.min(1, ts)) * DIM_MAX;
    U.fog.value.copy(bgCol).lerp(bgDim, U.dim.value);
    renderer.setClearColor(U.fog.value);

    if (state === 'menu' && viewW > viewH * 1.15) camera.setViewOffset(viewW, viewH, -viewW * 0.17, 0, viewW, viewH);
    else if (camera.view) camera.clearViewOffset();

    drawPools();
    renderer.clear();
    renderer.render(scene, camera);
    if (gun && state !== 'menu') { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
  }

  // ------------------------------------------------------------------ boot
  resize();
  loadAll().then(() => {
    warnTex = warnTexture(); flashTex = flashTexture();
    Object.keys(models).forEach((k) => prep(models[k]));
    buildShell(); buildPools(); buildViewModel();
    const btn = $('play');
    btn.disabled = false; btn.textContent = 'Play';
    toMenu();
    last = performance.now();
    requestAnimationFrame(frame);
  }).catch((err) => {
    $('play').textContent = 'Failed';
    $('loadmsg').textContent = 'Could not load ' + (err && err.message ? err.message : 'the game files') + '. Check the connection and reload.';
  });

  // small hook for automated checks
  window.__still = { P, enemies, bullets, input, get state() { return state; }, get ts() { return ts; }, get room() { return room; }, get kills() { return kills; }, start: startGame };
})();
