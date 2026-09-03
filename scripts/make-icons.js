// Generates the toolbar/store icons as PNG files without any dependency.
// Design: a rounded green "slab" with a chameleon eye and a paint drip.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size) {
  const ss = 4; // supersampling
  const S = size * ss;
  const px = Buffer.alloc(S * S * 4);
  const put = (i, r, g, b, a) => { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };

  const inRoundRect = (x, y, x0, y0, w, h, r) => {
    if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
    const cx = Math.max(x0 + r, Math.min(x, x0 + w - r));
    const cy = Math.max(y0 + r, Math.min(y, y0 + h - r));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const i = (y * S + x) * 4;
      // Background slab (green, rounded)
      if (!inRoundRect(u, v, 0.04, 0.04, 0.92, 0.92, 0.22)) { put(i, 0, 0, 0, 0); continue; }
      // Gradient green camo
      const g1 = [92, 200, 120], g2 = [40, 140, 95];
      const t = (u + v) / 2;
      let r = g1[0] + (g2[0] - g1[0]) * t;
      let g = g1[1] + (g2[1] - g1[1]) * t;
      let b = g1[2] + (g2[2] - g1[2]) * t;
      // Camo blotches
      if (inCircle(u, v, 0.25, 0.7, 0.16) || inCircle(u, v, 0.78, 0.28, 0.13) || inCircle(u, v, 0.7, 0.75, 0.1)) {
        r *= 0.78; g *= 0.85; b *= 0.8;
      }
      // Paint drip (pink) top-left
      if (inRoundRect(u, v, 0.12, 0.12, 0.3, 0.16, 0.06) || inRoundRect(u, v, 0.2, 0.2, 0.09, 0.3, 0.045)) {
        r = 255; g = 139; b = 209;
      }
      // Chameleon eye
      if (inCircle(u, v, 0.6, 0.52, 0.2)) { r = 250; g = 250; b = 245; }
      if (inCircle(u, v, 0.63, 0.53, 0.11)) { r = 30; g = 34; b = 44; }
      if (inCircle(u, v, 0.67, 0.49, 0.04)) { r = 255; g = 255; b = 255; }
      put(i, Math.round(r), Math.round(g), Math.round(b), 255);
    }
  }
  // Downsample
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = ((y * ss + dy) * S + (x * ss + dx)) * 4;
          const al = px[i + 3] / 255;
          r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return encodePng(size, size, out);
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), render(size));
  console.log(`wrote icons/icon${size}.png`);
}
