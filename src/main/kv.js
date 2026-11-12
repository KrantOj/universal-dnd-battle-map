'use strict';
// Per-campaign KV in <data>/kv.json, write-through with debounce.
const path = require('path');
const store = require('./store');
const campaigns = require('./campaigns');

const cache = new Map(); // file -> {file, data, timer}

function entry() {
  const c = campaigns.current();
  if (!c || !c.folders.data) throw new Error('ROOT_NOT_SET:data');
  const file = path.join(c.folders.data, 'kv.json');
  let e = cache.get(file);
  if (!e) { e = { file, data: store.readJson(file, {}) || {}, timer: null }; cache.set(file, e); }
  return e;
}
function flushEntry(e) {
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  try { store.writeJson(e.file, e.data); } catch (_) {}
}
function get(key) { const v = entry().data[key]; return v === undefined ? null : v; }
function set(key, value) {
  const e = entry();
  if (value === null || value === undefined) delete e.data[key]; else e.data[key] = value;
  if (!e.timer) e.timer = setTimeout(() => flushEntry(e), 300);
}
function flushAll() { for (const e of cache.values()) if (e.timer) flushEntry(e); }

module.exports = { get, set, flushAll };
