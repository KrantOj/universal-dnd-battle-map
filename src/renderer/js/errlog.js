/* Пересылка ошибок страницы в лог главного процесса (userData/logs/main.log): window.onerror, unhandledrejection, console.error.
   Подключать первым после i18n.js. Работает через host.log.report (preload). */
(function () {
  'use strict';
  function rep(msg, src) {
    try { if (window.host && window.host.log && window.host.log.report) window.host.log.report({ level: 'error', message: String(msg), source: src || '' }); } catch (e) { /* ignore */ }
  }
  function fmt(v) {
    if (v && v.stack) return String(v.stack);
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  window.addEventListener('error', function (e) {
    if (!e || (!e.message && !e.error)) return;      // ошибки загрузки ресурсов (img/script) сюда не относятся
    rep('window.onerror: ' + (e.error && e.error.stack || e.message), (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) { rep('unhandledrejection: ' + fmt(e && e.reason)); });
  var orig = console.error;
  console.error = function () {
    rep('console.error: ' + Array.prototype.map.call(arguments, fmt).join(' '));
    return orig.apply(console, arguments);
  };
})();
