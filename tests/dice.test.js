'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load');

const VTT = load();

// rng, выдающий заданные значения кубика с гранями sides (по кругу)
function fixed(vals, sides) {
  let i = 0;
  return () => (vals[i++ % vals.length] - 1 + 0.5) / sides;
}

test('dice: 2d6+3 — сумма и константа', () => {
  const r = VTT.dice.roll('2d6+3', fixed([4, 5], 6));
  assert.strictEqual(r.total, 12);
  assert.strictEqual(r.parts.length, 2);
});

test('dice: вычитание и пробелы', () => {
  assert.strictEqual(VTT.dice.roll(' d20 - 2 ', fixed([10], 20)).total, 8);
});

test('dice: kh1 (преимущество) оставляет больший', () => {
  const r = VTT.dice.roll('2d20kh1', fixed([7, 15], 20));
  assert.strictEqual(r.total, 15);
  assert.ok(r.text.indexOf('(7)') >= 0, 'отброшенный в скобках: ' + r.text);
});

test('dice: adv/dis суффиксы и русские буквы', () => {
  assert.strictEqual(VTT.dice.roll('d20 adv', fixed([3, 18], 20)).total, 18);
  assert.strictEqual(VTT.dice.roll('d20+2 dis', fixed([3, 18], 20)).total, 5);
  assert.strictEqual(VTT.dice.roll('2д6', fixed([2, 3], 6)).total, 5);
});

test('dice: 4d6dl1 отбрасывает младший', () => {
  assert.strictEqual(VTT.dice.roll('4d6dl1', fixed([1, 6, 5, 4], 6)).total, 15);
});

test('dice: d20 — натуральное значение для крита', () => {
  assert.strictEqual(VTT.dice.roll('d20+5', fixed([20], 20)).d20, 20);
  assert.strictEqual(VTT.dice.roll('2d20kh1', fixed([1, 1], 20)).d20, 1);
  assert.strictEqual(VTT.dice.roll('2d6', fixed([1, 1], 6)).d20, null);
});

test('dice: плохие формулы дают понятную ошибку', () => {
  ['', 'abc', '2d', '0d6', '101d6', 'd1', '2d6++3', '2d6 adv', '2d6kh3'].forEach((e) => {
    assert.throws(
      () => VTT.dice.parse(e),
      (err) => !!err.message,
      'должно быть исключение: «' + e + '»'
    );
  });
});

test('dice: реальный rng — всегда в пределах', () => {
  for (let i = 0; i < 500; i++) {
    const v = VTT.dice.roll('d20').total;
    assert.ok(v >= 1 && v <= 20, 'вне диапазона ' + v);
  }
});
