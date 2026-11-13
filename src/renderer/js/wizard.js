/* Мастер первого запуска: название, папки, категории «Показа», журнал боя, окно игроков -> host.campaigns.create */
(function () {
  'use strict';
  var VTT = window.VTT;
  var tr = VTT.i18n.t;
  var cfg = VTT.cfg, el = cfg.el;
  function $(id) { return document.getElementById(id); }

  var D = {
    name: '', dataDir: null, mapsDir: null, musicDir: null, media: [],
    logEnabled: true, logDir: null, playerAuto: true
  };
  var hasCampaign = false;
  var step = 0, busy = false;
  var editor = null;      // редактор категорий (шаг «Показ»)

  var STEPS = [
    {
      title: tr('wizard.step.lang.title'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.lang.lead')));
        var sel = el('select');
        cfg.LANGS.forEach(function (l) { var o = el('option', null, l.name); o.value = l.code; sel.appendChild(o); });
        sel.value = VTT.i18n.lang;
        sel.onchange = function () { cfg.setLanguage(sel.value); };   // страница перезагрузится уже на новом языке
        b.appendChild(sel);
      },
      skippable: false
    },
    {
      title: tr('wizard.step.name.title'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.name.lead')));
        var inp = el('input'); inp.type = 'text'; inp.maxLength = 60; inp.value = D.name; inp.placeholder = tr('wizard.defaultName');
        inp.oninput = function () { D.name = inp.value; };
        b.appendChild(inp);
        setTimeout(function () { inp.focus(); }, 0);
      },
      skippable: false
    },
    {
      title: tr('wizard.step.data.title'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.data.lead')));
        var note = el('div', 'cfg-note', tr('wizard.step.data.defaultNote'));
        b.appendChild(note);
        window.host.app.defaultDataDir(D.name.trim() || tr('wizard.defaultName')).then(function (p) { D.defDir = p; note.textContent = tr('wizard.step.data.defaultPath', { path: p }); }).catch(function () {});
        b.appendChild(cfg.folderRow({ value: D.dataDir, empty: tr('wizard.step.data.empty'), pickTitle: tr('folder.data.pickTitle'), clearable: true, guardData: true,
          onChange: function (p) { D.dataDir = p; } }).el);
      },
      skippable: true, reset: function () { D.dataDir = null; }
    },
    {
      title: tr('wizard.step.maps.title'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.maps.lead')));
        b.appendChild(cfg.folderRow({ value: D.mapsDir, empty: tr('common.notPicked'), pickTitle: tr('folder.maps.pickTitle'), clearable: true,
          onChange: function (p) { D.mapsDir = p; } }).el);
      },
      skippable: true, reset: function () { D.mapsDir = null; }
    },
    {
      title: tr('show.categories.title'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.show.lead')));
        editor = cfg.mediaEditor(D.media, function () { D.media = editor.get(); });
        b.appendChild(editor.el);
      },
      skippable: true, reset: function () { D.media = []; }
    },
    {
      title: tr('music.section'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.music.lead')));
        b.appendChild(cfg.folderRow({ value: D.musicDir, empty: tr('common.notPicked'), pickTitle: tr('music.pickTitle'), clearable: true,
          onChange: function (p) { D.musicDir = p; } }).el);
      },
      skippable: true, reset: function () { D.musicDir = null; }
    },
    {
      title: tr('blog.section'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.log.lead')));
        var folder = cfg.folderRow({ label: tr('wizard.step.log.folder'), value: D.logDir, empty: tr('wizard.step.log.folderEmpty'), pickTitle: tr('blog.folder.pickTitle'), clearable: true,
          onChange: function (p) { D.logDir = p; } });
        var on = cfg.checkRow(tr('wizard.step.log.enable'), D.logEnabled, function (v) { D.logEnabled = v; folder.el.hidden = !v; });
        b.appendChild(on.el);
        folder.el.hidden = !D.logEnabled;
        b.appendChild(folder.el);
        b.appendChild(el('div', 'cfg-note', tr('wizard.step.log.note')));
      },
      skippable: true, reset: function () { D.logEnabled = true; D.logDir = null; }
    },
    {
      title: tr('settings.playerWindow'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.player.lead')));
        b.appendChild(cfg.checkRow(tr('wizard.step.player.auto'), D.playerAuto, function (v) { D.playerAuto = v; }).el);
      },
      skippable: true, reset: function () { D.playerAuto = true; }
    },
    {
      title: tr('wizard.step.done.title'),
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', tr('wizard.step.done.lead')));
        var sum = el('div', 'wz-sum');
        function line(k, v) { var d = el('div'); d.appendChild(el('b', null, k + ': ')); d.appendChild(document.createTextNode(v)); sum.appendChild(d); }
        line(tr('wizard.sum.name'), D.name.trim() || tr('wizard.defaultName'));
        line(tr('wizard.sum.data'), D.dataDir || D.defDir || tr('wizard.sum.dataDefault'));
        line(tr('wizard.sum.maps'), D.mapsDir || tr('common.notPicked'));
        line(tr('show.categories.title'), D.media.length ? D.media.map(function (m) { return m.label; }).join(', ') : tr('wizard.sum.none'));
        line(tr('music.section'), D.musicDir || tr('common.notPicked'));
        line(tr('blog.section'), D.logEnabled ? (D.logDir || tr('wizard.sum.logNoFolder')) : tr('wizard.sum.logOff'));
        line(tr('settings.playerWindow'), D.playerAuto ? tr('wizard.sum.playerAuto') : tr('wizard.sum.playerManual'));
        b.appendChild(sum);
      },
      skippable: false, last: true
    }
  ];

  function render() {
    var s = STEPS[step];
    $('wzTitle').textContent = s.title;
    $('wzSteps').textContent = tr('wizard.stepOf', { n: step + 1, total: STEPS.length });
    var body = $('wzBody'); body.textContent = '';
    $('wzMsg').textContent = '';
    s.render(body);
    $('wzBack').hidden = step === 0;
    $('wzSkip').hidden = !s.skippable;
    $('wzNext').textContent = s.last ? tr('wizard.btn.create') : tr('wizard.wzNext');
  }

  async function create() {
    if (busy) return;
    busy = true; $('wzNext').disabled = true;
    try {
      var folders = {};
      if (D.dataDir) folders.data = D.dataDir;
      if (D.mapsDir) folders.maps = D.mapsDir;
      if (D.musicDir) folders.music = D.musicDir;
      if (D.logDir && D.logEnabled) folders.battlelog = D.logDir;
      await window.host.campaigns.create({
        name: D.name.trim() || tr('wizard.defaultName'),
        folders: folders,
        media: D.media,
        battlelog: { enabled: D.logEnabled },
        playerWindow: { auto: D.playerAuto }
      });
      await window.host.app.showGm();
    } catch (e) {
      $('wzMsg').textContent = tr('wizard.err.create', { msg: e && e.message || e });
      busy = false; $('wzNext').disabled = false;
    }
  }

  function next() {
    if (step === 1 && !D.name.trim()) D.name = tr('wizard.defaultName');
    if (STEPS[step].last) { create(); return; }
    step++; render();
  }

  async function init() {
    VTT.i18n.apply();
    try { hasCampaign = !!(await window.host.campaigns.current()); } catch (e) { hasCampaign = false; }
    $('wzCancel').hidden = !hasCampaign;
    $('wzTitle').textContent = hasCampaign ? tr('wizard.titleNew') : tr('wizard.wzTitle');
    $('wzCancel').onclick = function () { window.host.app.showGm(); };
    $('wzBack').onclick = function () { if (step > 0) { step--; render(); } };
    $('wzNext').onclick = next;
    $('wzSkip').onclick = function () { var s = STEPS[step]; if (s.reset) s.reset(); next(); };
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type === 'text' && step === 1) { e.preventDefault(); next(); }
    });
    render();
  }

  init();
})();
