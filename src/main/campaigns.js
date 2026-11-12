'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { app } = require('electron');
const store = require('./store');
const settings = require('./settings');
const { t } = require('./i18n');
const { safeName } = require('./pathutil');
const datafiles = require('./datafiles');

const bus = new EventEmitter();
const dir = () => path.join(app.getPath('userData'), 'campaigns');
const fileOf = (id) => path.join(dir(), `${safeName(id)}.json`);

const MERGE_KEYS = ['folders', 'battlelog', 'playerWindow', 'prefs'];
function merge(c, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'id' || k === 'created') continue;
    if (MERGE_KEYS.includes(k) && v && typeof v === 'object') c[k] = Object.assign({}, c[k], v);
    else if (k === 'media') c.media = Array.isArray(v) ? v.slice() : [];
    else c[k] = v;
  }
  return c;
}

function defaultDataDir(name) {
  return path.join(app.getPath('documents'), 'Universal DnD Battle map', safeName(name || t('campaign.defaultName')));
}

function defaults(partial) {
  const p = partial || {};
  const now = new Date().toISOString();
  const name = String(p.name || t('campaign.defaultName'));
  const c = {
    id: p.id || crypto.randomUUID(),
    name, created: now, updated: now,
    folders: { data: defaultDataDir(name), maps: null, battlelog: null, music: null },
    media: [],
    battlelog: { enabled: true },
    playerWindow: { auto: true, displayId: null, fullscreen: true },
    prefs: {},
  };
  merge(c, p);
  if (!c.folders.data) c.folders.data = defaultDataDir(name);
  return c;
}

function list() {
  let names = [];
  try { names = fs.readdirSync(dir()).filter((n) => n.endsWith('.json')); } catch (_) {}
  return names.map((n) => store.readJson(path.join(dir(), n), null)).filter((c) => c && c.id)
    .sort((a, b) => String(a.created).localeCompare(String(b.created)));
}
function get(id) { return id ? store.readJson(fileOf(id), null) : null; }
function current() { return get(settings.get().currentCampaign); }
function emitChanged() { bus.emit('changed', current()); }

function create(partial) {
  const c = defaults(partial);
  fs.mkdirSync(c.folders.data, { recursive: true });
  store.writeJson(fileOf(c.id), c);
  settings.set({ currentCampaign: c.id });
  emitChanged();
  return c;
}
function update(id, patch) {
  const c = get(id);
  if (!c) throw new Error('CAMPAIGN_NOT_FOUND');
  merge(c, patch);
  c.updated = new Date().toISOString();
  if (c.folders && c.folders.data) { try { fs.mkdirSync(c.folders.data, { recursive: true }); } catch (_) {} }
  store.writeJson(fileOf(id), c);
  const cur = current();
  if (cur && cur.id === id) emitChanged();
  return c;
}
function switchTo(id) {
  const c = get(id);
  if (!c) throw new Error('CAMPAIGN_NOT_FOUND');
  settings.set({ currentCampaign: id });
  emitChanged();
  return c;
}
/** Копия настроек: новая кампания с новой пустой папкой данных; карты/«Показ»/журналы — те же папки. Текущей не становится. */
function duplicate(id) {
  const src = get(id);
  if (!src) throw new Error('CAMPAIGN_NOT_FOUND');
  const name = t('campaigns.copyName', { name: src.name });
  let data = defaultDataDir(name), n = 2;
  while (fs.existsSync(data)) data = defaultDataDir(name) + ' ' + (n++);
  const c = defaults({
    name, folders: Object.assign({}, src.folders, { data }),
    media: JSON.parse(JSON.stringify(src.media || [])),
    battlelog: Object.assign({}, src.battlelog), playerWindow: Object.assign({}, src.playerWindow),
    prefs: JSON.parse(JSON.stringify(src.prefs || {})),
  });
  fs.mkdirSync(c.folders.data, { recursive: true });
  store.writeJson(fileOf(c.id), c);
  return c;
}
function remove(id, opts) {
  const c = get(id);
  if (!c) return;
  const wasCurrent = settings.get().currentCampaign === id;
  try { fs.unlinkSync(fileOf(id)); } catch (_) {}
  if (opts && opts.deleteData && c.folders && c.folders.data) {
    const d = path.resolve(c.folders.data);
    const shared = list().some((o) => o.folders && o.folders.data && path.resolve(o.folders.data) === d);
    const unsafe = path.parse(d).root === d || [app.getPath('home'), app.getPath('documents'), app.getPath('desktop')].some((p) => path.resolve(p) === d);
    if (!shared && !unsafe) {
      bus.emit('data-removed', d);
      try { datafiles.removeOwned(d); } catch (_) {}   // только файлы приложения; чужое не трогаем, папку — лишь если опустела
    }
  }
  if (wasCurrent) {
    const rest = list();
    settings.set({ currentCampaign: rest.length ? rest[0].id : null });
    emitChanged();
  }
}

/** Смена папки данных кампании; move=true — перенести файлы приложения из старой папки. kv к этому моменту уже сброшен вызывающим. */
function relocateData(id, newDir, move) {
  const c = get(id);
  if (!c) throw new Error('CAMPAIGN_NOT_FOUND');
  if (!newDir || typeof newDir !== 'string') throw new Error('DATA_DIR_REQUIRED');
  const from = c.folders && c.folders.data, to = path.resolve(newDir);
  if (list().some((o) => o.id !== id && o.folders && o.folders.data && path.resolve(o.folders.data) === to)) throw new Error('DATA_DIR_IN_USE');
  fs.mkdirSync(to, { recursive: true });
  let moved = 0;
  if (move && from) {
    const shared = list().some((o) => o.id !== id && o.folders && o.folders.data && path.resolve(o.folders.data) === path.resolve(from));
    if (!shared) moved = datafiles.moveOwned(from, to).moved;
  }
  const r = update(id, { folders: { data: to } });
  return Object.assign({}, r, { _moved: moved });
}

/** Absolute base folder of a root in the current campaign, or null if not set. */
function rootPath(root, c) {
  c = c || current();
  if (!c) return null;
  if (root === 'data') return c.folders.data || null;
  if (root === 'maps' || root === 'music') return c.folders[root] || null;
  if (root === 'battlelog') return (c.battlelog && c.battlelog.enabled === false) ? null : (c.folders.battlelog || null);
  if (typeof root === 'string' && root.startsWith('media:')) {
    const m = (c.media || []).find((x) => x.id === root.slice(6));
    return m ? m.path || null : null;
  }
  return null;
}

module.exports = { bus, list, get, current, create, update, switchTo, remove, duplicate, relocateData, emitChanged, rootPath, defaults, defaultDataDir };
