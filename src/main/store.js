'use strict';
// Small JSON file helpers: atomic write, tolerant read.
const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try {
    let t = fs.readFileSync(file, 'utf8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return JSON.parse(t);
  } catch (_) { return fallback; }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); } catch (e) {
    try { fs.copyFileSync(tmp, file); } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
  }
}

function writeJson(file, obj) { writeAtomic(file, JSON.stringify(obj, null, 2)); }

module.exports = { readJson, writeAtomic, writeJson };
