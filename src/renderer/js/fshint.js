/* Подсказка при входе в полный экран («Esc — выйти…»): окна мастера и игроков. Событие приходит из главного процесса (BrowserWindow.setFullScreen). */
(function () {
  'use strict';
  var timer = null, box = null;
  function show() {
    if (!box) { box = document.createElement('div'); box.id = 'fsHint'; document.body.appendChild(box); }
    box.textContent = window.VTT.i18n.t('fullscreen.hint');
    box.classList.add('on');
    clearTimeout(timer);
    timer = setTimeout(function () { box.classList.remove('on'); }, 3500);
  }
  function hide() { clearTimeout(timer); if (box) box.classList.remove('on'); }
  window.addEventListener('DOMContentLoaded', function () {
    try {
      window.host.windows.onFullscreen(function (on) { if (on) show(); else hide(); });
    } catch (e) { /* ignore */ }
  });
})();
