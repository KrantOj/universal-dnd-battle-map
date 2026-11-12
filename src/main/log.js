'use strict';
const os = require('os');
const path = require('path');
const { app, shell } = require('electron');
const log = require('electron-log/main');
const lu = require('./logutil');

let inited = false;
function logPath() { return path.join(app.getPath('userData'), 'logs', 'main.log'); }

/** Вызывать после app.setPath('userData') (smoke меняет его). */
function init() {
  if (inited) return log;
  inited = true;
  try { log.initialize(); } catch (_) {}
  const f = log.transports.file;
  f.level = 'info';
  f.maxSize = lu.MAX_LOG_BYTES;
  f.resolvePathFn = logPath;
  f.archiveLogFn = (file) => lu.rotate(file.toString(), lu.LOG_FILES);
  log.transports.console.level = 'info';
  process.on('uncaughtException', (e) => { try { log.error('uncaughtException', e); } catch (_) {} });
  process.on('unhandledRejection', (e) => { try { log.error('unhandledRejection', e); } catch (_) {} });
  header();
  return log;
}

function header() {
  const v = process.versions;
  log.info(`==== Universal DnD Battle map ${app.getVersion()} | Electron ${v.electron} | Chrome ${v.chrome} | Node ${v.node} | ` +
    `Windows/OS ${os.type()} ${os.release()} (${process.getSystemVersion ? process.getSystemVersion() : ''}) ${process.arch} | locale ${app.getLocale()} ====`);
}

function attachWebContents(wc, label) {
  // ошибки страницы (window.onerror, unhandledrejection, console.error) приходят из renderer через log:report (errlog.js)
  wc.on('render-process-gone', (_e, det) => log.error(`[${label}] render-process-gone`, det));
  wc.on('did-fail-load', (_e, code, desc, url) => log.error(`[${label}] did-fail-load ${code} ${desc} ${url}`));
}

/** Запись от renderer: {level:'error'|'warn', message, source}. */
function fromRenderer(label, rec) {
  const r = rec || {};
  const lvl = r.level === 'warn' ? 'warn' : 'error';
  log[lvl](`[${label}] ${String(r.message || '').slice(0, 4000)}${r.source ? ` (${String(r.source).slice(0, 300)})` : ''}`);
}

function logDir() { return path.dirname(logPath()); }
async function openFolder() { await shell.openPath(logDir()); }

module.exports = { init, log, attachWebContents, fromRenderer, openFolder, logDir, logPath };
