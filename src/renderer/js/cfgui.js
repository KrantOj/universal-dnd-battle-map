/* VTT.cfg — общие элементы форм настроек кампании (мастер первого запуска и окно «Настройки») */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // строка «папка»: подпись, путь, кнопки. opts: {label, value, empty, pickTitle, clearable, onChange(path|null)}
  function folderRow(opts) {
    var row = el('div', 'cfg-row');
    if (opts.label) row.appendChild(el('div', 'cfg-lbl', opts.label));
    var line = el('div', 'cfg-line');
    var path = el('div', 'cfg-path');
    var pick = el('button', null, 'Выбрать…');
    pick.type = 'button';
    var clr = el('button', null, 'Сбросить');
    clr.type = 'button';
    line.appendChild(path); line.appendChild(pick);
    if (opts.clearable) line.appendChild(clr);
    row.appendChild(line);
    var value = opts.value || null;
    function paint() {
      path.textContent = value || opts.empty || 'не задана';
      path.classList.toggle('empty', !value);
      path.title = value || '';
      clr.hidden = !value;
    }
    pick.onclick = function () {
      window.host.dialog.pickFolder({ title: opts.pickTitle || opts.label || 'Папка', defaultPath: value || undefined }).then(function (p) {
        if (!p) return;
        value = p; paint();
        if (opts.onChange) opts.onChange(p);
      });
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
        var name = el('input'); name.type = 'text'; name.value = m.label || ''; name.placeholder = 'Название (Портреты, Гербы…)'; name.maxLength = 40;
        name.onchange = function () { m.label = name.value.trim() || 'Без названия'; fire(); };
        var path = el('div', 'cfg-path', m.path || 'папка не выбрана');
        path.classList.toggle('empty', !m.path); path.title = m.path || '';
        var pick = el('button', null, 'Папка…'); pick.type = 'button';
        pick.onclick = function () {
          window.host.dialog.pickFolder({ title: 'Папка с картинками: ' + (m.label || ''), defaultPath: m.path || undefined }).then(function (p) {
            if (!p) return;
            m.path = p;
            if (!m.label) m.label = p.split(/[\\/]/).filter(Boolean).pop() || 'Категория';
            render(); fire();
          });
        };
        var rec = el('label', 'cfg-chk'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!m.recursive;
        cb.onchange = function () { m.recursive = cb.checked; fire(); };
        rec.appendChild(cb); rec.appendChild(document.createTextNode(' с подпапками'));
        var del = el('button', null, '✕'); del.type = 'button'; del.title = 'Убрать категорию';
        del.onclick = function () { items.splice(i, 1); render(); fire(); };
        row.appendChild(name); row.appendChild(path); row.appendChild(pick); row.appendChild(rec); row.appendChild(del);
        box.appendChild(row);
      });
      if (!items.length) box.appendChild(el('div', 'cfg-note', 'Категорий нет. «Показ» будет пустым — добавьте папки с портретами, гербами, картами.'));
      var add = el('button', null, '+ Категория'); add.type = 'button';
      add.onclick = function () { items.push({ id: newMediaId(), label: '', path: '', recursive: false, exclude: null }); render(); };
      box.appendChild(add);
    }
    render();
    return {
      el: box,
      // только заполненные категории (с папкой)
      get: function () { return items.filter(function (m) { return m.path; }).map(function (m) { return Object.assign({}, m, { label: m.label || 'Категория' }); }); },
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

  VTT.cfg = { el: el, folderRow: folderRow, mediaEditor: mediaEditor, checkRow: checkRow };
})();
