'use strict';
const fs = require('fs');
const path = require('path');
const pu = require('./pathutil');
const store = require('./store');

let _campaigns = null;
const campaigns = () => _campaigns || (_campaigns = require('./campaigns'));

/** Absolute base of a root for the current campaign; throws ROOT_NOT_SET:<root>. */
function baseOf(root) {
  const b = campaigns().rootPath(root);
  if (!b) throw new Error(`ROOT_NOT_SET:${root}`);
  return b;
}
function abs(root, rel) { return pu.resolveIn(baseOf(root), rel); }

function stripBom(buf) {
  return (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) ? buf.subarray(3) : buf;
}
function toBuf(d) {
  if (Buffer.isBuffer(d)) return d;
  if (d instanceof ArrayBuffer) return Buffer.from(d);
  return Buffer.from(d.buffer, d.byteOffset, d.byteLength);
}

function list(root, rel, opts) {
  const base = baseOf(root);
  const start = pu.resolveIn(base, rel || '');
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      let st; try { st = fs.statSync(full); } catch (_) { continue; }
      const isDir = st.isDirectory();
      out.push({ rel: pu.toRel(base, full), name: e.name, size: isDir ? 0 : st.size, mtime: st.mtimeMs, isDir });
      if (isDir && opts && opts.recursive) walk(full);
    }
  };
  walk(start);
  return out;
}
function exists(root, rel) { return fs.existsSync(abs(root, rel)); }
function readText(root, rel) { return stripBom(fs.readFileSync(abs(root, rel))).toString('utf8'); }
function readBinary(root, rel) { return fs.readFileSync(abs(root, rel)); }
function writeText(root, rel, text, opts) {
  const body = Buffer.from(String(text), 'utf8');
  store.writeAtomic(abs(root, rel), opts && opts.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body);
}
function writeBinary(root, rel, data) { store.writeAtomic(abs(root, rel), toBuf(data)); }
function remove(root, rel) {
  const full = abs(root, rel);
  if (path.resolve(full) === path.resolve(baseOf(root))) throw new Error('BAD_PATH');
  fs.rmSync(full, { recursive: true, force: true });
}
function importFiles(absPaths, root, relDir) {
  const srcs = (absPaths || []).map(String);
  for (const p of srcs) {
    let st = null; try { st = fs.statSync(p); } catch (_) {}
    if (!st || !st.isFile()) throw new Error(`SOURCE_NOT_FOUND:${p}`);
  }
  const dirAbs = abs(root, relDir || '');
  fs.mkdirSync(dirAbs, { recursive: true });
  const base = baseOf(root);
  const out = [];
  for (const p of srcs) {
    const dest = pu.resolveIn(dirAbs, path.basename(p));
    fs.copyFileSync(p, dest);
    out.push(pu.toRel(base, dest));
  }
  return out;
}

module.exports = Object.assign({ baseOf, abs, list, exists, readText, readBinary, writeText, writeBinary, remove, importFiles, stripBom }, pu);
