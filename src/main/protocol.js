'use strict';
const { protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');
const pu = require('./pathutil');
const rng = require('./range');

const ROOT = path.join(__dirname, '..', 'renderer');

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: 'userfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
  ]);
}

function resolveAppPath(urlStr) {
  const u = new URL(urlStr);
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '') rel = '/gm.html';
  const full = path.normalize(path.join(ROOT, rel));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

/** userfile://r/<root>/<rel> -> absolute path in the current campaign, or null (forbidden / unknown). */
function resolveUserfile(urlStr) {
  const p = pu.parseUserfileUrl(urlStr);
  if (!p) return null;
  try {
    const base = require('./campaigns').rootPath(p.root);
    if (!base) return null;
    return pu.resolveIn(base, p.rel);
  } catch (_) { return null; }
}

/** HTML отдаём с <html lang> по настройке языка — i18n.js в окне берёт язык оттуда синхронно. */
function htmlResponse(full) {
  try {
    const lang = require('./i18n').lang();
    const body = fs.readFileSync(full, 'utf8').replace(/<html lang="[a-z-]*"/i, `<html lang="${lang}"`);
    return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (_) { return new Response('Not found', { status: 404 }); }
}

function registerHandlers() {
  protocol.handle('app', (request) => {
    const full = resolveAppPath(request.url);
    if (!full) return new Response('Forbidden', { status: 403 });
    if (/\.html$/i.test(full)) return htmlResponse(full);
    return net.fetch(pathToFileURL(full).toString()).catch(() => new Response('Not found', { status: 404 }));
  });
  protocol.handle('userfile', (request) => {
    const full = resolveUserfile(request.url);
    if (!full) return new Response('Forbidden', { status: 403 });
    return serveFile(full, request.headers.get('range'));
  });
}

/** Файл с поддержкой Range (206): без этого <audio>/<video> не могут перематывать. Отдаём поток-срез, а не весь файл в память. */
function serveFile(full, rangeHeader) {
  let st;
  try { st = fs.statSync(full); } catch (_) { return new Response('Not found', { status: 404 }); }
  if (!st.isFile()) return new Response('Not found', { status: 404 });
  const size = st.size;
  const headers = { 'content-type': rng.mimeOf(full), 'accept-ranges': 'bytes' };
  const r = rng.parseRange(rangeHeader, size);
  if (r === 'invalid') return new Response(null, { status: 416, headers: Object.assign(headers, { 'content-range': `bytes */${size}` }) });
  const body = (opts) => {
    const s = fs.createReadStream(full, opts);
    s.on('error', () => {});
    return Readable.toWeb(s);
  };
  if (!r) {
    headers['content-length'] = String(size);
    return new Response(size ? body({}) : null, { status: 200, headers });
  }
  headers['content-length'] = String(r.end - r.start + 1);
  headers['content-range'] = `bytes ${r.start}-${r.end}/${size}`;
  return new Response(body({ start: r.start, end: r.end }), { status: 206, headers });
}

module.exports = { registerSchemes, registerHandlers, resolveAppPath, resolveUserfile };
