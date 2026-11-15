'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load');

const VTT = load(['../locales/ru.js', '../locales/en.js', 'i18n.js', 'dice-models.js', 'dice.js', 'dice3d.js']);
const M = VTT.diceModels;

test('dice3d: у каждой модели нужное число граней, значения 1..N, противоположные дают N+1', () => {
  for (const key of ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
    const m = M[key];
    assert.strictEqual(m.faces.length, m.sides, key + ': число граней');
    assert.deepStrictEqual(Array.from(m.faces.map((f) => f.v)).sort((a, b) => a - b), Array.from({ length: m.sides }, (_, i) => i + 1), key + ': значения');
    if (m.sides > 4) {
      for (const f of m.faces) {
        const opp = m.faces.find((g) => g.n[0] * f.n[0] + g.n[1] * f.n[1] + g.n[2] * f.n[2] < -0.98);
        assert.ok(opp, key + ': у грани есть противоположная');
        assert.strictEqual(f.v + opp.v, m.sides + 1, key + ': сумма противоположных');
      }
    }
  }
});

test('dice3d: нормали наружу, «верх» лежит в плоскости грани', () => {
  for (const m of Object.values(M)) {
    for (const f of m.faces) {
      const dn = f.n[0] * f.c[0] + f.n[1] * f.c[1] + f.n[2] * f.c[2];
      assert.ok(dn > 0, 'нормаль смотрит от центра');
      const du = f.u[0] * f.n[0] + f.u[1] * f.n[1] + f.u[2] * f.n[2];
      assert.ok(Math.abs(du) < 0.01, 'u ⟂ n');
      assert.ok(f.r > 0);
    }
  }
});

test('dice3d.expand: d100 → десятки + единицы', () => {
  const e = (v) => VTT.dice3d.expand([{ s: 100, v }]).map((d) => VTT.dice3d.faceLabel(d.mode, d.v));
  assert.deepStrictEqual(Array.from(e(73)), ['70', '3']);
  assert.deepStrictEqual(Array.from(e(100)), ['00', '0']);
  assert.deepStrictEqual(Array.from(e(5)), ['00', '5']);
  assert.deepStrictEqual(Array.from(e(10)), ['10', '0']);
});

test('dice3d.expand: d10 показывает 0 вместо 10, остальные — как есть', () => {
  const lab = (s, v) => { const d = VTT.dice3d.expand([{ s, v }])[0]; return VTT.dice3d.faceLabel(d.mode, d.v); };
  assert.strictEqual(lab(10, 10), '0');
  assert.strictEqual(lab(10, 7), '7');
  assert.strictEqual(lab(20, 10), '10');
});

test('dice3d.plan: нестандартные кубики и большие горсти → null (запасной 2D)', () => {
  assert.ok(VTT.dice3d.plan([{ s: 20, v: 3 }]));
  assert.strictEqual(VTT.dice3d.plan([{ s: 7, v: 3 }]), null);
  assert.strictEqual(VTT.dice3d.plan(Array.from({ length: 11 }, () => ({ s: 6, v: 1 }))), null);
  assert.strictEqual(VTT.dice3d.plan([]), null);
  assert.strictEqual(VTT.dice3d.plan(null), null);
});

test('dice.faces: кубики броска с флагом «учтён»', () => {
  const seq = [0.99, 0.0, 0.5];   // d6: 6, 1, 4
  let i = 0;
  const r = VTT.dice.roll('3d6dl1+2', () => seq[i++]);
  const f = VTT.dice.faces(r);
  assert.strictEqual(f.length, 3);
  assert.deepStrictEqual(Array.from(f.map((d) => d.s)), [6, 6, 6]);
  assert.deepStrictEqual(Array.from(f.map((d) => d.v)), [6, 1, 4]);
  assert.deepStrictEqual(Array.from(f.map((d) => d.k)), [true, false, true]);
});
