'use strict';
// Pure path helpers (no Electron) — unit-testable.
const path = require('path');

const CI = process.platform === 'win32';
const norm = (p) => (CI ? p.toLowerCase() : p);

/** Is `full` equal to or inside `base`? */
function isInside(base, full) {
  const b = norm(path.resolve(base));
  const f = norm(path.resolve(full));
  if (f === b) return true;
  const prefix = b.endsWith(path.sep) ? b : b + path.sep;
  return f.startsWith(prefix);
}

/** Validate a root-relative path ('/' separators). Throws BAD_PATH on traversal. Returns clean segments. */
function cleanRel(rel) {
  if (rel === undefined || rel === null || rel === '') return [];
  if (typeof rel !== 'string') throw new Error('BAD_PATH');
  if (rel.indexOf('\0') !== -1) throw new Error('BAD_PATH');
  const s = rel.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) throw new Error('BAD_PATH');
  const segs = s.split('/').filter((x) => x !== '' && x !== '.');
  for (const seg of segs) {
    if (seg === '..') throw new Error('BAD_PATH');
    if (CI && /[<>:"|?*]/.test(seg)) throw new Error('BAD_PATH');
  }
  return segs;
}

/** Resolve `rel` inside `base`; throws Error('BAD_PATH') if it escapes. */
function resolveIn(base, rel) {
  if (!base || typeof base !== 'string') throw new Error('BAD_ROOT');
  const b = path.resolve(base);
  const full = path.resolve(b, ...cleanRel(rel));
  if (!isInside(b, full)) throw new Error('BAD_PATH');
  return full;
}

/** Absolute child path -> '/' relative path. */
function toRel(base, full) {
  return path.relative(path.resolve(base), full).split(path.sep).join('/');
}

/** Filesystem-safe name. */
function safeName(s, fallback) {
  const r = String(s == null ? '' : s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  return r || fallback || 'item';
}

/** Parse userfile://r/<root>/<rel...> -> {root, rel} or null. */
function parseUserfileUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch (_) { return null; }
  if (u.protocol !== 'userfile:') return null;
  const parts = u.pathname.split('/').slice(1);
  if (!parts.length || !parts[0]) return null;
  try {
    const root = decodeURIComponent(parts[0]);
    const rel = parts.slice(1).map(decodeURIComponent).join('/');
    return { root, rel };
  } catch (_) { return null; }
}

module.exports = { isInside, cleanRel, resolveIn, toRel, safeName, parseUserfileUrl };
