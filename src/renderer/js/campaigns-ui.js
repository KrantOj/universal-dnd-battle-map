/* VTT.campaignsUi — выбор кампании при запуске, окно «Кампании» (создать, переименовать, дублировать, удалить,
   переключить), экспорт и импорт .udbm. Данные — только через window.host. */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;
  var el = function (tag, cls, text) { return VTT.cfg.el(tag, cls, text); };
  var H = function () { return window.host; };
  var CHOSEN_KEY = 'udbm.campaignChosen';

  // ------------------------------------------------------------------ окно-карточка
  // -> {card, body, actions, close}; Esc закрывает (если не открыт диалог VTT.ui)
  function modal(title, opts) {
    var o = opts || {};
    var overlay = el('div', 'overlay cu-overlay');
    var card = el('div', 'card cu-card');
    card.appendChild(el('h2', null, title));
    var body = el('div', 'cu-body'); card.appendChild(body);
    var actions = el('div', 'btnrow end'); card.appendChild(actions);
    overlay.appendChild(card);
    var closed = false;
    function close(result) {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (o.onClose) o.onClose(result);
    }
    function onKey(e) {
      if (e.key === 'Escape' && !document.querySelector('.vtt-ui-backdrop') && !o.noEsc) { e.preventDefault(); e.stopPropagation(); close(null); }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    return { overlay: overlay, card: card, body: body, actions: actions, close: close };
  }
  function btn(text, cls, fn) {
    var b = el('button', cls || null, text); b.type = 'button';
    if (fn) b.onclick = fn;
    return b;
  }
  function fmtEta(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return tr('archive.eta.lt1');
    return tr('archive.eta.min', { m: Math.floor(sec / 60), s: sec % 60 });
  }
  // модальное «занято»: рисуем и ждём кадр, чтобы оверлей реально появился до тяжёлой работы в main
  async function withBusy(text, work) {
    var ov = el('div', 'cu-busy');
    var box = el('div', 'cu-busy-box');
    box.appendChild(el('div', 'cu-spin'));
    box.appendChild(el('div', 'cu-busy-text', text));
    ov.appendChild(box);
    document.body.appendChild(ov);
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 60); }); }); });
    try { return await work(); }
    finally { if (ov.parentNode) ov.parentNode.removeChild(ov); }
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' ' + tr('unit.b');
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' ' + tr('unit.kb');
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' ' + tr('unit.mb');
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' ' + tr('unit.gb');
  }
  function errText(e) {
    var m = String(e && e.message || e);
    if (m === 'ARCHIVE_NOT_UDBM') return tr('archive.err.notUdbm');
    if (m.indexOf('ARCHIVE_FORMAT:') === 0) return tr('archive.err.format', { format: m.slice(15) });
    if (m === 'DATA_DIR_IN_USE') return tr('archive.err.dataInUse');
    if (m === 'DATA_DIR_REQUIRED') return tr('archive.err.dataRequired');
    if (m === 'NO_CAMPAIGN') return tr('archive.err.noCampaign');
    return m;
  }
  function flush() { return VTT.gm && VTT.gm.flush ? VTT.gm.flush() : Promise.resolve(); }

  // ------------------------------------------------------------------ выбор кампании
  // list -> Promise<id|null>; текущая (последняя использованная) выбрана заранее
  function chooser(list, curId) {
    return new Promise(function (resolve) {
      var sel = curId;
      var m = modal(tr('campaigns.chooser.title'), { noEsc: true, onClose: function (r) { resolve(r); } });
      m.body.appendChild(el('div', 'cfg-note', tr('campaigns.chooser.note')));
      var box = el('div', 'list cu-list');
      function paint() {
        box.textContent = '';
        list.forEach(function (c) {
          var b = el('button', 'cu-item' + (c.id === sel ? ' sel' : ''));
          b.type = 'button';
          b.appendChild(el('span', 'cu-name', c.name));
          if (c.id === curId) b.appendChild(el('span', 'cu-tag', tr('campaigns.last')));
          b.appendChild(el('span', 'cu-path', c.folders && c.folders.data || ''));
          b.onclick = function () { sel = c.id; paint(); };
          b.ondblclick = function () { m.close(sel); };
          box.appendChild(b);
        });
      }
      paint();
      m.body.appendChild(box);
      var ok = btn(tr('campaigns.chooser.open'), 'primary', function () { m.close(sel); });
      m.actions.appendChild(ok);
      ok.focus();
    });
  }

  // Вызвать до инициализации окна мастера. Если кампаний больше одной и выбор ещё не делался в этом окне — спросить.
  async function startup() {
    var list = [], cur = null;
    try { list = await H().campaigns.list(); cur = await H().campaigns.current(); } catch (e) { return; }
    var done = false;
    try { done = sessionStorage.getItem(CHOSEN_KEY) === '1'; } catch (e) { /* ignore */ }
    if (list.length > 1 && !done) {
      var id = await chooser(list, cur && cur.id);
      if (id && (!cur || id !== cur.id)) { try { await H().campaigns.switch(id); } catch (e) { /* ignore */ } }
    }
    try { sessionStorage.setItem(CHOSEN_KEY, '1'); } catch (e) { /* ignore */ }
  }

  async function switchTo(id) {
    await flush();
    await H().campaigns.switch(id);      // дальше VTT.gm переинициализируется по campaigns.onChanged
  }

  // ------------------------------------------------------------------ окно «Кампании»
  var mgr = null;
  async function openManager() {
    if (mgr) return;
    var m = mgr = modal(tr('campaigns.title'), { onClose: function () { mgr = null; } });
    m.card.classList.add('cu-wide');
    var box = el('div', 'list cu-list');
    var msg = el('div', 'cfg-note cu-msg');
    m.body.appendChild(box); m.body.appendChild(msg);
    function say(t, isErr) { msg.textContent = t || ''; msg.classList.toggle('err', !!isErr); }

    async function paint() {
      var list = [], cur = null;
      try { list = await H().campaigns.list(); cur = await H().campaigns.current(); } catch (e) { say(errText(e), true); }
      box.textContent = '';
      list.forEach(function (c) {
        var isCur = !!(cur && cur.id === c.id);
        var row = el('div', 'cu-row' + (isCur ? ' cur' : ''));
        var info = el('div', 'cu-info');
        var nm = el('div', 'cu-name', c.name);
        if (isCur) nm.appendChild(el('span', 'cu-tag', tr('campaigns.current')));
        info.appendChild(nm);
        info.appendChild(el('div', 'cu-path', c.folders && c.folders.data || ''));
        row.appendChild(info);
        var bs = el('div', 'cu-btns');
        if (!isCur) bs.appendChild(btn(tr('campaigns.open'), 'primary', async function () { m.close(); await switchTo(c.id); }));
        bs.appendChild(btn(tr('campaigns.rename'), null, async function () {
          var v = await VTT.ui.prompt({ title: tr('campaigns.rename.title'), value: c.name });
          v = v && v.trim();
          if (!v || v === c.name) return;
          try { await H().campaigns.update(c.id, { name: v }); } catch (e) { say(errText(e), true); }
          paint();
        }));
        bs.appendChild(btn(tr('campaigns.duplicate'), null, async function () {
          try { var d = await H().campaigns.duplicate(c.id); say(tr('campaigns.duplicated', { name: d.name })); } catch (e) { say(errText(e), true); }
          paint();
        }));
        bs.appendChild(btn(tr('campaigns.delete'), 'danger', function () { removeCampaign(c, list.length, isCur); }));
        row.appendChild(bs);
        box.appendChild(row);
      });
    }

    async function removeCampaign(c, count, isCur) {
      // подтверждение + отдельный флажок «удалить и папку данных» (с повторным подтверждением)
      var wipe = false;
      var ok = await new Promise(function (resolve) {
        var d = modal(tr('campaigns.delete.title', { name: c.name }), { onClose: function (r) { resolve(r === true); } });
        d.body.appendChild(el('div', null, tr('campaigns.delete.text')));
        var cb = VTT.cfg.checkRow(tr('campaigns.delete.wipe', { dir: c.folders && c.folders.data || '' }), false, function (v) { wipe = v; });
        d.body.appendChild(cb.el);
        d.body.appendChild(el('div', 'cfg-note', tr('campaigns.delete.wipeNote')));
        d.actions.appendChild(btn(tr('common.cancel'), null, function () { d.close(false); }));
        d.actions.appendChild(btn(tr('campaigns.delete'), 'danger', function () { d.close(true); }));
      });
      if (!ok) return;
      if (wipe) {
        var sure = await VTT.ui.confirm({ title: tr('campaigns.wipe.title'), text: tr('campaigns.wipe.text', { dir: c.folders && c.folders.data || '' }), ok: tr('campaigns.wipe.ok'), danger: true });
        if (!sure) return;
      }
      try {
        if (isCur) await flush();
        await H().campaigns.remove(c.id, { deleteData: wipe });
        say(tr('campaigns.deleted', { name: c.name }));
      } catch (e) { say(errText(e), true); }
      paint();
    }

    m.actions.appendChild(btn(tr('campaigns.create'), null, async function () { m.close(); await flush(); H().app.showWizard(); }));
    m.actions.appendChild(btn(tr('campaigns.export'), null, function () { m.close(); openExport(); }));
    m.actions.appendChild(btn(tr('campaigns.import'), null, function () { m.close(); openImport(); }));
    var sp = el('span', 'wz-spacer'); m.actions.insertBefore(sp, m.actions.firstChild);
    m.actions.appendChild(btn(tr('common.close'), 'primary', function () { m.close(); }));
    await paint();
  }

  // ------------------------------------------------------------------ экспорт
  async function openExport() {
    var c = null;
    try { c = await H().campaigns.current(); } catch (e) { /* ignore */ }
    if (!c) { VTT.ui.alert({ title: tr('campaigns.export'), text: tr('archive.err.noCampaign') }); return; }
    await flush();
    var inc = { maps: false, media: false, battlelog: false };
    var m = modal(tr('archive.export.title', { name: c.name }));
    m.body.appendChild(el('div', 'cfg-note', tr('archive.export.lead')));
    var hasMaps = !!(c.folders && c.folders.maps), hasMedia = (c.media || []).some(function (x) { return x.path; });
    var hasLog = !!(c.folders && c.folders.battlelog) && !(c.battlelog && c.battlelog.enabled === false);
    var sizeEl = el('div', 'cu-size');
    var warnEl = el('div', 'cu-warn');
    var eta = '';
    var seq = 0;
    async function recount() {
      var my = ++seq;
      sizeEl.textContent = tr('archive.export.counting');
      try {
        var r = await H().archive.estimate(inc);
        if (my !== seq) return;
        eta = fmtEta(r.seconds);
        warnEl.textContent = tr('archive.export.warn', { eta: eta });
        sizeEl.textContent = tr('archive.export.size', { size: fmtBytes(r.bytes), files: r.files, data: fmtBytes(r.parts.data), maps: fmtBytes(r.parts.maps), media: fmtBytes(r.parts.media), logs: fmtBytes(r.parts.battlelog) }) + '\n' + tr('archive.eta.label', { eta: eta });
      } catch (e) { sizeEl.textContent = errText(e); }
    }
    function chk(key, text, enabled) {
      var r = VTT.cfg.checkRow(text, false, function (v) { inc[key] = v; recount(); });
      r.input.disabled = !enabled;
      if (!enabled) r.el.classList.add('dis');
      m.body.appendChild(r.el);
    }
    m.body.appendChild(el('div', 'cfg-note', tr('archive.export.always')));
    chk('maps', tr('archive.export.maps'), hasMaps);
    chk('media', tr('archive.export.media'), hasMedia);
    chk('battlelog', tr('archive.export.logs'), hasLog);
    m.body.appendChild(sizeEl);
    m.body.appendChild(warnEl);
    var msg = el('div', 'cfg-note cu-msg'); m.body.appendChild(msg);
    m.actions.appendChild(btn(tr('common.cancel'), null, function () { m.close(); }));
    var go = btn(tr('archive.export.save'), 'primary', async function () {
      var dest = await H().dialog.saveFile({ title: tr('archive.export.saveTitle'), defaultName: String(c.name).replace(/[\\/:*?"<>|]/g, '_') + '.udbm', filters: [{ name: tr('archive.filter'), extensions: ['udbm'] }] });
      if (!dest) return;
      go.disabled = true; msg.classList.remove('err'); msg.textContent = tr('archive.export.working');
      try {
        var r = await withBusy(tr('archive.export.busy') + '\n' + tr('archive.export.warn', { eta: eta }), function () { return H().archive.export(dest, inc); });
        m.close();
        VTT.ui.alert({ title: tr('archive.export.done'), text: tr('archive.export.doneText', { path: r.path, size: fmtBytes(r.bytes), files: r.files }) });
      } catch (e) { msg.classList.add('err'); msg.textContent = errText(e); go.disabled = false; }
    });
    m.actions.appendChild(go);
    recount();
  }

  // ------------------------------------------------------------------ импорт
  async function openImport() {
    var files = await H().dialog.pickFiles({ title: tr('archive.import.pickTitle'), filters: [{ name: tr('archive.filter'), extensions: ['udbm'] }], multi: false });
    if (!files || !files.length) return;
    var file = files[0], info;
    try { info = await H().archive.inspect(file); }
    catch (e) { VTT.ui.alert({ title: tr('archive.import.title'), text: errText(e) }); return; }
    var cur = null;
    try { cur = await H().campaigns.current(); } catch (e) { /* ignore */ }
    var mode = 'new', name = info.name, dataDir = info.defaultDataDir;
    var m = modal(tr('archive.import.title'));
    var inc = info.include || {};
    var parts = [tr('archive.import.part.data')];
    if (inc.maps) parts.push(tr('archive.import.part.maps'));
    if (inc.media) parts.push(tr('archive.import.part.media'));
    if (inc.battlelog) parts.push(tr('archive.import.part.logs'));
    var sum = el('div', 'wz-sum');
    [[tr('archive.import.name'), info.name], [tr('archive.import.app'), info.app || '—'], [tr('archive.import.created'), info.created ? new Date(info.created).toLocaleString() : '—'],
     [tr('archive.import.contains'), parts.join(', ')], [tr('archive.import.fileSize'), fmtBytes(info.fileBytes)]].forEach(function (r) {
      var d = el('div'); d.appendChild(el('b', null, r[0] + ': ')); d.appendChild(document.createTextNode(r[1])); sum.appendChild(d);
    });
    m.body.appendChild(sum);
    var impEta = fmtEta(info.seconds);
    m.body.appendChild(el('div', 'cu-warn', tr('archive.import.warn', { eta: impEta })));

    var optNew = VTT.cfg.checkRow(tr('archive.import.asNew'), true, null);
    var optRep = VTT.cfg.checkRow(tr('archive.import.replace', { name: cur ? cur.name : '' }), false, null);
    optNew.input.type = 'radio'; optRep.input.type = 'radio';
    optNew.input.name = optRep.input.name = 'udbmMode';
    optRep.input.disabled = !cur;
    m.body.appendChild(optNew.el);
    var newBox = el('div', 'cu-sub');
    var nameRow = el('div', 'cfg-row'); nameRow.appendChild(el('div', 'cfg-lbl', tr('settings.campName')));
    var nameIn = el('input'); nameIn.type = 'text'; nameIn.maxLength = 60; nameIn.value = name;
    nameIn.oninput = function () { name = nameIn.value; };
    nameRow.appendChild(nameIn); newBox.appendChild(nameRow);
    var dirRow = VTT.cfg.folderRow({ label: tr('archive.import.dataDir'), value: dataDir, pickTitle: tr('folder.data.pickTitle'), onChange: function (p) { if (p) dataDir = p; } });
    newBox.appendChild(dirRow.el);
    newBox.appendChild(el('div', 'cfg-note', tr('archive.import.newNote')));
    m.body.appendChild(newBox);
    m.body.appendChild(optRep.el);
    var repBox = el('div', 'cu-sub cfg-note', tr('archive.import.replaceNote')); repBox.hidden = true;
    m.body.appendChild(repBox);
    function setMode(v) { mode = v; newBox.hidden = v !== 'new'; repBox.hidden = v !== 'replace'; }
    optNew.input.onchange = function () { if (optNew.input.checked) setMode('new'); };
    optRep.input.onchange = function () { if (optRep.input.checked) setMode('replace'); };
    optNew.input.checked = true;

    var msg = el('div', 'cfg-note cu-msg'); m.body.appendChild(msg);
    m.actions.appendChild(btn(tr('common.cancel'), null, function () { m.close(); }));
    var go = btn(tr('archive.import.go'), 'primary', async function () {
      if (mode === 'replace') {
        var sure = await VTT.ui.confirm({ title: tr('archive.import.confirm.title'), text: tr('archive.import.confirm.text', { name: cur.name }), ok: tr('archive.import.confirm.ok'), danger: true });
        if (!sure) return;
        await flush();
      }
      go.disabled = true; msg.classList.remove('err'); msg.textContent = tr('archive.import.working');
      try {
        var r = await withBusy(tr('archive.import.busy') + '\n' + tr('archive.import.warn', { eta: impEta }), function () {
          return H().archive.import(file, mode === 'replace' ? { mode: 'replace' } : { mode: 'new', dataDir: dataDir, name: name.trim() || info.name });
        });
        m.close();
        if (mode === 'replace' && VTT.gm && VTT.gm.reinit) await VTT.gm.reinit();   // тот же id кампании: переинициализация вручную
        var n = r && r._import ? r._import.files : 0;
        if (VTT.gm && VTT.gm._api) VTT.gm._api.toast(tr('archive.import.done', { name: r.name, files: n }), 4000);
      } catch (e) { msg.classList.add('err'); msg.textContent = errText(e); go.disabled = false; }
    });
    m.actions.appendChild(go);
  }

  VTT.campaignsUi = {
    startup: startup, chooser: chooser, openManager: openManager, openExport: openExport, openImport: openImport,
    switchTo: switchTo, _modal: modal
  };
})();
