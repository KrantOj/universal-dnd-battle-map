'use strict';
const path = require('path');
const { app } = require('electron');
const store = require('./store');

const LANGS = ['ru', 'en'];
const file = () => path.join(app.getPath('userData'), 'settings.json');

/** Язык по умолчанию для свежей установки: русский, если язык интерфейса Windows русский, иначе английский. */
function defaultLang() {
  try { return String(app.getLocale() || '').toLowerCase().startsWith('ru') ? 'ru' : 'en'; } catch (_) { return 'en'; }
}

function get() {
  const s = Object.assign({ currentCampaign: null, checkUpdates: true }, store.readJson(file(), {}));
  if (!LANGS.includes(s.lang)) s.lang = defaultLang();
  return s;
}
function set(patch) {
  const p = patch && typeof patch === 'object' ? Object.assign({}, patch) : {};
  if ('lang' in p && !LANGS.includes(p.lang)) delete p.lang;
  if ('checkUpdates' in p) p.checkUpdates = !!p.checkUpdates;
  const s = Object.assign(get(), p);
  store.writeJson(file(), s);
  return s;
}

module.exports = { get, set, LANGS, defaultLang };
