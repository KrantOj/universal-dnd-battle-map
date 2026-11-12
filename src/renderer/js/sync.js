/* VTT.sync — канал мастер <-> окно игроков поверх host.sync / host.windows */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var open = false;
  var helloCbs = [], stateCbs = [];
  var stateTimer = null;
  var lastRuler = 0, rulerTimer = null, pendingRuler = null;
  var isPlayer = !!(document.body && document.body.classList.contains('player'));

  function setOpen(v) {
    v = !!v;
    if (v === open) return;
    open = v;
    stateCbs.forEach(function (cb) { try { cb(open); } catch (e) { /* ignore */ } });
  }

  var sync = {
    isOpen: function () { return open; },

    openPlayerWindow: function () { return window.host.windows.openPlayer(); },
    closePlayerWindow: function () { return window.host.windows.closePlayer(); },
    onState: function (cb) { stateCbs.push(cb); },

    send: function (msg) {
      if (!isPlayer && !open) return false;
      try { window.host.sync.send(msg); return true; } catch (e) { return false; }
    },

    onHello: function (cb) { helloCbs.push(cb); },

    // состояние: debounce 50 мс; getter вызывается в момент отправки
    queueState: function (getter) {
      if (stateTimer) return;
      stateTimer = setTimeout(function () {
        stateTimer = null;
        if (open) getter();
      }, 50);
    },

    // линейка: троттлинг 30 Гц, всегда досылается последнее значение
    sendRuler: function (ruler) {
      var msg = { t: 'ruler', ruler: ruler };
      var now = performance.now();
      if (ruler === null) {
        clearTimeout(rulerTimer); rulerTimer = null; pendingRuler = null;
        sync.send(msg); lastRuler = now; return;
      }
      if (now - lastRuler >= 33) { lastRuler = now; sync.send(msg); return; }
      pendingRuler = msg;
      if (!rulerTimer) {
        rulerTimer = setTimeout(function () {
          rulerTimer = null;
          if (pendingRuler) { lastRuler = performance.now(); sync.send(pendingRuler); pendingRuler = null; }
        }, 34);
      }
    },

    // сторона игрока
    listen: function (cb) {
      window.host.sync.onMessage(function (msg) {
        if (!msg || typeof msg !== 'object' || !msg.t) return;
        cb(msg);
      });
    },
    hello: function () {
      try { window.host.sync.send({ t: 'hello' }); } catch (e) { /* окно мастера ещё не готово */ }
    },

    // сторона мастера: вызывается из gm.init
    initGm: function () {
      window.host.windows.onPlayerState(function (v) { setOpen(v); });
      window.host.windows.isPlayerOpen().then(setOpen).catch(function () {});
      window.host.sync.onMessage(function (msg) {
        if (!msg || msg.t !== 'hello') return;
        setOpen(true);
        helloCbs.forEach(function (cb) { cb(); });
      });
    }
  };

  VTT.sync = sync;
})();
