'use strict';
/* Делает пример скина docs/dice-skin-example/ (skin.json + бесшовные body.png и body_normal.png) без внешних программ:
 *   node scripts/make-example-skin.js
 * Нужен как образец формата. Свои текстуры удобнее делать в Blender (см. docs/DICE-SKINS.ru.md). */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'docs', 'dice-skin-example');
const N = 512;

// --- PNG (RGB, 8 бит)
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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// --- бесшовный шум (значения на сетке с заворачиванием по краям), несколько октав
let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function noiseGrid(n) { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return g; }
const smooth = (t) => t * t * (3 - 2 * t);
function sample(g, n, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const at = (a, b) => g[((b % n + n) % n) * n + ((a % n + n) % n)];
  const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
const grids = [4, 8, 16, 32, 64].map((n) => ({ n, g: noiseGrid(n) }));
function height(px, py) {
  let h = 0, amp = 0.5, tot = 0;
  grids.forEach(({ n, g }) => { h += sample(g, n, (px / N) * n, (py / N) * n) * amp; tot += amp; amp *= 0.55; });
  return h / tot;
}

const H = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = height(x, y);
const hAt = (x, y) => H[((y % N + N) % N) * N + ((x % N + N) % N)];

const col = Buffer.alloc(N * N * 3), nor = Buffer.alloc(N * N * 3);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const h = hAt(x, y), i = (y * N + x) * 3;
  const t = Math.min(1, Math.max(0, (h - 0.25) / 0.5));
  col[i] = Math.round(92 + 70 * t); col[i + 1] = Math.round(88 + 64 * t); col[i + 2] = Math.round(84 + 58 * t);    // тёплый серый камень
  const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 6, dy = (hAt(x, y + 1) - hAt(x, y - 1)) * 6;                       // нормаль в формате OpenGL (Y вверх)
  const l = Math.sqrt(dx * dx + dy * dy + 1);
  nor[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); nor[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nor[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'body.png'), png(N, N, col));
fs.writeFileSync(path.join(OUT, 'body_normal.png'), png(N, N, nor));
fs.writeFileSync(path.join(OUT, 'skin.json'), JSON.stringify({
  format: 'udbm-dice-skin/1',
  name: { ru: 'Камень (пример)', en: 'Stone (example)' },
  body: { color: '#ffffff', metalness: 0.05, roughness: 0.8, map: 'body.png', normalMap: 'body_normal.png', mapScale: 1.5, normalScale: 1.2 },
  edges: { color: '#c9c0a8', opacity: 0.5 },
  numbers: { color: '#ffe9a8', outline: '#1a1208', glow: '#ff9b2e', size: 1 }
}, null, 2) + '\n');
console.log('готово:', OUT);
