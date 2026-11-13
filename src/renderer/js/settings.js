/* VTT.settings — окно «Настройки» кампании; изменения применяются сразу (host.campaigns.update) */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;
  var C = function () { return VTT.cfg; };
  var camp = null, built = false, saveSeq = 0;

  function $(id) { return document.getElementById(id); }

  function msg(text, isErr) {
    var m = $('setMsg');
    m.textContent = text || '';
    m.classList.toggle('err', !!isErr);
  }

  function update(patch) {
    if (!camp) return Promise.resolve();
    var my = ++saveSeq;
    return window.host.campaigns.update(camp.id, patch).then(function (c) {
      if (c) camp = c;
      if (my === saveSeq) msg(tr('settings.saved'));
      return c;
    }).catch(function (e) { msg(tr('common.saveFailed', { msg: e && e.message || e }), true); });
  }

  // смена папки данных. Если в старой есть данные приложения — спрашиваем: перенести / сменить без переноса / отмена.
  // Пока человек не подтвердил, ничего не меняется и в новую папку ничего не пишется.
  async function changeData(p, row) {
    var from = camp.folders.data;
    if (from && p.toLowerCase() === from.toLowerCase()) return;
    var H = window.host, opts = { move: false };
    try {
      var info = from ? await H.campaigns.inspectDataDir(from) : null;
      if (info && info.owned > 0) {
        var r = await C().choose3(tr('settings.move.title'), tr('settings.move.text', { from: from, to: p, n: info.owned }),
          { sub: tr('settings.move.ok'), asis: tr('settings.move.no'), other: tr('common.cancel') });
        if (r === 'other') { if (row && row.set) row.set(from); return; }
        opts.move = r === 'sub';
        if (opts.move) {
          var dst = await H.campaigns.inspectDataDir(p);
          if (dst && dst.owned > 0) {
            var cf = await C().choose3(tr('settings.conflict.title'), tr('settings.conflict.text', { dir: p, n: dst.owned }),
              { sub: tr('settings.conflict.overwrite'), asis: tr('settings.conflict.merge'), other: tr('common.cancel') });
            if (cf === 'other') { if (row && row.set) row.set(from); return; }
            opts.conflict = cf === 'sub' ? 'overwrite' : 'merge';
          }
        }
      }
      if (VTT.gm && VTT.gm.flush) await VTT.gm.flush();     // дописать в старую папку всё, что ещё в памяти
      var c = await H.campaigns.relocateData(camp.id, p, opts);
      if (c) camp = c;
      msg(opts.move ? tr('settings.move.done', { n: c && c._moved || 0 }) : (info && info.owned > 0 ? tr('settings.move.left', { from: from }) : tr('settings.saved')));
    } catch (e) {
      msg(tr('common.saveFailed', { msg: e && e.message || e }), true);
      if (row && row.set) row.set(from);
    }
  }

  // горячие клавиши музыки: нажать на поле -> нажать сочетание (Esc — отмена, Backspace — снять)
  function buildKeys(body) {
    var L = VTT.musicLogic, M = VTT.music, cfg = C(), caps = {};
    function paint() {
      var keys = M.getKeys();
      L.KEY_ACTIONS.forEach(function (a) {
        var b = caps[a]; b.classList.remove('rec');
        b.textContent = keys[a] ? L.labelOfSpec(keys[a]) : tr('music.key.none');
      });
    }
    function capture(a) {
      var b = caps[a];
      b.classList.add('rec'); b.textContent = tr('music.key.press');
      function done() { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onAway, true); paint(); }
      function onAway(ev) { if (ev.target !== b) done(); }
      function onKey(e) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { done(); return; }
        var spec = '';
        if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) spec = '';
        else { spec = L.specFromEvent(e); if (!spec) return; }
        done();
        M.setKey(a, spec).then(function (r) {
          paint();
          if (!r.ok) msg(r.reason === 'invalid' ? tr('music.key.invalid') : tr('common.saveFailed', { msg: r.reason }), true);
          else msg(r.cleared ? tr('music.key.moved', { name: tr('music.key.' + r.cleared) }) : tr('settings.saved'));
        });
      }
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('pointerdown', onAway, true);
    }
    L.KEY_ACTIONS.forEach(function (a) {
      var row = cfg.el('div', 'cfg-key');
      row.appendChild(cfg.el('div', 'cfg-lbl', tr('music.key.' + a)));
      var b = cfg.el('button', 'cap'); b.type = 'button'; b.onclick = function () { capture(a); };
      caps[a] = b; row.appendChild(b);
      body.appendChild(row);
    });
    var reset = cfg.el('button', null, tr('music.key.reset')); reset.type = 'button';
    reset.onclick = function () { M.resetKeys().then(function () { paint(); msg(tr('settings.saved')); }); };
    var rr = cfg.el('div', 'cfg-row'); rr.appendChild(reset); body.appendChild(rr);
    paint();
  }

  function build() {
    var body = $('setBody');
    body.textContent = '';
    var cfg = C();

    // язык интерфейса (глобальная настройка приложения, не кампании)
    var langRow = cfg.el('div', 'cfg-row');
    langRow.appendChild(cfg.el('div', 'cfg-lbl', tr('settings.language')));
    var langSel = cfg.el('select');
    cfg.LANGS.forEach(function (l) { var o = cfg.el('option', null, l.name); o.value = l.code; langSel.appendChild(o); });
    langSel.value = VTT.i18n.lang;
    langSel.onchange = function () { cfg.setLanguage(langSel.value); };
    langRow.appendChild(langSel);
    body.appendChild(langRow);
    body.appendChild(cfg.el('div', 'cfg-note', tr('settings.language.note')));

    // проверка обновлений (глобальная настройка приложения)
    var upd = cfg.checkRow(tr('settings.updates'), true, function (v) { window.host.settings.set({ checkUpdates: v }).catch(function () { /* ignore */ }); });
    body.appendChild(upd.el);
    window.host.settings.get().then(function (s) { upd.input.checked = s.checkUpdates !== false; }).catch(function () { /* ignore */ });
    body.appendChild(cfg.el('div', 'cfg-note', tr('settings.updates.note')));

    // название
    var nameRow = cfg.el('div', 'cfg-row');
    nameRow.appendChild(cfg.el('div', 'cfg-lbl', tr('settings.campName')));
    var name = cfg.el('input'); name.type = 'text'; name.maxLength = 60; name.value = camp.name || '';
    name.onchange = function () { var v = name.value.trim(); if (v) update({ name: v }); else name.value = camp.name; };
    nameRow.appendChild(name);
    body.appendChild(nameRow);

    // папки
    body.appendChild(cfg.el('h3', null, tr('settings.folders')));
    var data = cfg.folderRow({ label: tr('settings.dataFolder'), value: camp.folders.data, pickTitle: tr('folder.data.pickTitle'), guardData: true, onChange: function (p) { if (p) changeData(p, data); } });
    body.appendChild(data.el);
    body.appendChild(cfg.el('div', 'cfg-note', tr('settings.dataNote')));
    body.appendChild(cfg.folderRow({ label: tr('settings.mapsFolder'), value: camp.folders.maps, empty: tr('common.notPicked'), pickTitle: tr('folder.maps.pickTitle'), clearable: true,
      onChange: function (p) { update({ folders: { maps: p } }); } }).el);

    // показ
    body.appendChild(cfg.el('h3', null, tr('show.categories.title')));
    var ed = cfg.mediaEditor(camp.media || [], function () { update({ media: ed.get() }); });
    body.appendChild(ed.el);

    // музыка
    body.appendChild(cfg.el('h3', null, tr('music.section')));
    body.appendChild(cfg.folderRow({ label: tr('music.folderLabel'), value: camp.folders.music, empty: tr('common.notPicked'), pickTitle: tr('music.pickTitle'), clearable: true,
      onChange: function (p) { update({ folders: { music: p } }); } }).el);
    body.appendChild(cfg.el('div', 'cfg-note', tr('music.keys.note')));
    buildKeys(body);

    // журнал боя
    body.appendChild(cfg.el('h3', null, tr('blog.section')));
    var logOn = cfg.checkRow(tr('settings.logEnable'), !(camp.battlelog && camp.battlelog.enabled === false), function (v) {
      update({ battlelog: { enabled: v } });
      logFolder.el.hidden = !v;
    });
    body.appendChild(logOn.el);
    var logFolder = cfg.folderRow({ label: tr('settings.logFolder'), value: camp.folders.battlelog, empty: tr('settings.logFolderEmpty'), pickTitle: tr('blog.folder.pickTitle'), clearable: true,
      onChange: function (p) { update({ folders: { battlelog: p } }); } });
    logFolder.el.hidden = !logOn.input.checked;
    body.appendChild(logFolder.el);

    // окно игроков
    body.appendChild(cfg.el('h3', null, tr('settings.playerWindow')));
    var pw = camp.playerWindow || {};
    body.appendChild(cfg.checkRow(tr('settings.playerAuto'), pw.auto !== false, function (v) { update({ playerWindow: { auto: v } }); }).el);
    body.appendChild(cfg.checkRow(tr('settings.playerFullscreen'), pw.fullscreen !== false, function (v) { update({ playerWindow: { fullscreen: v } }); }).el);
  }

  var api = {
    open: async function () {
      try { camp = await window.host.campaigns.current(); } catch (e) { camp = null; }
      if (!camp) return;
      msg('');
      build();
      $('settingsDlg').hidden = false;
    },
    close: function () { $('settingsDlg').hidden = true; },
    init: function () {
      if (built) return;
      built = true;
      $('btnSettingsClose').onclick = api.close;
      $('btnWizardAgain').onclick = function () { window.host.app.showWizard(); };
    }
  };
  VTT.settings = api;
})();
