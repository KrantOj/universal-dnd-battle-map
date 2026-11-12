'use strict';
// Экспорт/импорт кампании (.udbm): связка archive.js с кампаниями, kv и настройками.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const campaigns = require('./campaigns');
const kv = require('./kv');
const archive = require('./archive');
const pu = require('./pathutil');
const settings = require('./settings');

const incOf = (o) => ({ maps: !!(o && o.maps), media: !!(o && o.media), battlelog: !!(o && o.battlelog) });
function need() {
  const c = campaigns.current();
  if (!c) throw new Error('NO_CAMPAIGN');
  return c;
}

const speedOf = (key) => { const v = settings.get()[key]; return v > 0 ? v : archive.DEFAULT_SPEED; };
function learn(key, bytes, t0) {
  try { settings.set({ [key]: archive.nextSpeed(speedOf(key), bytes, Date.now() - t0) }); } catch (_) { /* не критично */ }
}

function estimate(include) {
  const r = archive.estimate(need(), incOf(include));
  r.speed = speedOf('archiveSpeed');
  r.seconds = archive.etaSeconds(r.bytes, r.speed);
  return r;
}

function exportCurrent(dest, include) {
  const c = need();
  kv.flushAll();
  const t0 = Date.now();
  const r = archive.exportTo(dest, c, incOf(include), app.getVersion());
  learn('archiveSpeed', r.inBytes, t0);
  return { path: dest, bytes: r.bytes, files: r.files };
}

function inspect(file) {
  const m = archive.readManifest(file);
  return {
    name: m.campaign.name, app: m.app || '', created: m.created || '', include: m.include || {},
    media: (m.campaign.media || []).length, fileBytes: fs.statSync(file).size,
    seconds: archive.etaSeconds(fs.statSync(file).size, speedOf('archiveImportSpeed')),
    defaultDataDir: campaigns.defaultDataDir(m.campaign.name),
  };
}

/** opts: {mode:'new'|'replace', dataDir?, name?} -> Campaign */
function importFile(file, opts) {
  const t0 = Date.now(), size = fs.statSync(file).size;
  const r = importFile0(file, opts);
  learn('archiveImportSpeed', size, t0);
  return r;
}

function importFile0(file, opts) {
  const o = opts || {};
  const manifest = archive.readManifest(file);
  if (o.mode === 'replace') {
    const cur = need();
    const inc = manifest.include || {};
    const f = cur.folders;
    const t = { data: f.data, maps: null, battlelog: null, media: {} };
    const patch = { folders: {}, media: null };
    if (inc.maps && manifest.campaign.folders.maps) { t.maps = f.maps || path.join(f.data, 'maps'); if (!f.maps) patch.folders.maps = t.maps; }
    if (inc.battlelog && manifest.campaign.folders.battlelog) { t.battlelog = f.battlelog || path.join(f.data, 'battlelog'); if (!f.battlelog) patch.folders.battlelog = t.battlelog; }
    const media = (cur.media || []).map((m) => Object.assign({}, m));
    if (inc.media) {
      for (const m of manifest.campaign.media) {
        if (!m.path) continue;
        let ex = media.find((x) => x.id === m.id);
        if (!ex) { ex = { id: m.id, label: m.label, path: '', recursive: !!m.recursive, exclude: m.exclude || null }; media.push(ex); }
        if (!ex.path) ex.path = path.join(f.data, 'media', pu.safeName(m.id, 'm'));
        t.media[m.id] = ex.path;
      }
      patch.media = media;
    }
    kv.flushAll();
    const res = archive.extractTo(file, manifest, archive.mappingOf(manifest, t));
    kv.invalidate(f.data);
    const clean = {};
    if (Object.keys(patch.folders).length) clean.folders = patch.folders;
    if (patch.media) clean.media = patch.media;
    const c = campaigns.update(cur.id, clean);   // шлёт campaigns:changed
    return Object.assign({}, c, { _import: res });
  }
  const dataDir = o.dataDir;
  if (!dataDir || typeof dataDir !== 'string') throw new Error('DATA_DIR_REQUIRED');
  const dd = path.resolve(dataDir);
  if (campaigns.list().some((x) => x.folders && x.folders.data && path.resolve(x.folders.data) === dd)) throw new Error('DATA_DIR_IN_USE');
  const t = archive.targetsUnder(manifest, dd);
  const res = archive.extractTo(file, manifest, archive.mappingOf(manifest, t));
  const c = campaigns.create(archive.campaignFromManifest(manifest, t, o.name && String(o.name).trim()));
  return Object.assign({}, c, { _import: res });
}

module.exports = { estimate, exportCurrent, inspect, importFile };
