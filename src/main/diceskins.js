'use strict';
// Пользовательские скины 3D-кубиков: <userData>/dice-skins/<папка>/skin.json (+ PNG/JPG/WebP).
// Скин — только данные. Всё читаем с проверками: размер, расширения, путь строго внутри папки скина.
// Функции принимают базовую папку параметром (dir), чтобы тестироваться без Electron.
const fs = require('fs');
const path = require('path');
const pu = require('./pathutil');

const MAX_JSON = 64 * 1024;
const MAX_IMG = 6 * 1024 * 1024;
const MAX_SKINS = 200;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const ID_PREFIX = 'user:';

function ensureDir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ } }

function readSkinJson(folder) {
  const f = path.join(folder, 'skin.json');
  const st = fs.statSync(f);
  if (!st.isFile() || st.size > MAX_JSON) throw new Error('BAD_SKIN_JSON');
  const raw = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('BAD_SKIN_JSON');
  return raw;
}
function displayName(raw, fallback, lang) {
  const n = raw && raw.name;
  if (typeof n === 'string' && n.trim()) return n.trim().slice(0, 40);
  if (n && typeof n === 'object') {
    const v = n[lang] || n.ru || n.en;
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
  }
  return fallback;
}

/** [{ id: 'user:<папка>', name }] — только папки, где есть читаемый skin.json. */
function list(dir, lang) {
  ensureDir(dir);
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return []; }
  const out = [];
  for (const nm of names.sort((a, b) => a.localeCompare(b)).slice(0, MAX_SKINS)) {
    try { out.push({ id: ID_PREFIX + nm, name: displayName(readSkinJson(path.join(dir, nm)), nm, lang) }); } catch (_) { /* папка без нормального skin.json пропускается */ }
  }
  return out;
}

/** { skin: сырой JSON, files: { 'имя.png': 'data:image/png;base64,…' } } для id вида 'user:<папка>'. Бросает ошибку при любой странности. */
function get(dir, id) {
  if (typeof id !== 'string' || !id.startsWith(ID_PREFIX)) throw new Error('BAD_SKIN_ID');
  const name = id.slice(ID_PREFIX.length);
  if (!name || name !== path.basename(name) || name === '.' || name === '..') throw new Error('BAD_SKIN_ID');
  const folder = pu.resolveIn(dir, name);
  const skin = readSkinJson(folder);
  const files = {};
  const body = skin.body && typeof skin.body === 'object' ? skin.body : {};
  for (const key of ['map', 'normalMap', 'roughnessMap']) {
    const rel = body[key];
    if (typeof rel !== 'string' || !rel) continue;
    const ext = path.extname(rel).toLowerCase();
    if (!MIME[ext]) continue;
    const full = pu.resolveIn(folder, rel);
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > MAX_IMG) throw new Error('BAD_SKIN_IMAGE');
    files[rel] = 'data:' + MIME[ext] + ';base64,' + fs.readFileSync(full).toString('base64');
  }
  return { skin, files };
}

module.exports = { list, get, ensureDir, ID_PREFIX, MAX_JSON, MAX_IMG };
