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

const FORMAT = 'udbm/1';
const FORMAT_MAJOR = 1;
const IMG_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
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
    if (name.startsWith(m.prefix)) return pu.resolveIn(m.dir, name.slice(m.prefix.length));
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

/** Список файлов для экспорта: [{name, abs, size, part}] */
function collect(c, include) {
  const f = c.folders || {};
  const out = [];
  const push = (prefix, part, list) => list.forEach((x) => out.push({ name: prefix + x.rel, abs: x.abs, size: x.size, part }));
  const others = [];
  if (f.maps) others.push(f.maps);
  if (f.battlelog) others.push(f.battlelog);
  (c.media || []).forEach((m) => { if (m.path) others.push(m.path); });
  const inData = others.filter((o) => f.data && pu.isInside(f.data, o) && path.resolve(o) !== path.resolve(f.data));
  if (f.data) {
    push('data/', 'data', walk(f.data, [path.join(f.data, 'thumbs')].concat(inData), (n) => !/\.tmp$/i.test(n) && n !== '.DS_Store' && n !== 'Thumbs.db', [], ''));
  }
  if (include && include.maps && f.maps) push('maps/', 'maps', walk(f.maps, [], null, [], ''));
  if (include && include.battlelog && f.battlelog) push('battlelog/', 'battlelog', walk(f.battlelog, [], null, [], ''));
  if (include && include.media) {
    for (const m of c.media || []) {
      if (!m.path) continue;
      let re = null; if (m.exclude) { try { re = new RegExp(m.exclude, 'i'); } catch (_) { re = null; } }
      const list = walk(m.path, [], (n, r) => IMG_RE.test(n) && !(re && re.test(n)) && (m.recursive || r.indexOf('/') < 0), [], '');
      push(mediaPrefix(m.id), 'media', list);
    }
  }
  return out;
}

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
  return { bytes: written, files: files.length, manifest };
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
  collect, estimate, exportTo, readManifest, extractTo,
};
