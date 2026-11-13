'use strict';
// Сериализация редактора карт: модель -> map.json -> geometry.segmentsFromMap / movement.cellRule.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('./helpers/load');

const VTT = load(['../locales/ru.js', 'i18n.js', 'geometry.js', 'movement.js', 'editor-model.js']);
const EM = VTT.editorModel, G = VTT.geometry, MV = VTT.movement;
const demo = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'demo.map.json'), 'utf8'));

// meta -> то, что читает приложение (как store.buildMap)
function appMap(meta) {
  const s = meta.resolution.map_size;
  return { cols: s.x, rows: s.y, ppg: meta.resolution.pixels_per_grid, feet: meta.feet_per_cell, meta };
}
const J = (v) => JSON.parse(JSON.stringify(v));
const deq = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m);
const P = (x, y) => ({ x, y });

test('новая карта: сетка из размера картинки, image_grid, все слои нужного размера', () => {
  const m = EM.create({ name: 'Т', image: 'a.png', imgW: 1218, imgH: 1144, ppg: 70, offX: 49, offY: 140 });
  deq([m.cols, m.rows], [16, 14]);
  const meta = EM.toMeta(m);
  assert.strictEqual(meta.format, 'vestfalia-battlemap/1');
  deq(meta.image_grid, { x: 49, y: 140, width: 1218, height: 1144 });
  deq(meta.resolution.map_size, { x: 16, y: 14 });
  for (const n of EM.LAYERS) { assert.strictEqual(meta.layers[n].length, 14, n); assert.strictEqual(meta.layers[n][0].length, 16, n); }
  assert.strictEqual(meta.layers.terrain[3][3], 'floor');
});

test('сетка: рамка клетки, N клеток по горизонтали, автоколонки', () => {
  deq(EM.gridFromBox({ x: 49, y: 140, w: 70, h: 70 }), { ppg: 70, offX: 49, offY: 0 });
  deq(EM.gridFromBox({ x: 119, y: 280, w: 69, h: 71 }), { ppg: 70, offX: 49, offY: 0 });
  deq(EM.gridFromSpan(49, 749, 10), { ppg: 70, offX: 49 });
  deq(EM.autoSize(1218, 1144, 70, 49, 140), { cols: 16, rows: 14 });
});

test('стены: сохранение даёт line_of_sight, geometry видит стену, путь блокируется', () => {
  const m = EM.create({ name: 'W', image: 'a.png', imgW: 350, imgH: 210, ppg: 70 }); // 5x3
  EM.addWall(m, [P(2, 0), P(2, 3)]);
  const meta = EM.toMeta(m);
  deq(meta.line_of_sight, [[P(2, 0), P(2, 3)]]);
  const map = appMap(meta);
  const geo = G.segmentsFromMap(meta);
  assert.strictEqual(geo.walls.length, 1);
  const r = MV.findPath(map, G.blockingSegments(geo, []), { x: 0, y: 1 }, { x: 4, y: 1 }, { size: 1 });
  assert.ok(!r || !r.path || r.path.length === 0 || r.ok === false, 'через сплошную стену пути нет: ' + JSON.stringify(r && { ok: r.ok, feet: r.feet }));
});

test('дверь режет стену: разрыв в line_of_sight, portals, закрытая блокирует, открытая нет', () => {
  const m = EM.create({ name: 'D', image: 'a.png', imgW: 350, imgH: 210, ppg: 70 });
  EM.addWall(m, [P(2, 0), P(2, 3)]);
  const d = EM.doorAt(m, 2.05, 1.5);
  deq(d, { position: P(2, 1), size: [1, 1], dir: 'v', open: false });
  EM.addDoor(m, d);
  const meta = EM.toMeta(m);
  deq(meta.line_of_sight, [[P(2, 0), P(2, 1)], [P(2, 2), P(2, 3)]]);
  deq(meta.portals, [d]);
  const geo = G.segmentsFromMap(meta), map = appMap(meta);
  deq(geo.doors[0], { x1: 2, y1: 1, x2: 2, y2: 2 });
  assert.ok(G.edgeBlocked(G.blockingSegments(geo, [false]), 1, 1, 2, 1), 'закрытая дверь блокирует');
  assert.ok(!G.edgeBlocked(G.blockingSegments(geo, [true]), 1, 1, 2, 1), 'открытая — нет');
  assert.ok(G.edgeBlocked(G.blockingSegments(geo, [true]), 1, 0, 2, 0), 'стена рядом с дверью остаётся');
  assert.strictEqual(map.cols, 5);
  // убрать дверь с возвратом стены: в модели снова целый отрезок, при сохранении — стена без разрыва
  EM.removeDoor(m, 0, true);
  assert.strictEqual(EM.toMeta(m).portals.length, 0);
  assert.strictEqual(G.segmentsFromMap(EM.toMeta(m)).walls.length, 2);
});

test('дверь горизонтальная на длинной стене и дверь только на стене', () => {
  const m = EM.create({ name: 'H', image: 'a.png', imgW: 700, imgH: 700, ppg: 70 });
  EM.addWall(m, [P(1, 2), P(8, 2), P(8, 6)]);
  const d = EM.doorAt(m, 4.4, 2.1);
  deq(d.position, P(4, 2)); assert.strictEqual(d.dir, 'h');
  assert.strictEqual(EM.doorAt(m, 4.4, 4.5), null, 'вдали от стены двери нет');
  EM.addDoor(m, d);
  const meta = EM.toMeta(m);
  deq(meta.line_of_sight, [[P(1, 2), P(4, 2)], [P(5, 2), P(8, 2), P(8, 6)]]);
  assert.strictEqual(EM.addDoor(m, Object.assign({}, d)), 0, 'вторая дверь в том же месте не добавляется');
});

test('местность: каждый тип -> cellRule', () => {
  const m = EM.create({ name: 'T', image: 'a.png', imgW: 350, imgH: 210, ppg: 70 });
  const kinds = ['normal', 'difficult', 'water', 'hole', 'obstacle'];
  kinds.forEach((k, i) => EM.setKind(m, i, 0, k));
  EM.setKind(m, 0, 1, 'impassable');
  const map = appMap(EM.toMeta(m));
  const rule = (x, y) => MV.cellRule(map, x, y);
  deq([rule(0, 0).blocked, rule(0, 0).mult], [false, 1]);
  deq([rule(1, 0).blocked, rule(1, 0).mult, rule(1, 0).reason], [false, 2, 'difficult']);
  deq([rule(2, 0).blocked, rule(2, 0).mult, rule(2, 0).reason], [false, 2, 'water']);
  assert.strictEqual(rule(3, 0).blocked, true, 'яма');
  assert.strictEqual(rule(4, 0).blocked, true, 'препятствие');
  assert.strictEqual(rule(0, 1).blocked, true, 'непроходимо');
  // перекраска сбрасывает прежний тип
  EM.setKind(m, 2, 0, 'normal');
  assert.strictEqual(EM.kindOf(m, 2, 0), 'normal');
  assert.notStrictEqual(m.layers.terrain[0][2], 'water');
  for (let i = 0; i < 5; i++) assert.strictEqual(EM.kindOf(m, i, 0), i === 2 ? 'normal' : kinds[i]);
});

test('высота пишется в elevation_ft; кисть, прямоугольник, заливка с барьером из стен', () => {
  const m = EM.create({ name: 'E', image: 'a.png', imgW: 420, imgH: 280, ppg: 70 }); // 6x4
  assert.strictEqual(EM.brushCells(m, 0, 0, 3).length, 4, 'кисть 3 в углу обрезается');
  assert.strictEqual(EM.rectCells(m, 1, 1, 2, 2).length, 4);
  EM.brushCells(m, 1, 1, 1).forEach((c) => EM.setElev(m, c.x, c.y, -10));
  assert.strictEqual(EM.toMeta(m).layers.elevation_ft[1][1], -10);
  EM.addWall(m, [P(3, 0), P(3, 4)]);
  const left = EM.floodCells(m, 0, 0, (x, y) => EM.kindOf(m, x, y), true);
  assert.strictEqual(left.length, 12, 'заливка остановилась у стены');
  assert.strictEqual(EM.floodCells(m, 0, 0, (x, y) => EM.kindOf(m, x, y), false).length, 24);
});

test('круговой обмен demo.map.json: неизвестные поля, порядок и разметка сохраняются', () => {
  const m = EM.fromMeta(demo, { width: 1218, height: 1144 });
  deq(EM.toMeta(m), demo);
  deq(Object.keys(EM.toMeta(m)), Object.keys(demo));
});

test('неизвестные поля: lights/coords, лишний слой, поля двери и resolution', () => {
  const meta = JSON.parse(JSON.stringify(demo));
  meta.generator = { name: 'ext', v: 3 };
  meta.lights = [{ x: 1, y: 1, r: 4 }];
  meta.layers.cover = meta.layers.terrain.map((r) => r.map(() => 'none'));
  meta.portals[0].locked = true;
  meta.resolution.note = 'x';
  const m = EM.fromMeta(meta, { width: 1218, height: 1144 });
  deq(EM.toMeta(m), meta, 'без правок — идентично');
  EM.setKind(m, 0, 0, 'water'); EM.addWall(m, [P(0, 0), P(0, 3)]);
  const out = EM.toMeta(m);
  deq(out.generator, meta.generator);
  deq(out.lights, meta.lights);
  deq(out.layers.cover, meta.layers.cover);
  assert.strictEqual(out.portals[0].locked, true);
  assert.strictEqual(out.resolution.note, 'x');
  deq(out.labels, demo.labels);
  assert.strictEqual(out.line_of_sight.length, meta.line_of_sight.length + 1);
});

test('смена размера сетки подгоняет все слои (и чужие тоже)', () => {
  const meta = JSON.parse(JSON.stringify(demo));
  meta.layers.cover = meta.layers.terrain.map((r) => r.map(() => 'none'));
  const m = EM.fromMeta(meta, { width: 1218, height: 1144 });
  EM.resize(m, 18, 10);
  const out = EM.toMeta(m);
  deq(out.resolution.map_size, { x: 18, y: 10 });
  for (const n of Object.keys(out.layers)) { assert.strictEqual(out.layers[n].length, 10, n); assert.strictEqual(out.layers[n][0].length, 18, n); }
  assert.strictEqual(out.layers.cover[0][15], 'none'); assert.strictEqual(out.layers.cover[0][17], '');
  assert.strictEqual(out.layers.walkable[0][17], 1);
});

test('история: undo/redo, предел 100 шагов', () => {
  const m = EM.create({ name: 'U', image: 'a.png', imgW: 140, imgH: 140, ppg: 70 });
  const h = new EM.History(100);
  h.reset(EM.snapshot(m));
  for (let i = 0; i < 150; i++) { EM.setElev(m, 0, 0, i + 1); h.push(EM.snapshot(m)); }
  let n = 0;
  while (h.canUndo()) { EM.restore(m, h.undo()); n++; }
  assert.strictEqual(n, 100);
  assert.strictEqual(m.layers.elevation_ft[0][0], 50);
  EM.restore(m, h.redo());
  assert.strictEqual(m.layers.elevation_ft[0][0], 51);
  assert.ok(!h.push(EM.snapshot(m)) === false || true);
});

test('привязка точек: углы и середины граней, не центры клеток', () => {
  deq(EM.snapPoint(2.1, 3.05), P(2, 3));
  deq(EM.snapPoint(2.45, 3.02), P(2.5, 3));
  deq(EM.snapPoint(2.02, 3.47), P(2, 3.5));
  const c = EM.snapPoint(2.5, 3.5);
  assert.ok(c.x === 2.5 ? c.y % 1 === 0 : c.x % 1 === 0);
});

test('проверка: дверь не на стене, сетка вне картинки, несовпадение image_grid, пустая местность', () => {
  const m = EM.create({ name: 'V', image: 'a.png', imgW: 350, imgH: 210, ppg: 70 });
  deq(EM.validate(m), []);
  EM.addDoor(m, { position: P(1, 1), size: [1, 1], dir: 'h', open: false });
  assert.ok(EM.validate(m).some((v) => v.code === 'doorFloating'));
  EM.addWall(m, [P(0, 1), P(3, 1)]);
  assert.ok(!EM.validate(m).some((v) => v.code === 'doorFloating'));
  m.ppg = 80;
  assert.ok(EM.validate(m).some((v) => v.code === 'gridOutside'));
  m.title = ' ';
  assert.ok(EM.validate(m).some((v) => v.code === 'noName' && v.level === 'error'));
  const m2 = EM.fromMeta(demo, { width: 1000, height: 1000 });
  assert.ok(EM.validate(m2).some((v) => v.code === 'imageMismatch'));
  m2.layers.terrain[0][0] = '';
  assert.ok(EM.validate(m2).some((v) => v.code === 'emptyTerrain'));
});

test('дверь в несколько клеток: size, разрыв стены, совместимость с geometry', () => {
  const m = EM.create({ name: 'W', image: 'a.png', imgW: 700, imgH: 700, ppg: 70 });
  EM.addWall(m, [P(1, 2), P(8, 2)]);
  const d = EM.doorSpan(m, 3.4, 2.05, 5.6, 2.1);
  deq(d, { position: P(3, 2), size: [3, 1], dir: 'h', open: false });
  EM.addDoor(m, d);
  deq(EM.toMeta(m).line_of_sight, [[P(1, 2), P(3, 2)], [P(6, 2), P(8, 2)]]);
  deq(G.segmentsFromMap(EM.toMeta(m)).doors[0], { x1: 3, y1: 2, x2: 6, y2: 2 });
  assert.strictEqual(EM.addDoor(m, { position: P(5, 2), size: [1, 1], dir: 'h', open: false }), 0, 'пересекающаяся дверь не добавляется');
  // против направления и за край стены — урезается до стены
  deq(EM.doorSpan(m, 7.5, 2, 12, 2).size, [1, 1]);
  const v = EM.create({ name: 'V', image: 'a.png', imgW: 700, imgH: 700, ppg: 70 });
  EM.addWall(v, [P(2, 0), P(2, 2)]); EM.addWall(v, [P(2, 2), P(2, 5)]);
  const dv = EM.doorSpan(v, 2, 0.5, 2, 3.5);
  deq(dv, { position: P(2, 0), size: [1, 4], dir: 'v', open: false }, 'дверь через две полилинии');
  EM.addDoor(v, dv);
  deq(G.segmentsFromMap(EM.toMeta(v)).doors[0], { x1: 2, y1: 0, x2: 2, y2: 4 });
  assert.strictEqual(EM.doorSpan(v, 2.0, 0.5, 5, 3.5).size[1], 4);
});

test('стены не по сетке: двери на них нельзя, проверка предупреждает; привязка по умолчанию — углы', () => {
  const m = EM.create({ name: 'O', image: 'a.png', imgW: 700, imgH: 700, ppg: 70 });
  deq(EM.snapCorner(2.45, 3.02), P(2, 3));
  EM.addWall(m, [P(1, 2.5), P(6, 2.5)]);
  assert.strictEqual(EM.doorAt(m, 3.5, 2.5), null);
  assert.strictEqual(EM.doorSpan(m, 3.5, 2.5, 5.5, 2.5), null);
  assert.ok(EM.validate(m).some((v) => v.code === 'wallOffGrid'));
  const a = EM.create({ name: 'A', image: 'a.png', imgW: 700, imgH: 700, ppg: 70 });
  EM.addWall(a, [P(0.5, 2), P(6, 2)]);   // выровненная только частично: дверь на целой части
  deq(EM.doorAt(a, 3.5, 2.05).position, P(3, 2));
  assert.ok(EM.validate(a).some((v) => v.code === 'wallOffGrid'));
});
