'use strict';
// Чистые помощники для логов и отчёта (без Electron) — покрыты тестами.
const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_FILES = 3;   // main.log + main.1.log + main.2.log

/** main.log -> main.1.log -> main.2.log (старейший удаляется). */
function rotate(logPath, files = LOG_FILES) {
  const inf = path.parse(logPath);
  const nth = (n) => (n === 0 ? logPath : path.join(inf.dir, `${inf.name}.${n}${inf.ext}`));
  try { fs.unlinkSync(nth(files - 1)); } catch (_) {}
  for (let n = files - 2; n >= 0; n--) {
    try { fs.renameSync(nth(n), nth(n + 1)); } catch (_) {}
  }
}

/** Имена файлов логов в папке (для отчёта): main.log, main.1.log, ... */
function listLogFiles(dir) {
  try { return fs.readdirSync(dir).filter((n) => /^main(\.\d+)?\.log$/.test(n)).sort(); } catch (_) { return []; }
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Заменяет путь домашней папки пользователя на <HOME> (в разных написаниях: \, /, \\ в JSON, регистр). */
function scrubHome(text, homes) {
  let out = String(text);
  const list = (Array.isArray(homes) ? homes : [homes]).filter((h) => h && String(h).length > 3);
  for (const h of list) {
    const parts = String(h).split(/[\\/]+/).filter(Boolean);
    if (!parts.length) continue;
    const lead = /^[\\/]{2}/.test(h) ? '[\\\\/]{2}' : (/^[\\/]/.test(h) ? '[\\\\/]' : '');
    const sep = '(?:\\\\\\\\|\\\\|/)+';
    out = out.replace(new RegExp(lead + parts.map(reEsc).join(sep), 'gi'), '<HOME>');
  }
  return out;
}

module.exports = { MAX_LOG_BYTES, LOG_FILES, rotate, listLogFiles, scrubHome };
