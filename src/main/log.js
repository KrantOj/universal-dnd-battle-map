'use strict';
const path = require('path');
const { shell } = require('electron');
const log = require('electron-log/main');

let inited = false;
function init() {
  if (inited) return log;
  inited = true;
  try { log.initialize(); } catch (_) {}
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
  process.on('uncaughtException', (e) => { try { log.error('uncaughtException', e); } catch (_) {} });
  process.on('unhandledRejection', (e) => { try { log.error('unhandledRejection', e); } catch (_) {} });
  return log;
}

function attachWebContents(wc, label) {
  wc.on('console-message', (...args) => {
    const [e, levelArg, messageArg, lineArg, sourceArg] = args;
    // New Electron: single details object on the event; old: positional args.
    const d = (e && typeof e === 'object' && 'level' in e) ? e
      : { level: levelArg, message: messageArg, lineNumber: lineArg, sourceId: sourceArg };
    if (d.level === 'error' || d.level === 3) log.error(`[${label}] ${d.message} (${d.sourceId}:${d.lineNumber})`);
  });
  wc.on('render-process-gone', (_e, det) => log.error(`[${label}] render-process-gone`, det));
  wc.on('did-fail-load', (_e, code, desc, url) => log.error(`[${label}] did-fail-load ${code} ${desc} ${url}`));
}

function logDir() {
  try { return path.dirname(log.transports.file.getFile().path); } catch (_) { return null; }
}
async function openFolder() {
  const d = logDir();
  if (d) await shell.openPath(d);
}

module.exports = { init, log, attachWebContents, openFolder, logDir };
