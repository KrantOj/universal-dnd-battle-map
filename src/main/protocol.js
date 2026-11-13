'use strict';
const { protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const pu = require('./pathutil');

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
  protocol.handle('userfile', async (request) => {
    const full = resolveUserfile(request.url);
    if (!full) return new Response('Forbidden', { status: 403 });
    try {
      return await net.fetch(pathToFileURL(full).toString(), { headers: request.headers });
    } catch (_) {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { registerSchemes, registerHandlers, resolveAppPath, resolveUserfile };
