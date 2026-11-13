'use strict';
// Отслеживание папок карт, «Показа» и музыки текущей кампании: fs.watch (recursive) + debounce 500 мс.
// События уходят в окна как 'watch:change' {kind:'maps'|'media'|'music', root, rels:[...]}.
const fs = require('fs');
const campaigns = require('./campaigns');
const windows = require('./windows');
const logger = require('./log');

const DEBOUNCE = 500;
let watchers = [];          // [{key, w, timer, pending:Set}]
let sig = '';

function targets(c) {
  const out = [];
  if (!c) return out;
  const maps = campaigns.rootPath('maps', c);
  if (maps) out.push({ kind: 'maps', root: 'maps', dir: maps });
  const music = campaigns.rootPath('music', c);
  if (music) out.push({ kind: 'music', root: 'music', dir: music });
  for (const m of c.media || []) if (m && m.id && m.path) out.push({ kind: 'media', root: 'media:' + m.id, dir: m.path });
  return out;
}

function closeAll() {
  for (const e of watchers) { clearTimeout(e.timer); try { e.w.close(); } catch (_) {} }
  watchers = [];
}

function watchOne(t) {
  let w;
  try { w = fs.watch(t.dir, { recursive: true, persistent: false }); } catch (e) { logger.log.warn(`watch ${t.root}: ${e.message}`); return null; }
  const e = { t, w, timer: null, pending: new Set() };
  const flush = () => {
    e.timer = null;
    const rels = [...e.pending]; e.pending.clear();
    if (rels.length) windows.broadcast('watch:change', { kind: t.kind, root: t.root, rels });
  };
  w.on('change', (_ev, name) => {
    e.pending.add(name ? String(name).split(String.fromCharCode(92)).join('/') : '');
    clearTimeout(e.timer); e.timer = setTimeout(flush, DEBOUNCE);
  });
  w.on('error', (err) => { logger.log.warn(`watch ${t.root} error: ${err.message}`); });
  return e;
}

/** Пересоздаёт наблюдатели, если набор папок изменился. */
function refresh() {
  const c = campaigns.current();
  const ts = targets(c);
  const next = ts.map((t) => t.root + '=' + t.dir).join('|');
  if (next === sig && watchers.length === ts.length) return;
  closeAll();
  sig = next;
  for (const t of ts) { const e = watchOne(t); if (e) watchers.push(e); }
}

function start() {
  campaigns.bus.on('changed', refresh);
  refresh();
}
function stop() { closeAll(); sig = ''; }

module.exports = { start, stop, refresh, targets };
