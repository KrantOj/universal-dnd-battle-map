'use strict';
const fs = require('fs');
const os = require('os');
const util = require('util');
const path = require('path');
const { app, shell } = require('electron');
const log = require('electron-log/main');
const lu = require('./logutil');

let inited = false;
function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
function writeLine(msg) {
  try {
    const file = logPath();
    const text = util.format(...(msg.data || [])).replace(/\r?\n$/, '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > lu.MAX_LOG_BYTES) lu.rotate(file, lu.LOG_FILES); } catch (_) {}
    fs.appendFileSync(file, `[${stamp(msg.date || new Date())}] [${msg.level}] ${text}\n`);
  } catch (e) {
    try { process.stderr.write('log write failed: ' + (e && e.message) + '\n'); } catch (_) {}
  }
}
function logPath() { return path.join(app.getPath('userData'), 'logs', 'main.log'); }

/** Вызывать после app.setPath('userData') (smoke меняет его). */
function init() {
  if (inited) return log;
  inited = true;
  try { log.initialize(); } catch (_) {}
  // Свой файловый транспорт на синхронном appendFileSync: пишет сразу (ничего не теряется при app.exit()/падении) и не зависит от
  // внутренностей electron-log (initialize / resolvePathFn / потоки). Встроенный файловый транспорт отключаем.
  log.transports.file.level = false;
  const t = (msg) => writeLine(msg);
  t.level = 'info';
  log.transports.udbm = t;
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
