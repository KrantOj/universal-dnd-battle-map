'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load');
const { mkMap, segsOf, P, line } = require('./helpers/map');

const VTT = load();
const G = VTT.geometry;
const M = VTT.movement;
const segs = (m, open) => segsOf(VTT, m, open);

// ---------- movement: базовое ----------
test('прямой путь без препятствий: 4 клетки = 20 фт', () => {
  const m = mkMap(10, 10);
  const r = M.findPath(m, segs(m), P(0, 0), P(4, 0), { diagonal: '5', size: 1 });
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 20);
  assert.strictEqual(r.path.length, 5);
  assert.ok(!r.difficult);
});

test('путь вокруг стены', () => {
  // вертикальная стена x=3 от y=0 до y=4, проход только в нижнем ряду (y=4)
  const m = mkMap(7, 5, { los: [line(3, 0, 3, 4)] });
  const s = segs(m);
  const r = M.findPath(m, s, P(1, 0), P(5, 0), { diagonal: '5', size: 1 });
  assert.ok(r.ok, 'путь не найден');
  assert.ok(r.feet > 20, 'должен быть длиннее прямого: ' + r.feet);
  for (let i = 1; i < r.path.length; i++) {
    const a = r.path[i - 1], b = r.path[i];
    assert.ok(!G.edgeBlocked(s, a.x, a.y, b.x, b.y), 'шаг через стену');
  }
  const r2 = M.findPath(m, s, P(1, 0), P(5, 0), { diagonal: '5', size: 1, free: true });
  assert.strictEqual(r2.feet, 20, 'free идёт напрямую');
});

test("диагонали '5': 2 диагонали = 10 фт", () => {
  const m = mkMap(10, 10);
  assert.strictEqual(M.findPath(m, [], P(0, 0), P(2, 2), { diagonal: '5' }).feet, 10);
});

test("диагонали '5-10-5': 2 = 15 фт, 3 = 20 фт", () => {
  const m = mkMap(10, 10);
  assert.strictEqual(M.findPath(m, [], P(0, 0), P(2, 2), { diagonal: '5-10-5' }).feet, 15);
  assert.strictEqual(M.findPath(m, [], P(0, 0), P(3, 3), { diagonal: '5-10-5' }).feet, 20);
});

test('труднопроходимая клетка удваивает стоимость входа', () => {
  const m = mkMap(5, 1, { set: (L) => { L.difficult[0][2] = 1; } });
  const r = M.findPath(m, [], P(0, 0), P(4, 0), { diagonal: '5' });
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 25);
  assert.ok(r.difficult, 'difficult=true');
});

test('вода (walkable=0) ×2; не-вода с walkable=0 — блок', () => {
  const w = mkMap(5, 1, { set: (L) => { L.walkable[0][2] = 0; L.terrain[0][2] = 'deep_water'; } });
  const r = M.findPath(w, [], P(0, 0), P(4, 0), { diagonal: '5' });
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 25);
  assert.ok(r.difficult);
  assert.strictEqual(M.cellRule(w, 2, 0).reason, 'water');

  const b = mkMap(5, 1, { set: (L) => { L.walkable[0][2] = 0; L.terrain[0][2] = 'wall'; } });
  assert.ok(M.cellRule(b, 2, 0).blocked);
  assert.ok(!M.findPath(b, [], P(0, 0), P(4, 0), { diagonal: '5' }).ok);
});

test('shallow с walkable=1 — обычная клетка', () => {
  const m = mkMap(3, 1, { set: (L) => { L.terrain[0][1] = 'shallow'; } });
  assert.strictEqual(M.findPath(m, [], P(0, 0), P(2, 0), {}).feet, 10);
});

test('препятствие (obstacle) блокирует', () => {
  const m = mkMap(5, 1, { set: (L) => { L.obstacle[0][2] = 1; } });
  assert.ok(M.cellRule(m, 2, 0).blocked);
  assert.ok(!M.findPath(m, [], P(0, 0), P(4, 0), {}).ok);
});

test('яма (hazard=hole) блокирует', () => {
  const m = mkMap(5, 1, { set: (L) => { L.hazard[0][2] = 'hole'; } });
  assert.ok(M.cellRule(m, 2, 0).blocked);
  const r = M.findPath(m, [], P(0, 0), P(4, 0), {});
  assert.ok(!r.ok);
  assert.strictEqual(r.feet, Infinity);
  assert.strictEqual(r.path.length, 1);
});

test('срез угла стены запрещён по диагонали', () => {
  // стена x=2 от y=0 до y=1 (между (1,0) и (2,0)). Диагональ (1,1)->(2,0) режет угол.
  const m = mkMap(4, 4, { los: [line(2, 0, 2, 1)] });
  const r = M.findPath(m, segs(m), P(1, 1), P(2, 0), { diagonal: '5' });
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 10, 'с углом стены обход = 10 фт');
  const m0 = mkMap(4, 4);
  assert.strictEqual(M.findPath(m0, [], P(1, 1), P(2, 0), { diagonal: '5' }).feet, 5, 'контроль без стены');
});

test('срез угла: стена-горизонталь между орто-соседом и целью', () => {
  // стена y=1 от x=1 до x=2: между (1,0) и (1,1). Диагональ (0,0)->(1,1): шаг (0,0)->(0,1) ок, (0,1)->(1,1) ок,
  // (0,0)->(1,0) ок, (1,0)->(1,1) стена => запрещено
  const m = mkMap(4, 4, { los: [line(1, 1, 2, 1)] });
  assert.strictEqual(M.findPath(m, segs(m), P(0, 0), P(1, 1), { diagonal: '5' }).feet, 10);
});

// ---------- двери ----------
function doorMapV() { // стена x=3 с вертикальной дверью в клетке (3,1)
  return mkMap(7, 3, {
    los: [line(3, 0, 3, 1), line(3, 2, 3, 3)],
    portals: [{ position: P(3, 1), size: [1, 1], dir: 'v' }],
  });
}
function doorMapH() { // стена y=3 с горизонтальной дверью в клетке (1,3)
  return mkMap(3, 7, {
    los: [line(0, 3, 1, 3), line(2, 3, 3, 3)],
    portals: [{ position: P(1, 3), size: [1, 1], dir: 'h' }],
  });
}

test('закрытая дверь (v) блокирует, открытая пропускает', () => {
  const m = doorMapV();
  assert.ok(!M.findPath(m, segs(m, [false]), P(1, 1), P(5, 1), {}).ok, 'закрыта');
  const r = M.findPath(m, segs(m, [true]), P(1, 1), P(5, 1), {});
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 20);
});

test('закрытая дверь (h) блокирует, открытая пропускает', () => {
  const m = doorMapH();
  assert.ok(!M.findPath(m, segs(m, [false]), P(1, 1), P(1, 5), {}).ok, 'закрыта');
  const r = M.findPath(m, segs(m, [true]), P(1, 1), P(1, 5), {});
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 20);
});

// ---------- крупные токены, занятые клетки, free ----------
test('токен size 2 не пролезает в проход шириной 1 клетка', () => {
  // стена x=4 с проходом в одну клетку: y от 2 до 3
  const m = mkMap(8, 6, { los: [line(4, 0, 4, 2), line(4, 3, 4, 6)] });
  const s = segs(m);
  assert.ok(M.findPath(m, s, P(2, 2), P(6, 2), { size: 1 }).ok, 'size1 проходит');
  assert.ok(!M.findPath(m, s, P(2, 2), P(5, 2), { size: 2 }).ok, 'size2 не проходит');
  const open = mkMap(8, 6);
  const r = M.findPath(open, [], P(2, 2), P(5, 2), { size: 2 });
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 15);
  assert.ok(!M.findPath(open, [], P(2, 2), P(7, 2), { size: 2 }).ok, 'за краем карты');
});

test('занятая клетка назначения → ok:false; транзитом проходима', () => {
  const m = mkMap(5, 1);
  const occ = new Set([3]);
  assert.ok(!M.findPath(m, [], P(0, 0), P(3, 0), { occupied: occ }).ok);
  const occ2 = new Set([2]);
  const r = M.findPath(m, [], P(0, 0), P(4, 0), { occupied: occ2 });
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 20);
});

test('free: путь [from,to], игнорирует стены; формулы feet', () => {
  const m = mkMap(10, 10, { los: [line(2, 0, 2, 10)] });
  const r = M.findPath(m, segs(m), P(0, 0), P(4, 2), { free: true, diagonal: '5' });
  assert.ok(r.ok);
  assert.strictEqual(r.feet, 20);
  assert.strictEqual(r.path.length, 2);
  assert.strictEqual(M.findPath(m, segs(m), P(0, 0), P(4, 2), { free: true, diagonal: '5-10-5' }).feet, 25);
  assert.strictEqual(M.findPath(m, segs(m), P(0, 0), P(3, 3), { free: true, diagonal: '5-10-5' }).feet, 20);
});

test('elevFrom/elevTo берутся из elevation_ft', () => {
  const m = mkMap(3, 1, { set: (L) => { L.elevation_ft[0][2] = 10; } });
  const r = M.findPath(m, [], P(0, 0), P(2, 0), {});
  assert.strictEqual(r.elevFrom, 0);
  assert.strictEqual(r.elevTo, 10);
});

test('reach: клетки в пределах бюджета', () => {
  const m = mkMap(10, 10);
  const r = M.reach(m, [], P(0, 0), 15, { diagonal: '5' });
  assert.strictEqual(r.get(0), 0);
  assert.strictEqual(r.get(3), 15);
  assert.ok(!r.has(4));
  assert.strictEqual(r.get(3 * 10 + 3), 15);
});
