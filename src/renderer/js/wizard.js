/* Мастер первого запуска: название, папки, категории «Показа», журнал боя, окно игроков -> host.campaigns.create */
(function () {
  'use strict';
  var VTT = window.VTT;
  var cfg = VTT.cfg, el = cfg.el;
  function $(id) { return document.getElementById(id); }

  var D = {
    name: '', dataDir: null, mapsDir: null, media: [],
    logEnabled: true, logDir: null, playerAuto: true
  };
  var hasCampaign = false;
  var step = 0, busy = false;
  var editor = null;      // редактор категорий (шаг «Показ»)

  var STEPS = [
    {
      title: 'Название кампании',
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', 'Как назвать кампанию? Название видно только вам.'));
        var inp = el('input'); inp.type = 'text'; inp.maxLength = 60; inp.value = D.name; inp.placeholder = 'Новая кампания';
        inp.oninput = function () { D.name = inp.value; };
        b.appendChild(inp);
        setTimeout(function () { inp.focus(); }, 0);
      },
      skippable: false
    },
    {
      title: 'Папка данных',
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', 'Здесь хранятся сцены, библиотека токенов и кэш. Если не менять — папка создастся сама.'));
        var note = el('div', 'cfg-note', 'По умолчанию: Документы ' + String.fromCharCode(92) + ' Universal DnD Battle map ' + String.fromCharCode(92) + ' <название кампании>');
        b.appendChild(note);
        window.host.app.defaultDataDir(D.name.trim() || 'Новая кампания').then(function (p) { D.defDir = p; note.textContent = 'По умолчанию: ' + p; }).catch(function () {});
        b.appendChild(cfg.folderRow({ value: D.dataDir, empty: 'по умолчанию (папка «Документы»)', pickTitle: 'Папка данных', clearable: true,
          onChange: function (p) { D.dataDir = p; } }).el);
      },
      skippable: true, reset: function () { D.dataDir = null; }
    },
    {
      title: 'Папка с картами',
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', 'Папка, где лежат карты боя (*.map.json и их картинки). Карты можно и импортировать позже — они скопируются в эту папку.'));
        b.appendChild(cfg.folderRow({ value: D.mapsDir, empty: 'не выбрана', pickTitle: 'Папка с картами боя', clearable: true,
          onChange: function (p) { D.mapsDir = p; } }).el);
      },
      skippable: true, reset: function () { D.mapsDir = null; }
    },
    {
      title: 'Категории «Показа»',
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', 'Папки с картинками для показа игрокам: портреты, гербы, иллюстрации. Название категории — любое.'));
        editor = cfg.mediaEditor(D.media, function () { D.media = editor.get(); });
        b.appendChild(editor.el);
      },
      skippable: true, reset: function () { D.media = []; }
    },
    {
      title: 'Журнал боя',
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', 'После боя можно сохранить заметку (кто кого убил, урон, ходы) в виде .md-файла.'));
        var folder = cfg.folderRow({ label: 'Папка для заметок', value: D.logDir, empty: 'не задана — спросим при сохранении', pickTitle: 'Папка журнала боя', clearable: true,
          onChange: function (p) { D.logDir = p; } });
        var on = cfg.checkRow('Вести журнал боя', D.logEnabled, function (v) { D.logEnabled = v; folder.el.hidden = !v; });
        b.appendChild(on.el);
        folder.el.hidden = !D.logEnabled;
        b.appendChild(folder.el);
        b.appendChild(el('div', 'cfg-note', 'Снимите галочку — журнал не ведётся, кнопки сохранения не будет («не сохранять»).'));
      },
      skippable: true, reset: function () { D.logEnabled = true; D.logDir = null; }
    },
    {
      title: 'Окно игроков',
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', 'Окно для экрана игроков (туман, карта, картинки). Его можно открыть кнопкой в любой момент.'));
        b.appendChild(cfg.checkRow('Открывать автоматически при запуске, если есть второй монитор', D.playerAuto, function (v) { D.playerAuto = v; }).el);
      },
      skippable: true, reset: function () { D.playerAuto = true; }
    },
    {
      title: 'Готово',
      render: function (b) {
        b.appendChild(el('p', 'wz-lead', 'Проверьте и создайте кампанию. Всё это можно изменить потом в «Настройках».'));
        var sum = el('div', 'wz-sum');
        function line(k, v) { var d = el('div'); d.appendChild(el('b', null, k + ': ')); d.appendChild(document.createTextNode(v)); sum.appendChild(d); }
        line('Название', D.name.trim() || 'Новая кампания');
        line('Данные', D.dataDir || D.defDir || 'по умолчанию (Документы)');
        line('Карты', D.mapsDir || 'не выбрана');
        line('Категории «Показа»', D.media.length ? D.media.map(function (m) { return m.label; }).join(', ') : 'нет');
        line('Журнал боя', D.logEnabled ? (D.logDir || 'включён, папка не задана') : 'не сохранять');
        line('Окно игроков', D.playerAuto ? 'открывать автоматически' : 'только по кнопке');
        b.appendChild(sum);
      },
      skippable: false, last: true
    }
  ];

  function render() {
    var s = STEPS[step];
    $('wzTitle').textContent = s.title;
    $('wzSteps').textContent = 'Шаг ' + (step + 1) + ' из ' + STEPS.length;
    var body = $('wzBody'); body.textContent = '';
    $('wzMsg').textContent = '';
    s.render(body);
    $('wzBack').hidden = step === 0;
    $('wzSkip').hidden = !s.skippable;
    $('wzNext').textContent = s.last ? 'Создать кампанию' : 'Далее';
  }

  async function create() {
    if (busy) return;
    busy = true; $('wzNext').disabled = true;
    try {
      var folders = {};
      if (D.dataDir) folders.data = D.dataDir;
      if (D.mapsDir) folders.maps = D.mapsDir;
      if (D.logDir && D.logEnabled) folders.battlelog = D.logDir;
      await window.host.campaigns.create({
        name: D.name.trim() || 'Новая кампания',
        folders: folders,
        media: D.media,
        battlelog: { enabled: D.logEnabled },
        playerWindow: { auto: D.playerAuto }
      });
      await window.host.app.showGm();
    } catch (e) {
      $('wzMsg').textContent = 'Не удалось создать кампанию: ' + (e && e.message || e);
      busy = false; $('wzNext').disabled = false;
    }
  }

  function next() {
    if (step === 0 && !D.name.trim()) D.name = 'Новая кампания';
    if (STEPS[step].last) { create(); return; }
    step++; render();
  }

  async function init() {
    try { hasCampaign = !!(await window.host.campaigns.current()); } catch (e) { hasCampaign = false; }
    $('wzCancel').hidden = !hasCampaign;
    $('wzTitle').textContent = hasCampaign ? 'Новая кампания' : 'Первый запуск';
    $('wzCancel').onclick = function () { window.host.app.showGm(); };
    $('wzBack').onclick = function () { if (step > 0) { step--; render(); } };
    $('wzNext').onclick = next;
    $('wzSkip').onclick = function () { var s = STEPS[step]; if (s.reset) s.reset(); next(); };
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type === 'text' && step === 0) { e.preventDefault(); next(); }
    });
    render();
  }

  init();
})();
