'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load } = require('./helpers/load');
const diceskins = require('../src/main/diceskins');

const VTT = load(['../locales/ru.js', '../locales/en.js', 'i18n.js', 'dice-skin.js']);
const S = VTT.diceSkin;

test('skin.normalize: мусор → значения по умолчанию, диапазоны ограничены', () => {
  const s = S.normalize({ body: { color: 'red', metalness: 7, roughness: -3, mapScale: 'x' }, numbers: { glow: 'nope', size: 99 }, edges: { opacity: 5 } }, 'x');
  assert.strictEqual(s.body.color, '#2b3a56');
  assert.strictEqual(s.body.metalness, 1);
  assert.strictEqual(s.body.roughness, 0.05);
  assert.strictEqual(s.body.mapScale, 1);
  assert.strictEqual(s.numbers.glow, '');
  assert.strictEqual(s.numbers.size, 1.3);
  assert.strictEqual(s.edges.opacity, 1);
  assert.strictEqual(S.normalize(null).id, 'classic');
  assert.strictEqual(S.normalize('строка').body.color, '#2b3a56');
});

test('skin.normalize: имена файлов — только безопасные картинки внутри папки', () => {
  const b = (map) => S.normalize({ body: { map } }).body.map;
  assert.strictEqual(b('body.png'), 'body.png');
  assert.strictEqual(b('tex/body.JPG'), '');            // подпапки не поддерживаются
  assert.strictEqual(b('../body.png'), '');
  assert.strictEqual(b('C:' + String.fromCharCode(92) + 'x.png'), '');
  assert.strictEqual(b('script.js'), '');
  assert.strictEqual(b('a..png'), '');
});

test('skin.normalize: с текстурой цвет по умолчанию белый, без неё — цвет «Классики»', () => {
  assert.strictEqual(S.normalize({ body: { map: 'a.png' } }).body.color, '#ffffff');
  assert.strictEqual(S.normalize({ body: { map: 'a.png', color: '#112233' } }).body.color, '#112233');
  assert.strictEqual(S.normalize({}).body.color, '#2b3a56');
});

test('skin.normalize: название — строка или {ru,en}; шрифт очищается от опасных символов', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(S.normalize({ name: 'Лёд' }).name)), { ru: 'Лёд', en: 'Лёд' });
  assert.strictEqual(S.normalize({ name: { en: 'Ice' } }, 'u').name.ru, 'Ice');
  assert.ok(!/[;{}<>]/.test(S.normalize({ numbers: { font: 'Arial; } body{display:none' } }).numbers.font));
});

test('встроенные скины: все валидны, classic есть, цвета — #rrggbb', () => {
  assert.ok(S.BUILTIN_IDS.includes('classic'));
  for (const id of S.BUILTIN_IDS) {
    const s = S.builtin(id);
    assert.ok(s, id);
    for (const c of [s.body.color, s.edges.color, s.numbers.color, s.numbers.outline]) assert.match(c, /^#[0-9a-f]{6}$/, id);
  }
  assert.strictEqual(S.builtin('нет такого'), null);
  assert.strictEqual(S.builtin('constructor'), null);
});

// ---- чтение папки скинов (главный процесс, без Electron)
function mkdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'udbm-skins-')); }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('diceskins.list/get: читает skin.json и картинки как data URL', () => {
  const dir = mkdir();
  fs.mkdirSync(path.join(dir, 'Мой камень'));
  fs.writeFileSync(path.join(dir, 'Мой камень', 'skin.json'), JSON.stringify({ name: { ru: 'Камень', en: 'Stone' }, body: { map: 'a.png', normalMap: 'n.png', roughnessMap: 'evil.exe' } }));
  fs.writeFileSync(path.join(dir, 'Мой камень', 'a.png'), PNG);
  fs.writeFileSync(path.join(dir, 'Мой камень', 'n.png'), PNG);
  fs.writeFileSync(path.join(dir, 'Мой камень', 'evil.exe'), 'MZ');
  fs.mkdirSync(path.join(dir, 'пустая'));                              // без skin.json — пропускается
  assert.deepStrictEqual(diceskins.list(dir, 'ru'), [{ id: 'user:Мой камень', name: 'Камень' }]);
  assert.strictEqual(diceskins.list(dir, 'en')[0].name, 'Stone');
  const r = diceskins.get(dir, 'user:Мой камень');
  assert.deepStrictEqual(Object.keys(r.files).sort(), ['a.png', 'n.png']);     // .exe не читается
  assert.ok(r.files['a.png'].startsWith('data:image/png;base64,'));
});

test('diceskins.get: выход за пределы папки и чужие id запрещены', () => {
  const dir = mkdir();
  fs.mkdirSync(path.join(dir, 's'));
  fs.writeFileSync(path.join(dir, 's', 'skin.json'), JSON.stringify({ body: { map: '../secret.png' } }));
  fs.writeFileSync(path.join(dir, 'secret.png'), PNG);
  assert.throws(() => diceskins.get(dir, 'user:s'), /BAD_PATH/);
  for (const bad of ['user:..', 'user:../s', 'user:', 'classic', 'user:a/b', 5, null]) assert.throws(() => diceskins.get(dir, bad), /BAD_SKIN_ID|BAD_PATH/);
});

test('diceskins: слишком большой skin.json и картинка отклоняются', () => {
  const dir = mkdir();
  fs.mkdirSync(path.join(dir, 'big'));
  fs.writeFileSync(path.join(dir, 'big', 'skin.json'), '{"x":"' + 'a'.repeat(diceskins.MAX_JSON) + '"}');
  assert.throws(() => diceskins.get(dir, 'user:big'), /BAD_SKIN_JSON/);
  assert.deepStrictEqual(diceskins.list(dir, 'ru'), []);
  fs.mkdirSync(path.join(dir, 'img'));
  fs.writeFileSync(path.join(dir, 'img', 'skin.json'), '{"body":{"map":"a.png"}}');
  fs.writeFileSync(path.join(dir, 'img', 'a.png'), Buffer.alloc(diceskins.MAX_IMG + 1));
  assert.throws(() => diceskins.get(dir, 'user:img'), /BAD_SKIN_IMAGE/);
});

test('пример скина из docs/dice-skin-example читается и проходит нормализацию', () => {
  const dir = path.join(__dirname, '..', 'docs');
  const r = diceskins.get(dir, 'user:dice-skin-example');
  const s = S.normalize(r.skin, 'user:x');
  assert.strictEqual(s.body.map, 'body.png');
  assert.ok(r.files['body.png'] && r.files['body_normal.png']);
});
