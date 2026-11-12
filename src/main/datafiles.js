'use strict';
// ЕДИНСТВЕННЫЙ список того, что приложение пишет в папку данных кампании (data).
// Папку данных пользователь может выбрать «грязную» (хранилище заметок и т.п.), поэтому экспорт, импорт,
// удаление и перенос трогают ТОЛЬКО эти пути — всё остальное в папке чужое.
//   scenes/<id>.scene.json   — сцены карт                      (main/scenes.js)
//   library.tokens.json      — библиотека токенов              (renderer/js/store.js)
//   kv.json                  — закрепления «Показа», незавершённый бой и пр. (main/kv.js)
//   thumbs/<hash>.jpg        — кэш миниатюр «Показа»           (renderer/js/media.js); не экспортируется
// Временные *.tmp рядом с ними (атомарная запись) считаются своими.
const fs = require('fs');
const path = require('path');
const pu = require('./pathutil');

const FILES = ['library.tokens.json', 'kv.json'];
const DIRS = [
  { name: 'scenes', test: (n) => /[.]scene[.]json([.][^/]*[.]tmp)?$/.test(n), cache: false },
  { name: 'thumbs', test: (n) => /\.(jpe?g|tmp)$/i.test(n), cache: true },
];
const SUBFOLDER = 'Universal DnD Battle map';

const norm = (rel) => String(rel).split(String.fromCharCode(92)).join('/');
const tmpOf = (n) => /\.tmp$/.test(n);

/** Относительный путь (от data) принадлежит приложению? */
function isOwnedRel(rel) {
  const p = norm(rel).split('/');
  if (p.length === 1) return FILES.some((f) => p[0] === f || (tmpOf(p[0]) && p[0].startsWith(f + '.')));
  if (p.length === 2) { const d = DIRS.find((x) => x.name === p[0]); return !!(d && d.test(p[1])); }
  return false;
}
const isCacheRel = (rel) => norm(rel).startsWith('thumbs/');

function readdir(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; } }

/** Файлы приложения в папке: [{abs, rel, size}]. opts.cache=false — без кэша (thumbs). */
function ownedFiles(dir, opts) {
  const withCache = !opts || opts.cache !== false;
  const out = [];
  const add = (abs, rel) => { try { const st = fs.statSync(abs); if (st.isFile()) out.push({ abs, rel, size: st.size }); } catch (_) {} };
  for (const e of readdir(dir)) {
    if (e.isFile() && isOwnedRel(e.name)) add(path.join(dir, e.name), e.name);
    else if (e.isDirectory()) {
      const d = DIRS.find((x) => x.name === e.name);
      if (!d || (d.cache && !withCache)) continue;
      for (const f of readdir(path.join(dir, e.name))) if (f.isFile() && d.test(f.name)) add(path.join(dir, e.name, f.name), e.name + '/' + f.name);
    }
  }
  return out;
}

/** Всё, что в папке НЕ принадлежит приложению: имена верхнего уровня (с учётом чужих файлов внутри scenes/ и thumbs/). */
function foreignEntries(dir) {
  const out = [];
  for (const e of readdir(dir)) {
    const d = e.isDirectory() && DIRS.find((x) => x.name === e.name);
    if (d) { if (readdir(path.join(dir, e.name)).some((f) => !(f.isFile() && d.test(f.name)))) out.push(e.name + '/'); }
    else if (!(e.isFile() && isOwnedRel(e.name))) out.push(e.isDirectory() ? e.name + '/' : e.name);
  }
  return out;
}

/** Сводка по папке для диалога выбора: {exists, owned, foreign:[…до 5], foreignCount}. */
function inspect(dir) {
  let exists = false;
  try { exists = fs.statSync(dir).isDirectory(); } catch (_) {}
  if (!exists) return { exists: false, owned: 0, foreign: [], foreignCount: 0 };
  const f = foreignEntries(dir);
  return { exists: true, owned: ownedFiles(dir).length, foreign: f.slice(0, 5), foreignCount: f.length };
}

function rmdirIfEmpty(d) { try { if (!fs.readdirSync(d).length) { fs.rmdirSync(d); return true; } } catch (_) {} return false; }

/** Удаляет ТОЛЬКО файлы приложения, затем пустые scenes/, thumbs/ и (если остался пустым) саму папку. -> {removed, folderRemoved} */
function removeOwned(dir) {
  let removed = 0;
  for (const f of ownedFiles(dir)) { try { fs.unlinkSync(f.abs); removed++; } catch (_) {} }
  for (const d of DIRS) rmdirIfEmpty(path.join(dir, d.name));
  return { removed, folderRemoved: rmdirIfEmpty(dir) };
}

const MOVE_TMP = '.udbmmv.tmp';

/**
 * Переносит файлы приложения из from в to, транзакционно: сначала всё копируется во временные файлы рядом с целью
 * и проверяется по размеру; настоящие имена в to появляются только после того, как скопировано ВСЁ; оригиналы удаляются в самом конце.
 * При любой ошибке временные файлы убираются, to и from остаются как были.
 * opts.merge=true — файлы, уже существующие в to, не трогаем (они остаются и в from); иначе перезаписываем. -> {moved, skipped}
 */
function moveOwned(from, to, opts) {
  const a = path.resolve(from), b = path.resolve(to);
  if (a.toLowerCase() === b.toLowerCase()) return { moved: 0, skipped: 0 };
  const merge = !!(opts && opts.merge);
  const plan = [];
  let skipped = 0;
  for (const f of ownedFiles(a)) {
    const dest = pu.resolveIn(b, f.rel);
    if (merge && fs.existsSync(dest)) { skipped++; continue; }
    plan.push({ f, dest, tmp: dest + MOVE_TMP });
  }
  const made = [], newDirs = [];
  try {
    for (const x of plan) {
      const dir = path.dirname(x.dest);
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); newDirs.push(dir); }
      fs.copyFileSync(x.f.abs, x.tmp);
      made.push(x.tmp);
      if (fs.statSync(x.tmp).size !== x.f.size) throw new Error('MOVE_VERIFY_FAILED');
    }
    const renamed = [];
    for (const x of plan) { fs.renameSync(x.tmp, x.dest); renamed.push(x); made.splice(made.indexOf(x.tmp), 1); }
  } catch (e) {
    for (const t of made) { try { fs.unlinkSync(t); } catch (_) {} }
    for (const d of newDirs.reverse()) rmdirIfEmpty(d);
    throw e;
  }
  for (const x of plan) { try { fs.unlinkSync(x.f.abs); } catch (_) {} }
  for (const d of DIRS) rmdirIfEmpty(path.join(a, d.name));
  rmdirIfEmpty(a);
  return { moved: plan.length, skipped };
}

module.exports = { FILES, DIRS, SUBFOLDER, isOwnedRel, isCacheRel, ownedFiles, foreignEntries, inspect, removeOwned, moveOwned };
