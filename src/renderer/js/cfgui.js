/* VTT.cfg — общие элементы форм настроек кампании (мастер первого запуска и окно «Настройки») */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // диалог с тремя вариантами -> 'sub' | 'asis' | 'other' (Esc/клик мимо = 'other')
  function choose3(title, text, labels) {
    return new Promise(function (resolve) {
      var overlay = el('div', 'vtt-ui-backdrop'), dlg = el('div', 'vtt-ui-dialog');
      dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
      dlg.appendChild(el('div', 'vtt-ui-title', title));
      dlg.appendChild(el('div', 'vtt-ui-text', text));
      var acts = el('div', 'vtt-ui-actions');
      function done(v) { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('other'); } }
      [['other', labels.other, ''], ['asis', labels.asis, ''], ['sub', labels.sub, ' vtt-ui-btn-ok']].forEach(function (b) {
        var btn = el('button', 'vtt-ui-btn' + b[2], b[1]); btn.type = 'button';
        btn.onclick = function () { done(b[0]); };
        acts.appendChild(btn);
      });
      dlg.appendChild(acts); overlay.appendChild(dlg); document.body.appendChild(overlay);
      document.addEventListener('keydown', onKey, true);
      acts.lastChild.focus();
    });
  }

  // выбор папки данных: если в ней есть чужие файлы — предупреждение. -> путь | null (выбрать другую / отмена)
  async function guardDataDir(p) {
    var info = null;
    try { info = await window.host.campaigns.inspectDataDir(p); } catch (e) { return p; }
    if (!info || !info.foreignCount) return p;
    var list = info.foreign.join(', ') + (info.foreignCount > info.foreign.length ? ' ' + tr('datadir.warn.more', { n: info.foreignCount - info.foreign.length }) : '');
    var r = await choose3(tr('datadir.warn.title'), tr('datadir.warn.text', { dir: p, list: list }), { sub: tr('datadir.sub'), asis: tr('datadir.asis'), other: tr('datadir.other') });
    if (r === 'asis') return p;
    if (r === 'sub') {
      var sep = p.indexOf(String.fromCharCode(92)) >= 0 ? String.fromCharCode(92) : '/';
      var last = p.charAt(p.length - 1);
      return p + (last === '/' || last === sep ? '' : sep) + 'Universal DnD Battle map';
    }
    return null;
  }

  // строка «папка»: подпись, путь, кнопки. opts: {label, value, empty, pickTitle, clearable, onChange(path|null)}
  function folderRow(opts) {
    var row = el('div', 'cfg-row');
    if (opts.label) row.appendChild(el('div', 'cfg-lbl', opts.label));
    var line = el('div', 'cfg-line');
    var path = el('div', 'cfg-path');
    var pick = el('button', null, tr('cfg.pick'));
    pick.type = 'button';
    var clr = el('button', null, tr('common.reset'));
    clr.type = 'button';
    line.appendChild(path); line.appendChild(pick);
    if (opts.clearable) line.appendChild(clr);
    row.appendChild(line);
    var value = opts.value || null;
    function paint() {
      path.textContent = value || opts.empty || tr('cfg.notSet');
      path.classList.toggle('empty', !value);
      path.title = value || '';
      clr.hidden = !value;
    }
    pick.onclick = async function () {
      var start = value || undefined;
      for (;;) {
        var p = await window.host.dialog.pickFolder({ title: opts.pickTitle || opts.label || tr('cfg.folder'), defaultPath: start });
        if (!p) return;
        if (opts.guardData) {
          var g = await guardDataDir(p);
          if (!g) { start = p; continue; }   // «Выбрать другую» — снова диалог выбора
          p = g;
        }
        value = p; paint();
        if (opts.onChange) opts.onChange(p);
        return;
      }
    };
    clr.onclick = function () { value = null; paint(); if (opts.onChange) opts.onChange(null); };
    paint();
    return { el: row, get: function () { return value; }, set: function (v) { value = v || null; paint(); } };
  }

  function newMediaId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  // редактор категорий «Показа»: список {id,label,path,recursive,exclude}; onChange(list) на каждое изменение
  function mediaEditor(list, onChange) {
    var items = (list || []).map(function (m) { return Object.assign({ recursive: false, exclude: null }, m); });
    var box = el('div', 'cfg-media');
    function fire() { if (onChange) onChange(items.map(function (m) { return Object.assign({}, m); })); }
    function render() {
      box.textContent = '';
      items.forEach(function (m, i) {
        var row = el('div', 'cfg-mrow');
        var name = el('input'); name.type = 'text'; name.value = m.label || ''; name.placeholder = tr('cfg.cat.placeholder'); name.maxLength = 40;
        name.onchange = function () { m.label = name.value.trim() || tr('cfg.cat.noName'); fire(); };
        var path = el('div', 'cfg-path', m.path || tr('cfg.cat.noFolder'));
        path.classList.toggle('empty', !m.path); path.title = m.path || '';
        var pick = el('button', null, tr('cfg.cat.folderBtn')); pick.type = 'button';
        pick.onclick = function () {
          window.host.dialog.pickFolder({ title: tr('cfg.cat.pickTitle', { label: m.label || '' }), defaultPath: m.path || undefined }).then(function (p) {
            if (!p) return;
            m.path = p;
            if (!m.label) m.label = p.split(/[\\/]/).filter(Boolean).pop() || tr('cfg.cat.default');
            render(); fire();
          });
        };
        var rec = el('label', 'cfg-chk'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!m.recursive;
        cb.onchange = function () { m.recursive = cb.checked; fire(); };
        rec.appendChild(cb); rec.appendChild(document.createTextNode(tr('cfg.cat.recursive')));
        var del = el('button', null, '✕'); del.type = 'button'; del.title = tr('cfg.cat.remove.title');
        del.onclick = function () { items.splice(i, 1); render(); fire(); };
        row.appendChild(name); row.appendChild(path); row.appendChild(pick); row.appendChild(rec); row.appendChild(del);
        box.appendChild(row);
      });
      if (!items.length) box.appendChild(el('div', 'cfg-note', tr('cfg.cat.empty')));
      var add = el('button', null, tr('cfg.cat.add')); add.type = 'button';
      add.onclick = function () { items.push({ id: newMediaId(), label: '', path: '', recursive: false, exclude: null }); render(); };
      box.appendChild(add);
    }
    render();
    return {
      el: box,
      // только заполненные категории (с папкой)
      get: function () { return items.filter(function (m) { return m.path; }).map(function (m) { return Object.assign({}, m, { label: m.label || tr('cfg.cat.default') }); }); },
      set: function (l) { items = (l || []).map(function (m) { return Object.assign({ recursive: false, exclude: null }, m); }); render(); }
    };
  }

  function checkRow(text, checked, onChange) {
    var row = el('label', 'cfg-chk cfg-row');
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!checked;
    cb.onchange = function () { if (onChange) onChange(cb.checked); };
    row.appendChild(cb); row.appendChild(document.createTextNode(' ' + text));
    return { el: row, input: cb };
  }

  // языки интерфейса: названия — на самом языке, не переводятся
  var LANGS = [{ code: 'ru', name: 'Русский' }, { code: 'en', name: 'English' }];

  // смена языка интерфейса (глобальная настройка): сначала сброс сцены на диск, затем главный процесс сохраняет язык,
  // пересобирает меню и перезагружает окна (GM, редактор, игроков)
  async function setLanguage(code) {
    if (code === VTT.i18n.lang) return;
    try { if (VTT.gm && VTT.gm.flush) await VTT.gm.flush(); } catch (e) { console.warn('flush', e); }
    try { sessionStorage.setItem('udbm.silentReload', '1'); } catch (e) { /* ignore */ }   // после перезагрузки бой восстановится без вопроса «сохранить?»
    try { await window.host.settings.set({ lang: code }); }
    catch (e) { try { sessionStorage.removeItem('udbm.silentReload'); } catch (_) { /* ignore */ } throw e; }
  }

  VTT.cfg = { LANGS: LANGS, setLanguage: setLanguage, el: el, choose3: choose3, folderRow: folderRow, guardDataDir: guardDataDir, mediaEditor: mediaEditor, checkRow: checkRow };
})();
