'use strict';
// Внешние ссылки: открываем в браузере только страницы репозитория приложения на GitHub.
const { REPO_URL } = require('./update-logic');

function isAllowedExternal(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port) return false;
    const base = new URL(REPO_URL).pathname;
    return u.pathname === base || u.pathname.startsWith(base + '/');
  } catch (_) { return false; }
}

module.exports = { isAllowedExternal };
