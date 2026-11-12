'use strict';
const { protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', 'renderer');

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
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

function registerHandlers() {
  protocol.handle('app', (request) => {
    const full = resolveAppPath(request.url);
    if (!full) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
}

module.exports = { registerSchemes, registerHandlers, resolveAppPath };
