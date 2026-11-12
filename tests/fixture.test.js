'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('./helpers/load');

const VTT = load();
const G = VTT.geometry;
const M = VTT.movement;

// Демо-карта из тестовой фикстуры (формат как у генератора карт: данные в корне json, meta — сам файл).
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'demo.map.json'), 'utf8'));
const map = {
  name: raw.name,
  cols: raw.resolution.map_size.x,
  rows: raw.resolution.map_size.y,
  ppg: raw.resolution.pixels_per_grid,
  feet: raw.feet_per_cell,
  meta: raw,
};
const doorsOpen = raw.portals.map((p) => p.open);
const segs = G.blockingSegments(G.segmentsFromMap(map.meta), doorsOpen);
const P = (x, y) => ({ x, y });

function stepsClear(path, s) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (G.edgeBlocked(s, a.x, a.y, b.x, b.y)) return false;
  }
  return true;
}

test('fixture: размеры, слои и двери', () => {
  assert.strictEqual(map.cols, 16);
  assert.strictEqual(map.rows, 12);
  assert.strictEqual(map.feet, 5);
  assert.strictEqual(raw.image, 'demo (VTT).png');
  assert.strictEqual(raw.portals.length, 2);
  assert.deepStrictEqual(doorsOpen, [false, true], 'одна дверь закрыта, одна открыта');
  assert.strictEqual(M.cellRule(map, 0, 0).blocked, false, 'A1 проходима');
  assert.strictEqual(M.cellRule(map, 5, 4).reason, 'water', 'пруд — вода');
  assert.strictEqual(M.cellRule(map, 10, 7).blocked, true, 'яма блокирует');
});

test('findPath: путь между проходимыми клетками найден по сетке', () => {
  const from = P(0, 0), to = P(15, 11);
  assert.strictEqual(M.cellRule(map, from.x, from.y).blocked, false);
  assert.strictEqual(M.cellRule(map, to.x, to.y).blocked, false);
  const r = M.findPath(map, segs, from, to, {});
  assert.ok(r.ok, 'путь найден');
  assert.deepStrictEqual([r.path[0].x, r.path[0].y], [0, 0]);
  const last = r.path[r.path.length - 1];
  assert.deepStrictEqual([last.x, last.y], [15, 11]);
  assert.ok(r.feet >= 75, 'не короче цепочки диагоналей: ' + r.feet);
  assert.ok(stepsClear(r.path, segs), 'ни один шаг не режет стену');
});

test('findPath: вход в комнату через открытую дверь', () => {
  // прямо вверх по колонне x=7: проём в нижней стене — открытая дверь (7,9)
  const r = M.findPath(map, segs, P(7, 11), P(7, 5), {});
  assert.ok(r.ok, 'через открытую дверь путь есть');
  assert.strictEqual(r.feet, 30, '6 клеток по прямой');
  // та же прямая при закрытых дверях — входа нет
  const closed = G.blockingSegments(G.segmentsFromMap(map.meta), [false, false]);
  assert.ok(!M.findPath(map, closed, P(7, 11), P(7, 5), {}).ok, 'закрытые двери не пропускают');
});

test('стена блокирует прямую линию, путь идёт в обход', () => {
  // верхняя стена комнаты (y=2) стоит между (4,0) и (4,5)
  assert.ok(G.rayBlocked(segs, 4.5, 0.5, 4.5, 5.5), 'прямой луч заблокирован стеной');
  const r = M.findPath(map, segs, P(4, 0), P(4, 5), {});
  assert.ok(r.ok, 'обход найден');
  assert.ok(r.feet > 25, 'обход длиннее прямых 25 фт: ' + r.feet);
  assert.ok(stepsClear(r.path, segs), 'обход не режет стену');
});
