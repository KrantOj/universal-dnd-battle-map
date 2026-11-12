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

  // смена папки данных; если в старой есть данные приложения — предлагаем перенести (только их)
  async function changeData(p, row) {
    var from = camp.folders.data;
    if (from && p.toLowerCase() === from.toLowerCase()) return;
    var move = false;
    try {
      var info = from ? await window.host.campaigns.inspectDataDir(from) : null;
      if (info && info.owned > 0) move = await VTT.ui.confirm({ title: tr('settings.move.title'), text: tr('settings.move.text', { from: from, to: p, n: info.owned }), ok: tr('settings.move.ok'), cancel: tr('settings.move.no') });
      var c = await window.host.campaigns.relocateData(camp.id, p, { move: !!move });
      if (c) camp = c;
      msg(move ? tr('settings.move.done', { n: c && c._moved || 0 }) : tr('settings.saved'));
    } catch (e) {
      msg(tr('common.saveFailed', { msg: e && e.message || e }), true);
      if (row && row.set) row.set(from);
    }
  }

  function build() {
    var body = $('setBody');
    body.textContent = '';
    var cfg = C();

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
