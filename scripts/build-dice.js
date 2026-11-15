'use strict';
/* STL кубиков (assets/dice/*.stl) → src/renderer/js/dice-models.js
 *
 * Для каждого кубика: центрируем модель, склеиваем копланарные треугольники в настоящие грани,
 * считаем для каждой грани центр, нормаль, «верх» текста и радиус вписанной окружности,
 * раздаём значения (противоположные грани в сумме дают N+1, как на настоящих кубиках).
 * Цифры рисует рантайм (dice3d.js) — здесь только геометрия и раскладка.
 *
 *   node scripts/build-dice.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'dice');
const OUT = path.join(__dirname, '..', 'src', 'renderer', 'js', 'dice-models.js');

// файл → { key: ключ в VTT.diceModels, sides: число граней, only6: подписывать только грани-многоугольники с ≥6 вершин (монета) }
const FILES = [
  { f: 'D2_Kraken.stl', key: 'd2', sides: 2, bigFacesOnly: true },
  { f: 'D4.stl', key: 'd4', sides: 4 },
  { f: 'D6.stl', key: 'd6', sides: 6 },
  { f: 'D8.stl', key: 'd8', sides: 8 },
  { f: 'D10.stl', key: 'd10', sides: 10 },
  { f: 'D12.stl', key: 'd12', sides: 12 },
  { f: 'D20.stl', key: 'd20', sides: 20 },
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => mul(a, 1 / (len(a) || 1));

function readStl(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(80);
  if (84 + 50 * n !== b.length) throw new Error(path.basename(file) + ': не бинарный STL или файл повреждён');
  const tris = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50, t = [];
    for (let j = 0; j < 3; j++) t.push([0, 1, 2].map((a) => b.readFloatLE(o + 12 + j * 12 + a * 4)));
    tris.push(t);
  }
  return tris;
}

function build(def) {
  let tris = readStl(path.join(SRC, def.f));
  // центр = среднее по уникальным вершинам
  const uniq = new Map();
  tris.forEach((t) => t.forEach((v) => uniq.set(v.map((x) => x.toFixed(3)).join(','), v)));
  let cen = [0, 0, 0];
  uniq.forEach((v) => { cen = add(cen, v); });
  cen = mul(cen, 1 / uniq.size);
  tris = tris.map((t) => t.map((v) => sub(v, cen)));

  // нормаль по геометрии, наружу (от центра)
  const items = tris.map((t) => {
    let n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
    const c = mul(add(add(t[0], t[1]), t[2]), 1 / 3);
    if (dot(n, c) < 0) { n = mul(n, -1); t = [t[0], t[2], t[1]]; }   // чтобы обход вершин смотрел наружу
    return { t, n, c, off: dot(n, c) };
  });

  // склейка копланарных (нормаль совпадает, плоскость та же)
  const groups = [];
  items.forEach((it) => {
    const g = groups.find((g) => dot(g.n, it.n) > 0.9985 && Math.abs(g.off - it.off) < 0.35);
    if (g) { g.tris.push(it); } else groups.push({ n: it.n, off: it.off, tris: [it] });
  });
  if (groups.length !== def.sides && !def.bigFacesOnly) throw new Error(def.f + ': ожидали ' + def.sides + ' граней, нашли ' + groups.length);

  const faces = groups.map((g) => {
    let area = 0, c = [0, 0, 0];
    g.tris.forEach((it) => {
      const a = len(cross(sub(it.t[1], it.t[0]), sub(it.t[2], it.t[0]))) / 2;
      area += a; c = add(c, mul(it.c, a));
    });
    c = mul(c, 1 / area);
    // нормаль — усреднённая (взвешено по площади)
    let n = [0, 0, 0];
    g.tris.forEach((it) => { n = add(n, it.n); });
    n = norm(n);
    // вершины грани и граничные рёбра (ребро, встретившееся один раз)
    const edges = new Map(), verts = new Map();
    const key = (v) => v.map((x) => x.toFixed(3)).join(',');
    g.tris.forEach((it) => {
      for (let i = 0; i < 3; i++) {
        const a = it.t[i], b = it.t[(i + 1) % 3];
        verts.set(key(a), a);
        const k = [key(a), key(b)].sort().join('|');
        const e = edges.get(k) || { a, b, n: 0 };
        e.n++; edges.set(k, e);
      }
    });
    let r = Infinity;
    edges.forEach((e) => {
      if (e.n !== 1) return;
      const d = sub(e.b, e.a), ab = norm(d), ac = sub(c, e.a);
      const proj = sub(ac, mul(ab, dot(ac, ab)));
      r = Math.min(r, len(proj));
    });
    // «верх» цифры: к самой дальней вершине (для кайта d10 — к острому концу)
    let far = null, fd = -1;
    verts.forEach((v) => { const d = len(sub(v, c)); if (d > fd) { fd = d; far = v; } });
    let u = sub(far, c);
    if (def.sides === 6) {                      // куб: цифра «стоит на ребре», а не на углу
      let e = null;
      edges.forEach((ed) => { if (!e && ed.n === 1) e = ed; });
      u = sub(mul(add(e.a, e.b), 0.5), c);
    }
    u = norm(sub(u, mul(n, dot(u, n))));
    return { n, c, u, r, area, nv: verts.size, v: 0 };
  });

  // подписываем: у монеты только две большие грани, у остальных — все
  let labeled = faces;
  if (def.bigFacesOnly) {
    labeled = faces.slice().sort((a, b) => b.area - a.area).slice(0, 2);
  }
  // значения: противоположные грани → сумма N+1
  const N = labeled.length;
  let nextV = 1;
  const used = new Set();
  labeled.forEach((f, i) => {
    if (used.has(i)) return;
    const j = labeled.findIndex((g, k) => k !== i && !used.has(k) && dot(g.n, f.n) < -0.98);
    if (def.sides === 4 || j < 0) { f.v = nextV++; used.add(i); return; }
    f.v = nextV; labeled[j].v = N + 1 - nextV; nextV++;
    used.add(i); used.add(j);
  });
  if (def.sides === 4) { /* 1..4 по порядку */ }
  // проверка: набор значений ровно 1..N
  const vals = labeled.map((f) => f.v).sort((a, b) => a - b).join(',');
  const want = Array.from({ length: N }, (_, i) => i + 1).join(',');
  if (vals !== want) throw new Error(def.f + ': раскладка значений сломалась: ' + vals);

  const pos = [];
  items.forEach((it) => it.t.forEach((v) => pos.push(v)));
  return { def, pos, faces: faces.filter((f) => f.v > 0) };
}

const built = FILES.map(build);
const maxR = Math.max.apply(null, built.map((m) => Math.max.apply(null, m.pos.map(len))));
const S = 1 / maxR;          // общий масштаб: относительные размеры кубиков сохраняются
const r4 = (x) => Math.round(x * S * 10000) / 10000;
const r3 = (x) => Math.round(x * 1000) / 1000;
const vec = (a, f) => a.map((x) => f(x));

const out = {};
built.forEach((m) => {
  out[m.def.key] = {
    sides: m.def.sides,
    pos: [].concat.apply([], m.pos.map((v) => vec(v, r4))),
    faces: m.faces.map((f) => ({ v: f.v, n: vec(f.n, r3), c: vec(f.c, r4), u: vec(f.u, r3), r: r4(f.r) })),
  };
});

const head = '/* АВТОГЕНЕРИРУЕТСЯ: node scripts/build-dice.js (из assets/dice/*.stl). Руками не править.\n' +
  ' * VTT.diceModels[ключ] = { sides, pos: плоский список вершин треугольников (x,y,z…),\n' +
  ' *   faces: [{ v: значение, n: нормаль, c: центр, u: «верх» цифры, r: радиус вписанной окружности }] }\n' +
  ' * Значения: противоположные грани дают N+1; у d2 (монета) подписаны только две большие грани. */\n';
fs.writeFileSync(OUT, head + '(function () { var VTT = (window.VTT = window.VTT || {}); VTT.diceModels = ' + JSON.stringify(out) + '; })();\n');
built.forEach((m) => console.log(m.def.key.padEnd(4), 'граней:', m.faces.length, 'треугольников:', m.pos.length / 3, 'значения:', m.faces.map((f) => f.v).join(' ')));
console.log('записано', OUT, (fs.statSync(OUT).size / 1024).toFixed(1) + ' КБ');
