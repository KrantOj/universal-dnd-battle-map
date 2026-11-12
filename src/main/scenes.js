'use strict';
const fsapi = require('./fsapi');
const { safeName } = require('./pathutil');

const rel = (id) => `scenes/${safeName(id, '_')}.scene.json`;

function load(mapId) {
  try { return JSON.parse(fsapi.readText('data', rel(mapId))); } catch (e) {
    if ((e && e.code === 'ENOENT') || e instanceof SyntaxError) return null;
    throw e;
  }
}
function save(scene) {
  if (!scene || !scene.map) throw new Error('SCENE_NO_MAP');
  fsapi.writeText('data', rel(scene.map), JSON.stringify(scene));
}
function list() {
  return fsapi.list('data', 'scenes').filter((e) => !e.isDir && e.name.endsWith('.scene.json')).map((e) => {
    try { const s = JSON.parse(fsapi.readText('data', e.rel)); if (s && s.map) return s.map; } catch (_) {}
    return e.name.replace(/\.scene\.json$/, '');
  });
}
function remove(mapId) { fsapi.remove('data', rel(mapId)); }

module.exports = { load, save, list, remove };
