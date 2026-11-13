'use strict';
// Каждый ключ, который код/разметка запрашивает у i18n, есть в ru.json; в ru.json нет неиспользуемых ключей;
// locales/<lang>.js синхронизированы с json; наборы ключей ru и en совпадают, подстановки {x} в каждом ключе одинаковы;
// plural-значения имеют столько форм, сколько нужно языку (ru — 3, en — 2).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('./helpers/load');

const SRC = path.join(__dirname, '..', 'src');
const LOC = path.join(SRC, 'renderer', 'locales');
const ru = JSON.parse(fs.readFileSync(path.join(LOC, 'ru.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(LOC, 'en.json'), 'utf8'));
const DICTS = { ru, en };
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

test('plural-ключи содержат нужное число форм (ru 3, en 2), у остальных нет «|»', () => {
  const pluralKeys = new Set();
  for (const f of files) {
    const re = /plural\([^,()]+(?:\([^)]*\))?,\s*'([^']+)'/g;
    const s = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(s))) pluralKeys.add(m[1]);
  }
  const need = { ru: 3, en: 2 };
  for (const [lang, d] of Object.entries(DICTS)) {
    for (const k of pluralKeys) assert.strictEqual(String(d[k]).split('|').length, need[lang], lang + ': ' + k);
    for (const [k, v] of Object.entries(d)) if (!pluralKeys.has(k) && !v.startsWith('|')) assert.ok(!v.includes('|'), 'неожиданный | в ' + lang + ': ' + k);
  }
  const VTT = load();
  assert.strictEqual(VTT.i18n.formCount('ru'), 3);
  assert.strictEqual(VTT.i18n.formCount('en'), 2);
});

test('наборы ключей ru и en совпадают', () => {
  const k = (d) => Object.keys(d).sort();
  const onlyRu = k(ru).filter((x) => !(x in en)), onlyEn = k(en).filter((x) => !(x in ru));
  assert.deepStrictEqual({ onlyRu, onlyEn }, { onlyRu: [], onlyEn: [] });
});

test('подстановки {x} в ru и en совпадают по каждому ключу; en не пустой и не копия ru', () => {
  const ph = (v) => [...new Set(String(v).match(/\{\w+\}/g) || [])].sort().join(',');
  const bad = [];
  for (const k of Object.keys(ru)) {
    if (ph(ru[k]) !== ph(en[k])) bad.push(`${k}: ${ph(ru[k])} vs ${ph(en[k])}`);
    assert.ok(typeof en[k] === 'string' && en[k].trim() !== '', 'пустой перевод ' + k);
  }
  assert.deepStrictEqual(bad, []);
  // «непереведённые» значения (en == ru) допустимы только для нейтральных строк
  const same = Object.keys(ru).filter((k) => ru[k] === en[k] && /[А-Яа-я]/.test(ru[k]));
  assert.deepStrictEqual(same, []);
  const cyr = Object.keys(en).filter((k) => /[А-Яа-яЁё]/.test(en[k]));
  assert.deepStrictEqual(cyr, [], 'кириллица в en.json');
});

test('locales/<lang>.js соответствует <lang>.json', () => {
  for (const lang of Object.keys(DICTS)) {
    const sandbox = { console };
    sandbox.window = sandbox;
    require('vm').createContext(sandbox);
    require('vm').runInContext(fs.readFileSync(path.join(LOC, lang + '.js'), 'utf8'), sandbox);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.VTT.locales[lang])), DICTS[lang], lang + ': запустите npm run build:locales');
  }
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

test('VTT.i18n (en): подстановки, plural в 2 формах, фолбэк на ключ', () => {
  const VTT = load(undefined, { lang: 'en' });
  const { t, plural } = VTT.i18n;
  assert.strictEqual(VTT.i18n.lang, 'en');
  assert.strictEqual(t('combat.toast.initRolled', { n: 3 }), 'Initiative rolled: 3');
  assert.strictEqual(t('token.status.unconscious'), 'Unconscious');
  assert.strictEqual(t('combat.toast.turn', {}), 'Turn: {name}');
  assert.deepStrictEqual([0, 1, 2, 5, 11, 21].map((n) => plural(n, 'blog.entries')),
    ['0 entries', '1 entry', '2 entries', '5 entries', '11 entries', '21 entries']);
});

test('неизвестный язык документа -> ru', () => {
  assert.strictEqual(load(undefined, { lang: 'de' }).i18n.lang, 'ru');
});
