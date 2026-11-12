/* VTT.settings — окно «Настройки» кампании; изменения применяются сразу (host.campaigns.update) */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
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
      if (my === saveSeq) msg('Сохранено');
      return c;
    }).catch(function (e) { msg('Не удалось сохранить: ' + (e && e.message || e), true); });
  }

  function build() {
    var body = $('setBody');
    body.textContent = '';
    var cfg = C();

    // название
    var nameRow = cfg.el('div', 'cfg-row');
    nameRow.appendChild(cfg.el('div', 'cfg-lbl', 'Название кампании'));
    var name = cfg.el('input'); name.type = 'text'; name.maxLength = 60; name.value = camp.name || '';
    name.onchange = function () { var v = name.value.trim(); if (v) update({ name: v }); else name.value = camp.name; };
    nameRow.appendChild(name);
    body.appendChild(nameRow);

    // папки
    body.appendChild(cfg.el('h3', null, 'Папки'));
    var data = cfg.folderRow({ label: 'Данные (сцены, библиотека, кэш)', value: camp.folders.data, pickTitle: 'Папка данных', onChange: function (p) { if (p) update({ folders: { data: p } }); } });
    body.appendChild(data.el);
    body.appendChild(cfg.el('div', 'cfg-note', 'Смена папки данных не переносит старые файлы.'));
    body.appendChild(cfg.folderRow({ label: 'Карты боя (*.map.json + картинки)', value: camp.folders.maps, empty: 'не выбрана', pickTitle: 'Папка с картами боя', clearable: true,
      onChange: function (p) { update({ folders: { maps: p } }); } }).el);

    // показ
    body.appendChild(cfg.el('h3', null, 'Категории «Показа»'));
    var ed = cfg.mediaEditor(camp.media || [], function () { update({ media: ed.get() }); });
    body.appendChild(ed.el);

    // журнал боя
    body.appendChild(cfg.el('h3', null, 'Журнал боя'));
    var logOn = cfg.checkRow('Вести журнал боя и сохранять заметки', !(camp.battlelog && camp.battlelog.enabled === false), function (v) {
      update({ battlelog: { enabled: v } });
      logFolder.el.hidden = !v;
    });
    body.appendChild(logOn.el);
    var logFolder = cfg.folderRow({ label: 'Папка для заметок боёв', value: camp.folders.battlelog, empty: 'не задана — при сохранении спросим', pickTitle: 'Папка журнала боя', clearable: true,
      onChange: function (p) { update({ folders: { battlelog: p } }); } });
    logFolder.el.hidden = !logOn.input.checked;
    body.appendChild(logFolder.el);

    // окно игроков
    body.appendChild(cfg.el('h3', null, 'Окно игроков'));
    var pw = camp.playerWindow || {};
    body.appendChild(cfg.checkRow('Открывать автоматически при запуске (если есть второй монитор)', pw.auto !== false, function (v) { update({ playerWindow: { auto: v } }); }).el);
    body.appendChild(cfg.checkRow('Полный экран на втором мониторе', pw.fullscreen !== false, function (v) { update({ playerWindow: { fullscreen: v } }); }).el);
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
