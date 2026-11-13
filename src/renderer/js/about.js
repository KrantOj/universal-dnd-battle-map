/* Окно «О программе»: версии, лицензия, ссылка на GitHub (только через host.app.openExternal), проверка обновлений. */
(function () {
  'use strict';
  var VTT = window.VTT, tr = VTT.i18n.t, H = window.host;
  var REPO = 'https://github.com/KrantOj/universal-dnd-battle-map';
  function $(id) { return document.getElementById(id); }
  function msg(t) { $('abMsg').textContent = t || ''; }

  function paint(s) {
    if (!s) return;
    var st = s.status;
    $('abInstall').hidden = !(s.mode === 'nsis' && st === 'downloaded');
    $('abRelease').hidden = !(s.mode === 'portable' && st === 'available');
    $('abCheck').disabled = st === 'checking' || st === 'downloading';
    if (st === 'checking') msg(tr('about.check.running'));
    else if (st === 'downloading') msg(tr('about.check.downloading', { version: s.version, n: s.progress || 0 }));
    else if (st === 'downloaded') msg(tr('about.check.ready', { version: s.version }));
    else if (st === 'available') msg(tr('about.check.available', { version: s.version }));
    else if (st === 'error') msg(tr('about.check.error'));
  }

  function init() {
    VTT.i18n.apply();
    H.app.platformInfo().then(function (i) {
      $('abVer').textContent = tr('about.version', { version: i.version });
      $('abEng').textContent = tr('about.electron', { v: i.electron }) + ' · ' + tr('about.chrome', { v: i.chrome });
    });
    H.app.license().then(function (t) { $('abLic').textContent = t || 'MIT License'; });
    $('abRepo').onclick = function (e) { e.preventDefault(); H.app.openExternal(REPO).catch(function () { /* ignore */ }); };
    $('abClose').onclick = function () { window.close(); };
    $('abInstall').onclick = function () { H.update.install(); };
    $('abRelease').onclick = function () { H.update.openRelease().catch(function () { /* ignore */ }); };
    $('abCheck').onclick = function () {
      msg(tr('about.check.running'));
      H.update.check().then(function (r) {
        if (r === 'off') msg(tr('about.check.off'));
        else if (r === 'uptodate') msg(tr('about.check.uptodate'));
        else if (r === 'error') msg(tr('about.check.error'));
        else H.update.state().then(paint);
      }).catch(function () { msg(tr('about.check.error')); });
    };
    H.update.onState(paint);
    H.update.state().then(function (s) { if (s.status === 'available' || s.status === 'downloading' || s.status === 'downloaded') paint(s); });
  }
  init();
})();
