'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const pu = require('../src/main/pathutil');
const fsapi = require('../src/main/fsapi');

const base = path.resolve(process.platform === 'win32' ? 'C:\\data\\camp' : '/data/camp');

test('resolveIn: normal paths', () => {
  assert.strictEqual(pu.resolveIn(base, ''), base);
  assert.strictEqual(pu.resolveIn(base, 'a/b.txt'), path.join(base, 'a', 'b.txt'));
  assert.strictEqual(pu.resolveIn(base, './a//b'), path.join(base, 'a', 'b'));
  assert.strictEqual(pu.resolveIn(base, 'карты/Тест файл.png'), path.join(base, 'карты', 'Тест файл.png'));
});

test('resolveIn: traversal rejected', () => {
  for (const bad of ['..', '../x', 'a/../../x', 'a/..', '..\\x', '/etc/passwd', '\\x', 'C:\\x', 'C:/x', 'a\0b']) {
    assert.throws(() => pu.resolveIn(base, bad), /BAD_PATH/, bad);
  }
  assert.throws(() => pu.resolveIn(base, 123), /BAD_PATH/);
  assert.throws(() => pu.resolveIn('', 'a'), /BAD_ROOT/);
});

test('isInside: sibling prefix is not inside; case-insensitive on win32', () => {
  assert.strictEqual(pu.isInside(base, base + 'evil'), false);
  assert.strictEqual(pu.isInside(base, path.join(base, 'x')), true);
  assert.strictEqual(pu.isInside(base, path.dirname(base)), false);
  if (process.platform === 'win32') assert.strictEqual(pu.isInside(base, path.join(base.toUpperCase(), 'x')), true);
});

test('toRel / safeName', () => {
  assert.strictEqual(pu.toRel(base, path.join(base, 'a', 'b.png')), 'a/b.png');
  assert.strictEqual(pu.safeName('a/b:c*?'), 'a_b_c__');
  assert.strictEqual(pu.safeName('  '), 'item');
  assert.strictEqual(pu.safeName('x.', 'f'), 'x');
});

test('parseUserfileUrl', () => {
  assert.deepStrictEqual(pu.parseUserfileUrl('userfile://r/maps/a%20b/%D1%84.png'), { root: 'maps', rel: 'a b/ф.png' });
  assert.deepStrictEqual(pu.parseUserfileUrl('userfile://r/media%3Aabc/x/y.mp3'), { root: 'media:abc', rel: 'x/y.mp3' });
  assert.strictEqual(pu.parseUserfileUrl('http://r/maps/a'), null);
  const p = pu.parseUserfileUrl('userfile://r/maps/..%2F..%2Fsecret');
  assert.throws(() => pu.resolveIn(base, p.rel), /BAD_PATH/);
});

test('fsapi re-exports helpers and BOM strip', () => {
  assert.strictEqual(fsapi.resolveIn, pu.resolveIn);
  assert.strictEqual(fsapi.stripBom(Buffer.from([0xef, 0xbb, 0xbf, 0x41])).toString(), 'A');
  assert.strictEqual(fsapi.stripBom(Buffer.from('A')).toString(), 'A');
});
