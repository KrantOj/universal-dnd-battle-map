'use strict';
// Отчёт о проблеме: zip (логи + описание + версии), без сцен и картинок; путь пользователя -> <HOME>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { zipSync, strToU8 } = require('fflate');
const lu = require('./logutil');

const ISSUES_URL = 'https://github.com/KrantOj/universal-dnd-battle-map/issues';

function homes() {
  const h = [os.homedir(), process.env.USERPROFILE, process.env.HOME].filter(Boolean);
  return [...new Set(h)];
}

/** -> Uint8Array zip. info = {app, electron, chrome, node, os, locale}. */
function build({ logDir, description, info, homeDirs }) {
  const hs = homeDirs || homes();
  const files = {};
  for (const n of lu.listLogFiles(logDir)) {
    let t = ''; try { t = fs.readFileSync(path.join(logDir, n), 'utf8'); } catch (_) {}
    files['logs/' + n] = strToU8(lu.scrubHome(t, hs));
  }
  files['description.txt'] = strToU8(lu.scrubHome(String(description || ''), hs));
  files['versions.json'] = strToU8(lu.scrubHome(JSON.stringify(info || {}, null, 2), hs));
  return zipSync(files, { level: 6 });
}

module.exports = { build, homes, ISSUES_URL };
