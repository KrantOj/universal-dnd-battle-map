'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseRange, mimeOf } = require('../src/main/range');

test('Range: обычные формы', () => {
  assert.deepStrictEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepStrictEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepStrictEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.deepStrictEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  assert.deepStrictEqual(parseRange('bytes=0-0,5-9', 1000), { start: 0, end: 0 });
});

test('Range: без заголовка/мусор -> весь файл (null), за пределами -> invalid (416)', () => {
  assert.strictEqual(parseRange(undefined, 10), null);
  assert.strictEqual(parseRange(null, 10), null);
  assert.strictEqual(parseRange('', 10), null);
  assert.strictEqual(parseRange('items=0-5', 10), null);
  assert.strictEqual(parseRange('bytes=-', 10), null);
  assert.strictEqual(parseRange('bytes=10-20', 10), 'invalid');
  assert.strictEqual(parseRange('bytes=5-2', 10), 'invalid');
  assert.strictEqual(parseRange('bytes=-0', 10), 'invalid');
  assert.strictEqual(parseRange('bytes=0-5', 0), 'invalid');
});

test('mime по расширению', () => {
  assert.strictEqual(mimeOf('a/b/Track.MP3'), 'audio/mpeg');
  assert.strictEqual(mimeOf('x.ogg'), 'audio/ogg');
  assert.strictEqual(mimeOf('x.webp'), 'image/webp');
  assert.strictEqual(mimeOf('noext'), 'application/octet-stream');
});
