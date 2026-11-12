'use strict';
// Папка данных может быть чужой (хранилище заметок): экспорт, импорт, удаление и перенос трогают только файлы приложения.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const df = require('../src/main/datafiles');
const archive = require('../src/main/archive');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `udbm-df-${n}-`));
const w = (p, d) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, d || 'x'); };

function vault(dir) {
  w(path.join(dir, 'scenes', 'a.scene.json'), '{"map":"a"}');
  w(path.join(dir, 'scenes', 'notes.md'), 'foreign in scenes');
  w(path.join(dir, 'library.tokens.json'), '{}');
  w(path.join(dir, 'kv.json'), '{}');
  w(path.join(dir, 'thumbs', 'h.jpg'), 'T');
  w(path.join(dir, 'Музыка', 'song.mp3'), 'MP3');
  w(path.join(dir, '.obsidian', 'app.json'), '{}');
  w(path.join(dir, 'Заметка.md'), '# hi');
}

test('isOwnedRel: только список приложения', () => {
  for (const r of ['kv.json', 'library.tokens.json', 'scenes/x.scene.json', 'thumbs/h.jpg', 'scenes' + String.fromCharCode(92) + 'x.scene.json']) assert.ok(df.isOwnedRel(r), r);
  for (const r of ['Заметка.md', 'scenes/notes.md', 'Музыка/a.mp3', 'scenes/sub/x.scene.json', '.obsidian/app.json', 'kv.json.bak']) assert.ok(!df.isOwnedRel(r), r);
});

test('inspect: находит чужие файлы', () => {
  const d = tmp('insp'); vault(d);
  const i = df.inspect(d);
  assert.ok(i.foreignCount >= 3 && i.owned === 4);
  assert.ok(i.foreign.includes('Заметка.md'));
  const e = tmp('empty');
  assert.strictEqual(df.inspect(e).foreignCount, 0);
  w(path.join(e, 'kv.json')); w(path.join(e, 'scenes', 'q.scene.json'));
  assert.strictEqual(df.inspect(e).foreignCount, 0);
});

test('removeOwned: чужое выживает, папка остаётся', () => {
  const d = tmp('rm'); vault(d);
  const r = df.removeOwned(d);
  assert.strictEqual(r.removed, 4);
  assert.strictEqual(r.folderRemoved, false);
  assert.ok(fs.existsSync(path.join(d, 'Музыка', 'song.mp3')));
  assert.ok(fs.existsSync(path.join(d, '.obsidian', 'app.json')));
  assert.ok(fs.existsSync(path.join(d, 'Заметка.md')));
  assert.ok(fs.existsSync(path.join(d, 'scenes', 'notes.md')));
  assert.ok(!fs.existsSync(path.join(d, 'kv.json')) && !fs.existsSync(path.join(d, 'thumbs')));
});

test('removeOwned: пустая после удаления папка убирается', () => {
  const d = tmp('rm2'); w(path.join(d, 'kv.json')); w(path.join(d, 'scenes', 'a.scene.json'));
  assert.strictEqual(df.removeOwned(d).folderRemoved, true);
  assert.ok(!fs.existsSync(d));
});

test('moveOwned: переносит своё, чужое остаётся', () => {
  const a = tmp('mva'), b = path.join(tmp('mvb'), 'sub'); vault(a);
  assert.strictEqual(df.moveOwned(a, b).moved, 4);
  assert.ok(fs.existsSync(path.join(b, 'scenes', 'a.scene.json')) && fs.existsSync(path.join(b, 'kv.json')));
  assert.ok(!fs.existsSync(path.join(b, 'Заметка.md')) && !fs.existsSync(path.join(b, 'Музыка')));
  assert.ok(!fs.existsSync(path.join(a, 'kv.json')));
  assert.ok(fs.existsSync(path.join(a, 'Музыка', 'song.mp3')) && fs.existsSync(path.join(a, 'scenes', 'notes.md')));
});

test('экспорт data: только файлы приложения, без thumbs и чужого', () => {
  const d = tmp('exp'); vault(d);
  const c = { id: 'x', name: 'V', folders: { data: d }, media: [], battlelog: {}, playerWindow: {}, prefs: {} };
  const names = archive.collect(c, {}).map((x) => x.name).sort();
  assert.deepStrictEqual(names, ['data/kv.json', 'data/library.tokens.json', 'data/scenes/a.scene.json']);
});

test('импорт: чужие записи data/ в архиве игнорируются', () => {
  const dir = tmp('imp');
  const map = [{ prefix: 'data/', dir }];
  assert.ok(archive.resolveEntry('data/kv.json', map));
  assert.strictEqual(archive.resolveEntry('data/Заметка.md', map), null);
  assert.strictEqual(archive.resolveEntry('data/Музыка/a.mp3', map), null);
});
