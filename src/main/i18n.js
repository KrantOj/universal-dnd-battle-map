'use strict';
// Локализация главного процесса (меню, диалоги). Тот же словарь, что и у окон: src/renderer/locales/<lang>.json.
// Язык — settings.lang (по умолчанию ru); нет файла/ключа -> ru, иначе сам ключ. Формат значений — как в renderer/js/i18n.js.
const ru = require('../renderer/locales/ru.json');

const cache = { ru };
function dict(lang) {
  if (!cache[lang]) {
    try { cache[lang] = require(`../renderer/locales/${String(lang).replace(/[^a-z-]/gi, '')}.json`); } catch (_) { cache[lang] = ru; }
  }
  return cache[lang];
}
function lang() {
  try { return require('./settings').get().lang || 'ru'; } catch (_) { return 'ru'; }
}
function t(key, params) {
  let v = dict(lang())[key];
  if (v === undefined) v = ru[key];
  if (v === undefined) return key;
  return params ? v.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m)) : v;
}
module.exports = { t };
