/* VTT.editor — окно редактора карт: импорт картинки, сетка, стены, двери, местность, высоты, проверка, сохранение.
 * Модель и сериализация — editor-model.js, рисование — editor-view.js. Результат — обычный map.json в папке карт. */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;
  var M = function () { return VTT.editorModel; };
  var H = function () { return window.host; };
  function $(id) { return document.getElementById(id); }

  var DRAFT = 'editor-draft.json';
  var STAGE = 'editor-stage';       // data/editor-stage/<имя>/<картинка> — новая карта до первого сохранения
  var E = {
    model: null, img: null, hist: null, savedSnap: null, entryRel: null, imgRel: null, imgRoot: 'maps', isNew: false,
    tool: 'select', vis: { walls: true, terrain: true, elev: true, grid: true },
    sel: null, pv: {}, kind: 'difficult', shape: 'brush', size: 1, fillWalls: true, doorOpen: false,
    view: null, drag: null, wallPts: null, boxMode: false, box: null, spanMode: false, span: null, space: false, pan: null, hoverCell: null
  };
  var drawQueued = false, draftTimer = null, commitTimer = null;

  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2500);
  }
  function fileOf(p) { return String(p).split(/[\\/]/).pop(); }
  function dirOf(p) { var i = String(p).lastIndexOf('/'); return i < 0 ? '' : String(p).slice(0, i); }
  function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim(); }
  function inputFocused() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'radio' && a.type !== 'button'));
  }
  function modalOpen() { return !!document.querySelector('.vtt-ui-backdrop') || !$('edStart').hidden; }

  // ------------------------------------------------------------------ рисование / координаты
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () {
      drawQueued = false;
      E.pv.box = E.boxMode ? E.box : null;
      E.pv.span = E.spanMode && E.span ? E.span : null;
      E.view.draw(E);
      $('stZoom').textContent = Math.round(E.view.z * 100) + '%';
    });
  }
  function pointerPos(e) { var r = $('edCanvas').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  /** Экран -> клетки (дробные) и пиксели картинки. */
  function toCell(sx, sy) {
    var m = E.model, ip = E.view.toImg(sx, sy);
    return { px: ip.x, py: ip.y, fx: (ip.x - m.offX) / m.ppg, fy: (ip.y - m.offY) / m.ppg };
  }
  function cellToClient(fx, fy) {
    var m = E.model, s = E.view.toScreen(m.offX + fx * m.ppg, m.offY + fy * m.ppg), r = $('edCanvas').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }
  function tolCells() { return 9 / (E.model.ppg * E.view.z); }
  function snap(c, e) {
    var free = !!(e && e.altKey);
    $('stSnap').textContent = free ? tr('editor.status.free') : '';
    return free ? { x: M().round2(c.fx), y: M().round2(c.fy) } : M().snapCorner(c.fx, c.fy);
  }

  // ------------------------------------------------------------------ история, черновик, «грязное» состояние
  function isDirty() { return !!E.model && M().snapshot(E.model) !== E.savedSnap; }
  function updateDirty() {
    var d = isDirty();
    $('stDirty').textContent = E.model ? (d ? tr('editor.status.unsaved') : tr('editor.status.saved')) : '';
    $('edUndo').disabled = !(E.hist && E.hist.canUndo()); $('edRedo').disabled = !(E.hist && E.hist.canRedo());
    $('edName').textContent = E.model ? (E.model.title || '') + (d ? ' *' : '') : '';
    try { H().editor.setDirty(d); } catch (e) { /* ignore */ }
  }
  function commit() {
    clearTimeout(commitTimer); commitTimer = null;
    if (!E.model) return;
    E.hist.push(M().snapshot(E.model));
    updateDirty(); scheduleDraft(); syncPanel(); requestDraw();
  }
  function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 450); }
  function scheduleDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 1200); }
  async function writeDraft() {
    if (!E.model) return;
    try {
      await H().fs.writeText('data', DRAFT, JSON.stringify({
        format: 'udbm-editor-draft/1', ts: Date.now(), entryRel: E.entryRel, imgRel: E.imgRel, imgRoot: E.imgRoot, isNew: E.isNew, auto: $('gAuto').checked, meta: M().toMeta(E.model)
      }));
    } catch (e) { console.warn('draft', e); }
  }
  async function clearDraft() {
    clearTimeout(draftTimer);
    try { if (await H().fs.exists('data', DRAFT)) await H().fs.remove('data', DRAFT); } catch (e) { /* ignore */ }
  }
  function undoRedo(redo) {
    if (!E.model) return;
    var s = redo ? E.hist.redo() : E.hist.undo();
    if (s === null) return;
    M().restore(E.model, s);
    E.sel = null; E.wallPts = null; E.pv = {}; E.drag = null;
    updateDirty(); scheduleDraft(); syncPanel(); requestDraw();
  }

  // ------------------------------------------------------------------ панели
  function syncPanel() {
    var m = E.model;
    Array.prototype.forEach.call(document.querySelectorAll('.etool'), function (b) { b.classList.toggle('active', b.getAttribute('data-tool') === E.tool); });
    Array.prototype.forEach.call(document.querySelectorAll('.ed-sec[data-for]'), function (s) {
      s.hidden = !m || s.getAttribute('data-for').split(' ').indexOf(E.tool) < 0;
    });
    $('pMap').hidden = !m; $('pLegend').hidden = !m;
    $('edEmpty').hidden = !!m;
    $('stTool').textContent = tr('editor.tool.' + E.tool + '.title');
    if (!m) return;
    var set = function (id, v) { if (document.activeElement !== $(id)) $(id).value = v; };
    set('gPpg', m.ppg); set('gFeet', m.feet); set('gOffX', m.offX); set('gOffY', m.offY); set('gCols', m.cols); set('gRows', m.rows); set('fTitle', m.title);
    $('gImg').textContent = tr('editor.grid.imgInfo', { w: m.imgW, h: m.imgH, gw: m.cols * m.ppg, gh: m.rows * m.ppg });
    $('gBox').classList.toggle('active', E.boxMode); $('gSpan').classList.toggle('active', E.spanMode);
    Array.prototype.forEach.call(document.querySelectorAll('#tKinds button'), function (b) { b.classList.toggle('active', b.getAttribute('data-kind') === E.kind); });
    Array.prototype.forEach.call(document.querySelectorAll('.shp'), function (b) { b.classList.toggle('active', b.getAttribute('data-shape') === E.shape); });
    Array.prototype.forEach.call(document.querySelectorAll('.siz'), function (b) { b.classList.toggle('active', +b.getAttribute('data-size') === E.size); });
    $('sizes').hidden = E.shape !== 'brush'; $('fWalls').parentNode.hidden = E.shape !== 'fill';
    syncSelection();
  }
  function syncSelection() {
    var s = E.sel, m = E.model, info = tr('editor.select.none');
    var isDoor = !!(s && s.kind === 'door' && m && m.doors[s.di]);
    var isPt = !!(s && (s.kind === 'point' || s.kind === 'seg') && m && m.walls[s.wi]);
    if (isDoor) {
      var d = m.doors[s.di];
      info = tr('editor.select.door', { name: VTT.geometry.cellName(d.position.x, d.position.y), dir: d.dir === 'v' ? tr('editor.dir.v') : tr('editor.dir.h') });
      $('sOpen').checked = !!d.open;
    } else if (isPt) {
      info = s.kind === 'point' ? tr('editor.select.point', { x: m.walls[s.wi][s.pi].x, y: m.walls[s.wi][s.pi].y }) : tr('editor.select.seg');
    }
    $('sInfo').textContent = info;
    $('sOpenRow').hidden = !isDoor; $('sDoorWall').hidden = !isDoor; $('sDoorGap').hidden = !isDoor; $('sDel').hidden = !isPt;
  }
  function setTool(t) {
    if (E.wallPts && t !== 'wall') E.wallPts = null;
    E.tool = t; E.sel = null; E.pv = {}; E.drag = null;
    if (t !== 'grid') { E.boxMode = false; E.spanMode = false; E.span = null; }
    syncPanel(); requestDraw();
  }

  // ------------------------------------------------------------------ загрузка / создание карт
  function loadModel(model, img, o) {
    E.model = model; E.img = img; E.entryRel = o.entryRel; E.imgRel = o.imgRel; E.imgRoot = o.imgRoot || 'maps'; E.isNew = !!o.isNew;
    E.hist = new (M().History)(100); E.hist.reset(M().snapshot(model));
    E.savedSnap = o.isNew || o.dirty ? null : M().snapshot(model);
    E.sel = null; E.wallPts = null; E.pv = {}; E.drag = null; E.boxMode = false; E.spanMode = false; E.span = null;
    $('gAuto').checked = !!o.auto;
    $('edStart').hidden = true;
    E.view.resize(); E.view.fit(model.imgW, model.imgH);
    setTool(o.isNew ? 'grid' : 'select');
    updateDirty();
    if (o.isNew || o.dirty) scheduleDraft();
  }
  async function confirmDiscard() {
    if (!isDirty()) return true;
    return VTT.ui.confirm({ title: tr('editor.discard.title'), text: tr('editor.discard.text'), ok: tr('editor.discard.ok'), danger: true });
  }
  function errText(e) { return /ROOT_NOT_SET/.test((e && e.message) || '') ? tr('editor.err.noMapsDir') : (e && e.message) || String(e); }

  async function newFromImage() {
    if (!(await confirmDiscard())) return;
    try {
      var paths = await H().dialog.pickFiles({ title: tr('editor.new.pickTitle'), filters: [{ name: tr('editor.new.filter'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }], multi: false });
      if (!paths || !paths.length) return;
      var base = fileOf(paths[0]).replace(/\.[^.]+$/, '');
      var name = await VTT.ui.prompt({ title: tr('editor.new.nameTitle'), text: tr('editor.new.nameText'), value: safeName(base) });
      if (name === null || name === undefined) return;
      name = safeName(name);
      if (!name) return;
      if (await H().fs.exists('maps', name + '/' + name + '.map.json')) { await VTT.ui.alert({ title: tr('common.attention'), text: tr('editor.new.exists', { name: name }) }); return; }
      // картинка копируется в папку карт только при первом сохранении; до этого лежит во временной папке данных (отмена не оставляет мусора в maps/)
      await H().fs.remove('data', STAGE).catch(function () {});
      var rels = await H().fs.importFiles([paths[0]], 'data', STAGE + '/' + name);
      var imgRel = rels[0];
      var img = await VTT.store._loadImage(H().fs.url('data', imgRel));
      var model = M().create({ name: name, image: fileOf(imgRel), imgW: img.naturalWidth, imgH: img.naturalHeight, ppg: 70 });
      loadModel(model, img, { entryRel: name + '/' + name + '.map.json', imgRel: imgRel, imgRoot: 'data', isNew: true, auto: true });
    } catch (e) { VTT.ui.alert({ title: tr('common.attention'), text: errText(e) }); }
  }

  async function openEntry(rel) {
    try {
      var entry = { name: fileOf(rel).replace(/\.map\.json$/i, '').replace(/\.json$/i, ''), rel: rel, dir: dirOf(rel), imageName: '' };
      var map = await VTT.store.loadMapFromEntry(entry);
      var model = M().fromMeta(map.meta, { width: map.image.naturalWidth, height: map.image.naturalHeight });
      model.image = fileOf(map.imageRel);
      if (!model.title) model.title = entry.name;
      loadModel(model, map.image, { entryRel: rel, imgRel: map.imageRel, isNew: false, auto: false });
      if (map.warning) toast(map.warning, 5000);
    } catch (e) { VTT.ui.alert({ title: tr('common.attention'), text: tr('gm.err.load', { msg: errText(e) }) }); }
  }
  async function openWithConfirm(rel) { if (await confirmDiscard()) await openEntry(rel); }

  async function showStart() {
    $('edStart').hidden = false; $('stMsg').textContent = '';
    var list = $('stList'); list.textContent = '';
    try {
      var es = await VTT.store.listMaps();
      if (!es.length) list.textContent = tr('editor.start.empty');
      es.forEach(function (en) {
        var b = document.createElement('button'); b.textContent = '🗺 ' + en.name; b.title = en.rel;
        b.onclick = function () { openWithConfirm(en.rel); };
        list.appendChild(b);
      });
    } catch (e) { $('stMsg').textContent = errText(e); }
  }

  // ------------------------------------------------------------------ проверка и сохранение
  function lines(list) {
    return list.map(function (v) { return (v.level === 'error' ? '✖ ' : '⚠ ') + tr('editor.val.' + v.code, v.params); }).join('\n');
  }
  async function check() {
    if (!E.model) return;
    var list = M().validate(E.model);
    if (!list.length) { toast(tr('editor.val.ok')); return; }
    await VTT.ui.alert({ title: tr('editor.val.title'), text: lines(list) });
  }
  async function save() {
    var m = E.model;
    if (!m) return false;
    var list = M().validate(m);
    var errs = list.filter(function (v) { return v.level === 'error'; });
    if (errs.length) { await VTT.ui.alert({ title: tr('editor.val.title'), text: lines(errs) }); return false; }
    if (list.length) {
      var ok = await VTT.ui.confirm({ title: tr('editor.save.warnTitle'), text: lines(list) + '\n\n' + tr('editor.save.warnText'), ok: tr('editor.save.anyway') });
      if (!ok) return false;
    }
    try {
      if (E.imgRoot !== 'maps') {      // первое сохранение новой карты: перенести картинку из временной папки в maps/<имя>/
        var dir = dirOf(E.entryRel), fname = fileOf(E.imgRel);
        await H().fs.writeBinary('maps', dir + '/' + fname, await H().fs.readBinary(E.imgRoot, E.imgRel));
        await H().fs.remove(E.imgRoot, STAGE).catch(function () {});
        E.imgRoot = 'maps'; E.imgRel = dir + '/' + fname;
      }
      await H().fs.writeText('maps', E.entryRel, JSON.stringify(M().toMeta(m), null, 2) + '\n');
    } catch (e) { VTT.ui.alert({ title: tr('common.attention'), text: tr('common.saveFailed', { msg: errText(e) }) }); return false; }
    m.origGrid = { width: m.imgW, height: m.imgH };
    E.savedSnap = M().snapshot(m); E.isNew = false;
    await clearDraft();
    updateDirty(); toast(tr('editor.save.done', { name: E.entryRel }));
    return true;
  }
  async function battle() {
    if (!E.model) return;
    if (E.isNew || isDirty()) { if (!(await save())) return; }
    await H().editor.openInGm(E.entryRel);
  }

  // ------------------------------------------------------------------ сетка
  function applyGridValues(src) {
    var m = E.model; if (!m) return;
    var num = function (id, def) { var v = parseFloat($(id).value); return isFinite(v) ? v : def; };
    m.ppg = Math.max(1, Math.round(num('gPpg', m.ppg))); m.feet = Math.max(1, Math.round(num('gFeet', m.feet)));
    m.offX = Math.round(num('gOffX', m.offX)); m.offY = Math.round(num('gOffY', m.offY));
    if ((src === 'gCols' || src === 'gRows')) {
      $('gAuto').checked = false;
      M().resize(m, Math.round(num('gCols', m.cols)), Math.round(num('gRows', m.rows)));
    } else if ($('gAuto').checked) {
      var sz = M().autoSize(m.imgW, m.imgH, m.ppg, m.offX, m.offY); M().resize(m, sz.cols, sz.rows);
    }
    syncPanel(); requestDraw();
  }
  function applyGrid(g) {
    var m = E.model;
    m.ppg = g.ppg; if (g.offX !== undefined) m.offX = g.offX; if (g.offY !== undefined) m.offY = g.offY;
    if ($('gAuto').checked) { var sz = M().autoSize(m.imgW, m.imgH, m.ppg, m.offX, m.offY); M().resize(m, sz.cols, sz.rows); }
    syncPanel(); requestDraw();
  }
  function startBox() {
    var m = E.model;
    E.spanMode = false; E.span = null;
    E.boxMode = !E.boxMode;
    if (E.boxMode) {
      var c = E.view.toImg(E.view.w / 2, E.view.h / 2);
      E.box = { x: Math.round(c.x - m.ppg / 2), y: Math.round(c.y - m.ppg / 2), w: m.ppg, h: m.ppg };
      applyBox();
    }
    syncPanel(); requestDraw();
  }
  function applyBox() { applyGrid(M().gridFromBox(E.box)); }
  function startSpan() { E.boxMode = false; E.spanMode = !E.spanMode; E.span = []; syncPanel(); requestDraw(); }

  // ------------------------------------------------------------------ рисование местности / высот
  function keyFn() {
    var m = E.model;
    return E.tool === 'terrain' ? function (x, y) { return M().kindOf(m, x, y); } : function (x, y) { return +m.layers.elevation_ft[y][x] || 0; };
  }
  function applyCells(cells) {
    var m = E.model;
    if (E.tool === 'terrain') cells.forEach(function (c) { M().setKind(m, c.x, c.y, E.kind); });
    else {
      var v = parseFloat($('eVal').value) || 0, add = document.querySelector('input[name=eMode]:checked').value === 'add';
      cells.forEach(function (c) { M().setElev(m, c.x, c.y, add ? (+m.layers.elevation_ft[c.y][c.x] || 0) + v : v); });
    }
  }
  function paintAt(cell) {
    var cells = M().brushCells(E.model, cell.x, cell.y, E.size).filter(function (c) {
      var k = c.x + ',' + c.y; if (E.drag.done[k]) return false; E.drag.done[k] = 1; return true;
    });
    applyCells(cells);
  }
  function hoverCells(c) {
    var m = E.model, x = Math.floor(c.fx), y = Math.floor(c.fy);
    if (E.shape === 'brush') return M().brushCells(m, x, y, E.size);
    return M().inb(m, x, y) ? [{ x: x, y: y }] : [];
  }

  // ------------------------------------------------------------------ указатель
  function finishWall() {
    if (E.wallPts && E.wallPts.length >= 2) { if (M().addWall(E.model, E.wallPts) >= 0) commit(); }
    E.wallPts = null; E.pv = {}; requestDraw();
  }
  function onDown(e) {
    var m = E.model; if (!m) return;
    var sp = pointerPos(e);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && E.space)) { E.pan = { x: e.clientX, y: e.clientY }; try { $('edCanvas').setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } return; }
    if (e.button !== 0) return;
    try { $('edCanvas').setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
    var c = toCell(sp.x, sp.y), t = E.tool;
    if (t === 'grid') {
      if (E.spanMode) {
        E.span = E.span || []; E.span.push({ x: c.px, y: c.py });
        if (E.span.length === 2) {
          var pts = E.span.slice(); E.span = null; E.spanMode = false;
          VTT.ui.prompt({ title: tr('editor.grid.span.title'), text: tr('editor.grid.span.ask'), value: '5' }).then(function (v) {
            var n = parseInt(v, 10);
            if (!(n >= 1)) { syncPanel(); requestDraw(); return; }
            var g = M().gridFromSpan(pts[0].x, pts[1].x, n); applyGrid({ ppg: g.ppg, offX: g.offX }); commit();
          });
        }
        requestDraw(); return;
      }
      if (E.boxMode && E.box) {
        var b = E.box, r = 10 / E.view.z, corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
        for (var i = 0; i < 4; i++) {
          if (Math.abs(corners[i][0] - c.px) < r && Math.abs(corners[i][1] - c.py) < r) { E.drag = { t: 'corner', fx: corners[3 - i][0], fy: corners[3 - i][1] }; return; }
        }
        if (c.px >= b.x && c.px <= b.x + b.w && c.py >= b.y && c.py <= b.y + b.h) { E.drag = { t: 'boxmove', dx: c.px - b.x, dy: c.py - b.y }; return; }
      }
      E.pan = { x: e.clientX, y: e.clientY };
    } else if (t === 'select') {
      var h = M().hit(m, c.fx, c.fy, tolCells());
      E.sel = h; syncSelection();
      if (h && h.kind === 'point') E.drag = { t: 'pt', wi: h.wi, pi: h.pi, moved: false };
    } else if (t === 'wall') {
      var p = snap(c, e);
      E.wallPts = E.wallPts || []; E.wallPts.push(p);
    } else if (t === 'door') {
      for (var di = 0; di < m.doors.length; di++) {
        var s = M().doorSeg(m.doors[di]);
        if (VTT.geometry.distToSegment(c.fx, c.fy, s) < 0.3) { M().removeDoor(m, di, true); E.pv = {}; commit(); return; }
      }
      var d = e.shiftKey && E.doorAnchor ? M().doorSpan(m, E.doorAnchor.x, E.doorAnchor.y, c.fx, c.fy) : M().doorAt(m, c.fx, c.fy);
      if (!d) { toast(tr('editor.door.needWall'), 4000); return; }
      E.doorAnchor = { x: c.fx, y: c.fy };
      if (e.shiftKey && M().doorSpanLen(d) > 1) { d.open = E.doorOpen; M().addDoor(m, d); E.pv = {}; commit(); return; }
      E.drag = { t: 'door', ax: c.fx, ay: c.fy };
    } else if (t === 'terrain' || t === 'elev') {
      var cell = { x: Math.floor(c.fx), y: Math.floor(c.fy) };
      if (E.shape === 'brush') { E.drag = { t: 'paint', done: {} }; paintAt(cell); }
      else if (E.shape === 'rect') E.drag = { t: 'rect', x0: cell.x, y0: cell.y };
      else {
        applyCells(M().floodCells(m, cell.x, cell.y, keyFn(), E.fillWalls)); commit();
      }
    }
    requestDraw();
  }
  function onMove(e) {
    var m = E.model; if (!m) return;
    if (E.pan) { E.view.pan(e.clientX - E.pan.x, e.clientY - E.pan.y); E.pan = { x: e.clientX, y: e.clientY }; requestDraw(); return; }
    var sp = pointerPos(e), c = toCell(sp.x, sp.y), t = E.tool, d = E.drag;
    var x = Math.floor(c.fx), y = Math.floor(c.fy);
    $('stCell').textContent = M().inb(m, x, y)
      ? VTT.geometry.cellName(x, y) + ' · ' + tr('editor.kind.' + M().kindOf(m, x, y)) + ' · ' + (m.layers.elevation_ft[y][x] || 0) + ' ' + tr('editor.unit.ft') : '';
    if (d && d.t === 'corner') { E.box = { x: Math.min(d.fx, c.px), y: Math.min(d.fy, c.py), w: Math.abs(c.px - d.fx), h: Math.abs(c.py - d.fy) }; applyBox(); }
    else if (d && d.t === 'boxmove') { E.box.x = c.px - d.dx; E.box.y = c.py - d.dy; applyBox(); }
    else if (d && d.t === 'pt') { var p = snap(c, e); M().movePoint(m, d.wi, d.pi, p.x, p.y); d.moved = true; syncSelection(); }
    else if (d && d.t === 'door') { E.pv.door = M().doorSpan(m, d.ax, d.ay, c.fx, c.fy) || M().doorAt(m, d.ax, d.ay); }
    else if (d && d.t === 'paint') { paintAt({ x: x, y: y }); }
    else if (d && d.t === 'rect') { E.pv.cells = M().rectCells(m, d.x0, d.y0, x, y); }
    else if (t === 'wall') {
      var sn = snap(c, e); E.pv.snap = sn; E.pv.wall = E.wallPts ? E.wallPts.concat([sn]) : null;
    } else if (t === 'door') { E.pv.door = (e.shiftKey && E.doorAnchor && M().doorSpan(m, E.doorAnchor.x, E.doorAnchor.y, c.fx, c.fy)) || M().doorAt(m, c.fx, c.fy); }
    else if (t === 'terrain' || t === 'elev') { E.pv.cells = hoverCells(c); }
    requestDraw();
  }
  function onUp(e) {
    var m = E.model;
    if (E.pan) { E.pan = null; return; }
    var d = E.drag; E.drag = null;
    if (!m || !d) return;
    if (d.t === 'door') {
      var dp = pointerPos(e), dc = toCell(dp.x, dp.y), nd = M().doorSpan(m, d.ax, d.ay, dc.fx, dc.fy) || M().doorAt(m, d.ax, d.ay);
      E.pv.door = null;
      if (nd) { nd.open = E.doorOpen; M().addDoor(m, nd); commit(); }
    } else if (d.t === 'rect') {
      var sp = pointerPos(e), c = toCell(sp.x, sp.y);
      applyCells(M().rectCells(m, d.x0, d.y0, Math.floor(c.fx), Math.floor(c.fy))); E.pv.cells = null; commit();
    } else if (d.t === 'paint' || (d.t === 'pt' && d.moved) || d.t === 'corner' || d.t === 'boxmove') commit();
    requestDraw();
  }
  function onDbl(e) {
    var m = E.model; if (!m) return;
    if (E.tool === 'wall') { finishWall(); return; }
    if (E.tool === 'select') {
      var sp = pointerPos(e), c = toCell(sp.x, sp.y), h = M().hit(m, c.fx, c.fy, tolCells());
      if (h && h.kind === 'seg') { var p = snap(c, e); M().insertPoint(m, h.wi, h.si, p.x, p.y); E.sel = { kind: 'point', wi: h.wi, pi: h.si + 1 }; commit(); }
    }
  }

  function deleteSelection(whole) {
    var s = E.sel, m = E.model; if (!s || !m) return;
    if (s.kind === 'point') { if (whole) M().deleteWall(m, s.wi); else M().deletePoint(m, s.wi, s.pi); }
    else if (s.kind === 'seg') { if (whole) M().deleteWall(m, s.wi); else M().deleteSegment(m, s.wi, s.si); }
    else if (s.kind === 'door') M().removeDoor(m, s.di, true);
    E.sel = null; commit();
  }

  // ------------------------------------------------------------------ клавиши
  function onKey(e) {
    if (modalOpen()) return;
    var ctrl = e.ctrlKey || e.metaKey, k = e.key;
    if (ctrl && (k === 'z' || k === 'Z' || k === 'я' || k === 'Я')) { e.preventDefault(); undoRedo(e.shiftKey); return; }
    if (ctrl && (k === 'y' || k === 'Y' || k === 'н' || k === 'Н')) { e.preventDefault(); undoRedo(true); return; }
    if (ctrl && (k === 's' || k === 'S' || k === 'ы' || k === 'Ы')) { e.preventDefault(); save(); return; }
    if (inputFocused() || !E.model) return;
    if (k === ' ') { E.space = true; e.preventDefault(); return; }
    if (k === 'Enter' && E.tool === 'wall') { finishWall(); return; }
    if (k === 'Escape') { E.wallPts = null; E.pv = {}; E.boxMode = false; E.spanMode = false; E.span = null; E.sel = null; syncPanel(); requestDraw(); return; }
    if (k === 'Backspace' && E.tool === 'wall' && E.wallPts) { E.wallPts.pop(); if (!E.wallPts.length) E.wallPts = null; E.pv.wall = null; requestDraw(); return; }
    if ((k === 'Delete' || k === 'Backspace') && E.tool === 'select') { e.preventDefault(); deleteSelection(e.shiftKey); return; }
    if (E.tool === 'grid' && k.indexOf('Arrow') === 0) {
      e.preventDefault();
      var st = e.shiftKey ? 10 : 1, dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
      var m = E.model;
      if (ctrl) applyGrid({ ppg: Math.max(1, m.ppg + dx - dy) }); else applyGrid({ ppg: m.ppg, offX: m.offX + dx, offY: m.offY + dy });
      commitSoon(); return;
    }
    var map = { g: 'grid', v: 'select', w: 'wall', d: 'door', t: 'terrain', h: 'elev' };
    if (!ctrl && map[k.toLowerCase()]) setTool(map[k.toLowerCase()]);
  }

  // ------------------------------------------------------------------ сборка UI
  function buildStatic() {
    var kinds = $('tKinds');
    M().KINDS.forEach(function (k) {
      var b = document.createElement('button'); b.setAttribute('data-kind', k);
      var sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = k === 'normal' ? '#fff3' : VTT.editorView.KIND_COLOR[k];
      var tx = document.createElement('span'); tx.textContent = tr('editor.kind.' + k);
      b.appendChild(sw); b.appendChild(tx);
      b.onclick = function () { E.kind = k; syncPanel(); };
      kinds.appendChild(b);
    });
    var lg = $('legend');
    function row(color, text) {
      var d = document.createElement('div'), sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = color;
      d.appendChild(sw); d.appendChild(document.createTextNode(text)); lg.appendChild(d);
    }
    row('#ff4d4d', tr('editor.legend.wall')); row('#ff9800', tr('editor.legend.doorClosed')); row('#3fb950', tr('editor.legend.doorOpen'));
    M().KINDS.filter(function (k) { return k !== 'normal'; }).forEach(function (k) { row(VTT.editorView.KIND_COLOR[k], tr('editor.kind.' + k)); });
    row(VTT.editorView.elevColor(30, 1), tr('editor.legend.elevUp')); row(VTT.editorView.elevColor(-30, 1), tr('editor.legend.elevDown'));
  }
  function bindUI() {
    $('edNew').onclick = newFromImage; $('stNew').onclick = newFromImage;
    $('edOpen').onclick = async function () { if (await confirmDiscard()) showStart(); };
    $('edSave').onclick = save; $('edBattle').onclick = battle; $('edCheck').onclick = check;
    $('edUndo').onclick = function () { undoRedo(false); }; $('edRedo').onclick = function () { undoRedo(true); };
    $('edFit').onclick = function () { if (E.model) { E.view.fit(E.model.imgW, E.model.imgH); requestDraw(); } };
    Array.prototype.forEach.call(document.querySelectorAll('#edLayers input'), function (i) {
      i.onchange = function () { E.vis[i.getAttribute('data-layer')] = i.checked; requestDraw(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.etool'), function (b) { b.onclick = function () { if (E.model) setTool(b.getAttribute('data-tool')); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.shp'), function (b) { b.onclick = function () { E.shape = b.getAttribute('data-shape'); syncPanel(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.siz'), function (b) { b.onclick = function () { E.size = +b.getAttribute('data-size'); syncPanel(); }; });
    $('fWalls').onchange = function () { E.fillWalls = $('fWalls').checked; };
    $('dOpen').onchange = function () { E.doorOpen = $('dOpen').checked; };
    ['gPpg', 'gFeet', 'gOffX', 'gOffY', 'gCols', 'gRows'].forEach(function (id) {
      $(id).oninput = function () { applyGridValues(id); };
      $(id).onchange = function () { applyGridValues(id); commit(); };
    });
    $('gAuto').onchange = function () { applyGridValues('gAuto'); commit(); };
    $('gBox').onclick = startBox; $('gSpan').onclick = startSpan;
    $('fTitle').oninput = function () { if (E.model) { E.model.title = $('fTitle').value; updateDirty(); } };
    $('fTitle').onchange = function () { commit(); };
    $('sOpen').onchange = function () {
      var s = E.sel; if (s && s.kind === 'door' && E.model.doors[s.di]) { E.model.doors[s.di].open = $('sOpen').checked; commit(); }
    };
    $('sDel').onclick = function () { deleteSelection(false); };
    $('sDoorWall').onclick = function () { deleteSelection(false); };
    $('sDoorGap').onclick = function () { var s = E.sel; if (s && s.kind === 'door') { M().removeDoor(E.model, s.di, false); E.sel = null; commit(); } };
    $('wFinish').onclick = finishWall; $('wCancel').onclick = function () { E.wallPts = null; E.pv = {}; requestDraw(); };

    var cv = $('edCanvas');
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('dblclick', onDbl);
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('pointerleave', function () { E.pv.cells = E.drag ? E.pv.cells : null; E.pv.door = null; E.pv.snap = null; requestDraw(); });
    cv.addEventListener('wheel', function (e) {
      if (!E.model) return;
      e.preventDefault(); var p = pointerPos(e); E.view.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); requestDraw();
    }, { passive: false });
    var rz = $('edResize');
    function setSide(w) {
      w = Math.max(240, Math.min(Math.round(w), Math.max(240, window.innerWidth - 360)));
      $('ed').style.setProperty('--ed-side', w + 'px'); return w;
    }
    try { var sw = parseInt(localStorage.getItem('ed-side'), 10); if (sw > 0) setSide(sw); } catch (_) { /* ignore */ }
    rz.addEventListener('pointerdown', function (e) { rz.setPointerCapture(e.pointerId); rz.classList.add('drag'); rz._on = true; });
    rz.addEventListener('pointermove', function (e) { if (rz._on) { setSide(window.innerWidth - e.clientX); E.view.resize(); requestDraw(); } });
    rz.addEventListener('pointerup', function (e) {
      if (!rz._on) return; rz._on = false; rz.classList.remove('drag');
      try { localStorage.setItem('ed-side', String(setSide(window.innerWidth - e.clientX))); } catch (_) { /* ignore */ }
      E.view.resize(); requestDraw();
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', function (e) { if (e.key === ' ') E.space = false; });
    window.addEventListener('blur', function () { E.space = false; });
    window.addEventListener('resize', function () { E.view.resize(); requestDraw(); });
    H().editor.onConfirmClose(async function () {
      var ok = await VTT.ui.confirm({ title: tr('editor.discard.title'), text: tr('editor.discard.text'), ok: tr('editor.discard.ok'), danger: true });
      if (ok) H().editor.forceClose();
    });
    H().editor.onRequest(handleRequest);
    // смена языка: несохранённое уходит в черновик (предложат восстановить), страница перезагружается с новым <html lang>
    H().editor.onLangChanged(async function () {
      clearTimeout(draftTimer);
      if (isDirty()) await writeDraft();
      location.reload();
    });
  }

  async function handleRequest(req) {
    if (!req) return;
    if (req.mapRel) await openWithConfirm(req.mapRel);
    else if (req.newFromImage) await newFromImage();
  }

  // восстановление черновика: предлагается, если он относится к запрошенной карте (или запроса нет)
  async function offerDraft(req) {
    var d = null;
    try { if (await H().fs.exists('data', DRAFT)) d = JSON.parse(await H().fs.readText('data', DRAFT)); } catch (e) { d = null; }
    if (!d || !d.meta || !d.entryRel || !d.imgRel) return false;
    if (req && req.mapRel && req.mapRel !== d.entryRel) return false;
    if (req && req.newFromImage) return false;
    var ok = await VTT.ui.confirm({ title: tr('editor.draft.title'), text: tr('editor.draft.text', { name: d.entryRel }), ok: tr('editor.draft.restore'), cancel: tr('editor.draft.drop') });
    if (!ok) { await clearDraft(); return false; }
    try {
      var img = await VTT.store._loadImage(H().fs.url(d.imgRoot || 'maps', d.imgRel));
      var model = M().fromMeta(d.meta, { width: img.naturalWidth, height: img.naturalHeight });
      model.image = fileOf(d.imgRel);
      loadModel(model, img, { entryRel: d.entryRel, imgRel: d.imgRel, imgRoot: d.imgRoot, isNew: !!d.isNew, dirty: true, auto: !!d.auto });
      return true;
    } catch (e) { toast(errText(e), 4000); return false; }
  }

  async function init() {
    VTT.i18n.apply();
    E.view = VTT.editorView.create($('edCanvas'));
    E.view.resize();
    buildStatic(); bindUI(); syncPanel(); updateDirty();
    var req = null;
    try { req = await H().editor.takeRequest(); } catch (e) { req = null; }
    if (await offerDraft(req)) return;
    if (req && req.mapRel) await openEntry(req.mapRel);
    else if (req && req.newFromImage) await newFromImage();
    if (!E.model) showStart();
  }

  VTT.editor = {
    init: init,
    _state: E,
    _api: { cellToClient: cellToClient, setTool: setTool, save: save, openEntry: openEntry, commit: commit, undoRedo: undoRedo, validate: function () { return M().validate(E.model); } }
  };
})();
