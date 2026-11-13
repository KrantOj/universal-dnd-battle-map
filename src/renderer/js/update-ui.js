/* Плашка «Доступна версия X» в окне мастера. Состояние ведёт главный процесс (main/updater.js): здесь только показ и кнопка. */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;
  var dismissed = false;
  function $(id) { return document.getElementById(id); }

  function paint(s) {
    var bar = $('updBar');
    if (!bar || !s) return;
    var st = s.status, go = $('updGo');
    var show = !dismissed && (st === 'available' || st === 'downloading' || st === 'downloaded');
    bar.hidden = !show;
    if (!show) return;
    go.hidden = true;
    if (st === 'available') {
      $('updTxt').textContent = tr('update.bar.available', { version: s.version });
      go.textContent = tr('update.bar.release'); go.hidden = false;
      go.onclick = function () { window.host.update.openRelease().catch(function () { /* ignore */ }); };
    } else if (st === 'downloading') {
      $('updTxt').textContent = tr('update.bar.downloading', { version: s.version, n: s.progress || 0 });
    } else {
      $('updTxt').textContent = tr('update.bar.ready', { version: s.version });
      go.textContent = tr('update.bar.install'); go.hidden = false;
      go.onclick = async function () {
        go.disabled = true;
        try { if (VTT.gm && VTT.gm.flush) await VTT.gm.flush(); } catch (e) { console.warn('flush', e); }   // сцена на диск до выхода
        window.host.update.install().catch(function () { go.disabled = false; });
      };
    }
  }

  function init() {
    $('updX').onclick = function () { dismissed = true; $('updBar').hidden = true; };
    window.host.update.onState(paint);
    window.host.update.state().then(paint).catch(function () { /* ignore */ });
  }
  VTT.updateUi = { init: init };
})();
