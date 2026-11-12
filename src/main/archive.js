'use strict';
// Экспорт/импорт кампании в один файл .udbm (zip через fflate). Без Electron — тестируется отдельно.
// Раскладка архива:
//   manifest.json                 — {format:'udbm/1', app, created, include, campaign (папки заменены метками)}
//   data/…                        — папка данных (сцены, библиотека, kv/закрепления…; без thumbs/)
//   maps/… · media/<id>/… · battlelog/…   — по галочкам
const fs = require('fs');
const path = require('path');
const { Zip, ZipDeflate, Unzip, UnzipInflate } = require('fflate');
const pu = require('./pathutil');
const datafiles = require('./datafiles');
const mediaFilter = require('../renderer/js/media-filter');

const FORMAT = 'udbm/1';
const FORMAT_MAJOR = 1;
const LEGACY_LIB = 'Библиотека токенов.vtt.json';
const DEFAULT_SPEED = 11 * 1024 * 1024;   // байт/с: замерено 3.3 ГБ за ~5 мин
const NO_COMPRESS_RE = /\.(png|jpe?g|webp|gif|zip|udbm|mp3|ogg|flac|m4a|opus|aac)$/i;

const mediaPrefix = (id) => `media/${pu.safeName(id, 'm')}/`;

// ---------------------------------------------------------------- manifest (чисто)
function buildManifest(c, include, appVersion, now) {
  const inc = { maps: !!(include && include.maps), media: !!(include && include.media), battlelog: !!(include && include.battlelog) };
  const f = c.folders || {};
  return {
    format: FORMAT,
    app: appVersion,
    created: (now || new Date()).toISOString(),
    include: inc,
    campaign: {
      name: c.name,
      folders: { data: 'data', maps: f.maps ? 'maps' : null, battlelog: f.battlelog ? 'battlelog' : null, music: null },
      media: (c.media || []).map((m) => ({ id: m.id, label: m.label, path: m.path ? mediaPrefix(m.id).slice(0, -1) : null, recursive: !!m.recursive, exclude: m.exclude || null })),
      battlelog: Object.assign({}, c.battlelog),
      playerWindow: Object.assign({}, c.playerWindow),
      prefs: JSON.parse(JSON.stringify(c.prefs || {})),
    },
  };
}

/** Проверка manifest. Бросает Error('ARCHIVE_NOT_UDBM') / Error('ARCHIVE_FORMAT:<format>'). */
function parseManifest(m) {
  if (!m || typeof m !== 'object' || typeof m.format !== 'string' || !/^udbm\//.test(m.format) || !m.campaign) throw new Error('ARCHIVE_NOT_UDBM');
  const major = parseInt(m.format.slice(5), 10);
  if (!Number.isFinite(major) || major !== FORMAT_MAJOR) throw new Error('ARCHIVE_FORMAT:' + m.format);
  return m;
}

/** Куда распаковывать по умолчанию для новой кампании: всё под dataDir. */
function targetsUnder(manifest, dataDir) {
  const inc = manifest.include || {};
  const t = { data: dataDir, maps: null, battlelog: null, media: {} };
  if (inc.maps && manifest.campaign.folders.maps) t.maps = path.join(dataDir, 'maps');
  if (inc.battlelog && manifest.campaign.folders.battlelog) t.battlelog = path.join(dataDir, 'battlelog');
  if (inc.media) for (const m of manifest.campaign.media) if (m.path) t.media[m.id] = path.join(dataDir, 'media', pu.safeName(m.id, 'm'));
  return t;
}

/** Таблица «префикс в архиве -> папка на диске» из targets. */
function mappingOf(manifest, targets) {
  const map = [{ prefix: 'data/', dir: targets.data }];
  if (targets.maps) map.push({ prefix: 'maps/', dir: targets.maps });
  if (targets.battlelog) map.push({ prefix: 'battlelog/', dir: targets.battlelog });
  for (const m of manifest.campaign.media) if (targets.media && targets.media[m.id]) map.push({ prefix: mediaPrefix(m.id), dir: targets.media[m.id] });
  return map;
}

/** Профиль кампании (partial для campaigns.create) по manifest и targets: метки -> реальные пути. */
function campaignFromManifest(manifest, targets, name) {
  const c = manifest.campaign;
  return {
    name: name || c.name,
    folders: { data: targets.data, maps: targets.maps || null, battlelog: targets.battlelog || null, music: null },
    media: c.media.map((m) => ({ id: m.id, label: m.label, path: (targets.media && targets.media[m.id]) || '', recursive: !!m.recursive, exclude: m.exclude || null })),
    battlelog: Object.assign({ enabled: true }, c.battlelog),
    playerWindow: Object.assign({}, c.playerWindow),
    prefs: c.prefs || {},
  };
}

/** Имя записи архива -> абсолютный путь на диске или null (manifest, каталоги, неизвестные префиксы). Бросает BAD_PATH на обходе каталогов. */
function resolveEntry(name, mapping) {
  if (name === 'manifest.json' || name.endsWith('/')) return null;
  for (const m of mapping) {
    if (name.startsWith(m.prefix)) {
      const rel = name.slice(m.prefix.length);
      const abs = pu.resolveIn(m.dir, rel);   // сначала проверка обхода каталогов (BAD_PATH)
      if (m.prefix === 'data/' && !datafiles.isOwnedRel(rel)) return null;   // в папку данных пишем только своё
      return abs;
    }
  }
  return null;
}

// ---------------------------------------------------------------- сбор файлов
function walk(dir, skipDirs, filter, out, rel) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (skipDirs.some((s) => pu.isInside(s, full))) continue;
      walk(full, skipDirs, filter, out, r);
    } else if (e.isFile()) {
      if (filter && !filter(e.name, r)) continue;
      let st; try { st = fs.statSync(full); } catch (_) { continue; }
      out.push({ abs: full, rel: r, size: st.size });
    }
  }
  return out;
}

/** Карты: *.map.json (рекурсивно) + картинка из поля image (относительно json) + старая библиотека токенов в корне. -> [{rel, abs, size}] */
function collectMaps(root) {
  const out = [], seen = new Set();
  const add = (abs) => {
    const key = path.resolve(abs).toLowerCase();
    if (seen.has(key)) return;
    let st; try { st = fs.statSync(abs); } catch (_) { return; }
    if (!st.isFile()) return;
    seen.add(key);
    out.push({ abs, rel: path.relative(root, abs).split(path.sep).join('/'), size: st.size });
  };
  const jsons = walk(root, [], (n) => /\.map\.json$/i.test(n), [], '');
  for (const j of jsons) {
    add(j.abs);
    let img = null;
    try { const d = JSON.parse(fs.readFileSync(j.abs, 'utf8')); if (d && typeof d.image === 'string' && d.image) img = d.image; } catch (_) { /* битый json — только он сам */ }
    if (!img) continue;
    let abs; try { abs = pu.resolveIn(path.dirname(j.abs), img); } catch (_) { continue; }
    if (pu.isInside(root, abs)) add(abs);
  }
  add(path.join(root, LEGACY_LIB));
  return out;
}

/** Файлы источника «Показа»: те же правила, что в каталоге (renderer/js/media-filter.js). */
function collectMedia(m) {
  return walk(m.path, [], mediaFilter.make(m), [], '');
}

/** Список файлов для экспорта: [{name, abs, size, part}] */
function collect(c, include) {
  const f = c.folders || {};
  const out = [];
  const push = (prefix, part, list) => list.forEach((x) => out.push({ name: prefix + x.rel, abs: x.abs, size: x.size, part }));
  if (f.data) {
    // только файлы приложения (datafiles.js): папка данных может быть чужой (хранилище заметок и т.п.); thumbs — кэш, не экспортируется
    push('data/', 'data', datafiles.ownedFiles(f.data, { cache: false }).filter((x) => !/\.tmp$/i.test(x.rel)));
  }
  if (include && include.maps && f.maps) push('maps/', 'maps', collectMaps(f.maps));
  if (include && include.battlelog && f.battlelog) push('battlelog/', 'battlelog', walk(f.battlelog, [], (n) => /\.md$/i.test(n), [], ''));
  if (include && include.media) {
    for (const m of c.media || []) if (m.path) push(mediaPrefix(m.id), 'media', collectMedia(m));
  }
  return out;
}

// ---------------------------------------------------------------- время
/** Новая оценка скорости (байт/с): экспоненциальное среднее; мусорные замеры игнорируются. */
function nextSpeed(prev, bytes, ms) {
  if (!(bytes > 0) || !(ms > 0) || bytes < 1024 * 1024) return prev > 0 ? prev : DEFAULT_SPEED;   // слишком мало данных для замера
  const cur = bytes / (ms / 1000);
  const p = prev > 0 ? prev : DEFAULT_SPEED;
  return Math.round(0.5 * p + 0.5 * cur);
}
const etaSeconds = (bytes, speed) => Math.ceil(bytes / (speed > 0 ? speed : DEFAULT_SPEED));

function estimate(c, include) {
  const files = collect(c, include);
  const parts = { data: 0, maps: 0, media: 0, battlelog: 0 };
  let bytes = 0;
  for (const x of files) { parts[x.part] += x.size; bytes += x.size; }
  return { bytes, files: files.length, parts };
}

// ---------------------------------------------------------------- запись
function addFile(zip, name, abs, size) {
  const level = NO_COMPRESS_RE.test(name) ? 0 : 6;   // deflate-store (а не «stored»): потоковый Unzip читает оба одинаково
  const zf = new ZipDeflate(name, { level });
  zip.add(zf);
  if (!size) { zf.push(new Uint8Array(0), true); return; }
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let left = size;
    while (left > 0) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), null);
      if (n <= 0) break;
      left -= n;
      zf.push(new Uint8Array(buf.subarray(0, n)), left <= 0);
    }
    if (left > 0) zf.push(new Uint8Array(0), true);   // файл усох во время чтения
  } finally { fs.closeSync(fd); }
}

/** Пишет .udbm в dest. -> {bytes, files, manifest} */
function exportTo(dest, c, include, appVersion) {
  const files = collect(c, include);
  const manifest = buildManifest(c, include, appVersion);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  let written = 0, err = null;
  const zip = new Zip((e, chunk) => {
    if (e) { err = err || e; return; }
    fs.writeSync(fd, chunk); written += chunk.length;
  });
  try {
    const mb = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    const mf = new ZipDeflate('manifest.json', { level: 6 });
    zip.add(mf); mf.push(new Uint8Array(mb), true);
    for (const x of files) addFile(zip, x.name, x.abs, x.size);
    zip.end();
  } catch (e) { err = err || e; }
  fs.closeSync(fd);
  if (err) { try { fs.unlinkSync(tmp); } catch (_) {} throw err; }
  try { fs.unlinkSync(dest); } catch (_) {}
  fs.renameSync(tmp, dest);
  return { bytes: written, files: files.length, manifest, inBytes: files.reduce((a, x) => a + x.size, 0) };
}

// ---------------------------------------------------------------- чтение
/** Потоковый обход записей: onEntry(name) -> null (пропустить) | (chunk,final)=>void. shouldStop(): прервать чтение. */
function scan(file, onEntry, shouldStop) {
  const u = new Unzip((f) => {
    const sink = onEntry(f.name);
    if (!sink) return;
    f.ondata = (e, chunk, final) => { if (e) throw e; sink(chunk, final); };
    f.start();
  });
  u.register(UnzipInflate);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    do {
      n = fs.readSync(fd, buf, 0, buf.length, null);
      u.push(new Uint8Array(buf.subarray(0, n)), n === 0);
      if (shouldStop && shouldStop()) break;
    } while (n > 0);
  } finally { fs.closeSync(fd); }
}

function readManifest(file) {
  const parts = [];
  let done = false;
  try {
    scan(file, (name) => (name === 'manifest.json' ? (chunk, final) => { parts.push(Buffer.from(chunk)); if (final) done = true; } : null), () => done);
  } catch (e) { throw new Error('ARCHIVE_NOT_UDBM'); }
  if (!done) throw new Error('ARCHIVE_NOT_UDBM');
  let m;
  try { m = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (_) { throw new Error('ARCHIVE_NOT_UDBM'); }
  return parseManifest(m);
}

/** Распаковка по mapping. -> {files, bytes} */
function extractTo(file, manifest, mapping) {
  let files = 0, bytes = 0;
  scan(file, (name) => {
    const dest = resolveEntry(name, mapping);
    if (!dest) return null;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.udbm-tmp';
    const fd = fs.openSync(tmp, 'w');
    return (chunk, final) => {
      if (chunk && chunk.length) { fs.writeSync(fd, chunk); bytes += chunk.length; }
      if (final) {
        fs.closeSync(fd);
        try { fs.unlinkSync(dest); } catch (_) {}
        fs.renameSync(tmp, dest);
        files++;
      }
    };
  });
  return { files, bytes };
}

module.exports = {
  FORMAT, buildManifest, parseManifest, targetsUnder, mappingOf, campaignFromManifest, resolveEntry,
  LEGACY_LIB, DEFAULT_SPEED, nextSpeed, etaSeconds, collectMaps, collectMedia,
  collect, estimate, exportTo, readManifest, extractTo,
};
