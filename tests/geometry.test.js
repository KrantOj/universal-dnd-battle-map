'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load');
const { mkMap, segsOf, P, line } = require('./helpers/map');

const VTT = load();
const G = VTT.geometry;
const segs = (m, open) => segsOf(VTT, m, open);

// ---------- cellName ----------
test('cellName(0,0)=A1', () => {
  assert.strictEqual(G.cellName(0, 0), 'A1');
});
test('cellName(3,5)=D6', () => {
  assert.strictEqual(G.cellName(3, 5), 'D6');
});
test('cellName(25,0)=Z1, (26,0)=AA1, (27,9)=AB10', () => {
  assert.strictEqual(G.cellName(25, 0), 'Z1');
  assert.strictEqual(G.cellName(26, 0), 'AA1');
  assert.strictEqual(G.cellName(27, 9), 'AB10');
});

// ---------- geometry ----------
test('segIntersect: пересечение да, касание концом нет', () => {
  assert.ok(G.segIntersect({ x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 0, y1: 2, x2: 2, y2: 0 }));
  assert.ok(!G.segIntersect({ x1: 0, y1: 0, x2: 1, y2: 1 }, { x1: 1, y1: 1, x2: 2, y2: 0 }), 'касание');
  assert.ok(!G.segIntersect({ x1: 0, y1: 0, x2: 1, y2: 0 }, { x1: 2, y1: 0, x2: 3, y2: 0 }), 'коллинеарные');
});

test('segmentsFromMap: полилинии и двери (h и v)', () => {
  const m = mkMap(6, 6, {
    los: [line(0, 0, 2, 0, 2, 3)],
    portals: [{ position: P(1, 2), size: [1, 1], dir: 'h' }, { position: P(4, 1), size: [1, 1], dir: 'v' }],
  });
  const g = G.segmentsFromMap(m.meta);
  assert.strictEqual(g.walls.length, 2, 'стен');
  assert.strictEqual(JSON.stringify(g.doors[0]), JSON.stringify({ x1: 1, y1: 2, x2: 2, y2: 2 }), 'door h');
  assert.strictEqual(JSON.stringify(g.doors[1]), JSON.stringify({ x1: 4, y1: 1, x2: 4, y2: 2 }), 'door v');
});

test('distToSegment', () => {
  const s = { x1: 0, y1: 0, x2: 4, y2: 0 };
  assert.strictEqual(G.distToSegment(2, 3, s), 3);
  assert.strictEqual(G.distToSegment(-3, 4, s), 5);
  assert.strictEqual(G.distToSegment(2, 0, s), 0);
});

// ---------- видимость ----------
function doorMapV() { // стена x=3 с вертикальной дверью в клетке (3,1)
  return mkMap(7, 3, {
    los: [line(3, 0, 3, 1), line(3, 2, 3, 3)],
    portals: [{ position: P(3, 1), size: [1, 1], dir: 'v' }],
  });
}

test('visibleCells: не видит сквозь стену / сквозь закрытую дверь', () => {
  const m = doorMapV();
  const v = G.visibleCells(m, segs(m, [false]), 1, 1, 10);
  assert.ok(v.indexOf(1 * 7 + 2) >= 0, 'видит клетку до стены');
  assert.ok(v.indexOf(1 * 7 + 5) < 0, 'не видит за стеной (5,1)');
  assert.ok(v.indexOf(0 * 7 + 5) < 0, 'не видит за стеной (5,0)');
});

test('visibleCells: видит сквозь открытую дверь', () => {
  const m = doorMapV();
  const v = G.visibleCells(m, segs(m, [true]), 1, 1, 10);
  assert.ok(v.indexOf(1 * 7 + 5) >= 0, 'видит (5,1) через дверь');
});

test('visibleCells: радиус и препятствия не блокируют обзор', () => {
  const m = mkMap(9, 1, { set: (L) => { L.obstacle[0][2] = 1; } });
  const v = G.visibleCells(m, [], 0, 0, 4);
  assert.ok(v.indexOf(4) >= 0, 'видит (4,0) через препятствие');
  assert.ok(v.indexOf(5) < 0, 'за радиусом');
});

test('луч ровно через угол стены не просачивается; касание торца стены — проходит', () => {
  const Lw = [{ x1: 2, y1: 0, x2: 2, y2: 2 }, { x1: 2, y1: 2, x2: 0, y2: 2 }];
  assert.ok(G.rayBlocked(Lw, 0.5, 0.5, 3.5, 3.5), 'диагональ сквозь угол L-стены заблокирована');
  assert.ok(!G.rayBlocked([Lw[0]], 0.5, 3.5, 3.5, 0.5), 'касание торца одиночной стены не блокирует');
  assert.ok(!G.rayBlocked(Lw, 3.5, 0.5, 0.5, 3.5), 'снаружи угла (обе ветви по одну сторону) — обзор есть');
});
