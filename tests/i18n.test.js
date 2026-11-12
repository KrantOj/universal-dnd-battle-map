'use strict';
// Каждый ключ, который код/разметка запрашивает у i18n, есть в ru.json; в ru.json нет неиспользуемых ключей;
// locales/ru.js синхронизирован с ru.json; plural-значения имеют 3 формы; подстановки {x} понятны.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('./helpers/load');

const SRC = path.join(__dirname, '..', 'src');
const LOC = path.join(SRC, 'renderer', 'locales');
const ru = JSON.parse(fs.readFileSync(path.join(LOC, 'ru.json'), 'utf8'));
const have = new Set(Object.keys(ru));

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) { if (n.name !== 'locales') walk(p, out); }
    else if (/\.(js|html)$/.test(n.name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);

// точные обращения: tr('k') / t('k') / VTT.i18n.t('k') / i18n.t('k') / plural(n, 'k') / data-i18n*="k"
const CALL = /(?:\btr|\bt|i18n\.t|\.plural)\(\s*(?:[^'"()]*?,\s*)?'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+)'/g;
const ATTR = /data-i18n(?:-html|-title|-placeholder|-aria)?="([^"]+)"/g;
const LITERAL = /(['"])([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)*\.?)\1/g;

const requested = new Map();   // key -> файл
const literals = new Set();    // любые строковые литералы (для динамических префиксов 'a.b.' + x)
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = CALL.exec(s))) requested.set(m[1], path.basename(f));
  while ((m = ATTR.exec(s))) requested.set(m[1], path.basename(f));
  while ((m = LITERAL.exec(s))) literals.add(m[2]);
}

test('все запрошенные ключи есть в ru.json', () => {
  const missing = [...requested].filter(([k]) => !have.has(k)).map(([k, f]) => `${k} (${f})`);
  assert.deepStrictEqual(missing, []);
  assert.ok(requested.size > 100, 'найдено подозрительно мало обращений: ' + requested.size);
});

test('в ru.json нет неиспользуемых ключей', () => {
  const prefixes = [...literals].filter((l) => l.endsWith('.'));
  const used = (k) => requested.has(k) || literals.has(k) || prefixes.some((p) => k.startsWith(p));
  const unused = [...have].filter((k) => !used(k));
  assert.deepStrictEqual(unused, []);
});

test('plural-ключи содержат 3 формы, у остальных нет «|»', () => {
  const pluralKeys = new Set();
  for (const f of files) {
    const re = /plural\([^,()]+(?:\([^)]*\))?,\s*'([^']+)'/g;
    const s = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(s))) pluralKeys.add(m[1]);
  }
  for (const k of pluralKeys) assert.strictEqual(String(ru[k]).split('|').length, 3, k);
  for (const [k, v] of Object.entries(ru)) if (!pluralKeys.has(k) && !v.startsWith('|')) assert.ok(!v.includes('|'), 'неожиданный | в ' + k);
});

test('locales/ru.js соответствует ru.json', () => {
  const sandbox = { console };
  sandbox.window = sandbox;
  require('vm').createContext(sandbox);
  require('vm').runInContext(fs.readFileSync(path.join(LOC, 'ru.js'), 'utf8'), sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.VTT.locales.ru)), ru, 'запустите npm run build:locales');
});

test('VTT.i18n: подстановки, plural, фолбэк на ключ', () => {
  const VTT = load();
  const { t, plural } = VTT.i18n;
  assert.strictEqual(t('combat.toast.initRolled', { n: 3 }), 'Брошено инициатив: 3');
  assert.strictEqual(t('no.such.key'), 'no.such.key');
  assert.strictEqual(t('combat.toast.turn', {}), 'Ход: {name}');
  const f = (n) => plural(n, 'blog.entries');
  assert.deepStrictEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 100, 101, 111].map(f),
    ['1 запись', '2 записи', '4 записи', '5 записей', '11 записей', '12 записей', '14 записей', '21 запись', '22 записи', '25 записей', '100 записей', '101 запись', '111 записей']);
});

test('ошибки dice.js локализованы через i18n', () => {
  const VTT = load();
  assert.throws(() => VTT.dice.roll(''), /Пустая формула/);
  assert.throws(() => VTT.dice.roll('9999d6'), /Кубиков за раз: от 1 до \d+/);
});
