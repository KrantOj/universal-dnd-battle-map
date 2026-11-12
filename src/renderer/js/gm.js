/* VTT.gm — интерфейс мастера */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;
  var G = function () { return VTT.geometry; };
  var M = function () { return VTT.movement; };
  function $(id) { return document.getElementById(id); }

  var KIND_FILL = { pc: '#238636', ally: '#1f6feb', enemy: '#da3633', neutral: '#9e6a03' };
  var STATUS_NAMES = { ok: tr('token.status.ok'), unconscious: tr('token.status.unconscious'), incapacitated: tr('token.status.incapacitated'), dead: tr('token.status.dead') };
  var KIND_NAMES = { pc: tr('token.kind.pc'), ally: tr('token.kind.ally'), enemy: tr('token.kind.enemy'), neutral: tr('token.kind.neutral') };
  var STATUS_SYM = { ok: '', unconscious: 'z', incapacitated: '!', dead: '✕' };

  var S = {
    map: null, scene: null, r: null,
    tool: 'select', brush: 1, sel: null,
    lib: [], undo: [], pending: null, drag: null, rect: null, painting: null,
    segs: null, camp: null, entries: [], hover: null, space: false,
    pan: null, party: false, sentImages: {}, sentView: null,
    saveTimer: null, editing: null, lastMapName: null, curEntry: null,
    libTimer: null, libCollapsed: {}, libQuery: '', libSearchTimer: null
  };

  // ------------------------------------------------------------------ утилиты
  function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2500);
  }
  function setMsg(s) { $('stMsg').textContent = s || ''; }
  function defaults() {
    return { diagonal: '5', autoReveal: true, gridGM: false, gridPlayer: false, playerView: 'fit-map', rulerToPlayers: true, labelsGM: true, labelsPlayer: true, showQueue: false };
  }
  function newScene(map) {
    return {
      version: 1, map: map.name, tokens: [],
      fog: new Array(map.cols * map.rows + 1).join('1'),
      doors: (map.meta.portals || []).map(function (p) { return !!(p && p.open); }),
      round: 1, settings: defaults()
    };
  }
  function normalizeScene(sc, map) {
    var n = map.cols * map.rows;
    if (typeof sc.fog !== 'string' || sc.fog.length !== n) sc.fog = new Array(n + 1).join('1');
    var np = (map.meta.portals || []).length;
    sc.doors = (sc.doors || []).slice(0, np);
    while (sc.doors.length < np) sc.doors.push(!!(map.meta.portals[sc.doors.length] || {}).open);
    sc.settings = Object.assign(defaults(), sc.settings || {});
    if (typeof sc.settings.labelsGM !== 'boolean') sc.settings.labelsGM = true;
    if (typeof sc.settings.labelsPlayer !== 'boolean') sc.settings.labelsPlayer = true;
    sc.round = sc.round || 1;
    sc.map = map.name;
    sc.version = 1;
    sc.tokens = (sc.tokens || []).map(function (t) {
      return Object.assign({ size: 1, speed: 30, vision: 60, status: 'ok', hidden: false, image: null, moved: 0, kind: 'neutral', color: '#555', label: '' }, t);
    });
    return sc;
  }
  function initials(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return w.map(function (x) { return x[0]; }).join('').slice(0, 3).toUpperCase();
  }
  function baseOf(name) { return String(name).replace(/\s+\d+$/, ''); }
  function nameExists(n) { return S.scene.tokens.some(function (t) { return t.name === n; }); }
  function nextName(base) {
    var n = 2; while (nameExists(base + ' ' + n)) n++;
    return { name: base + ' ' + n, n: n };
  }
  function getToken(id) { return S.scene && S.scene.tokens.filter(function (t) { return t.id === id; })[0] || null; }
  function selToken() { return S.sel ? getToken(S.sel) : null; }
  function inputFocused() {
    var a = document.activeElement;
    return a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
  }
  function modalOpen() {
    return !$('tokenDlg').hidden || !$('help').hidden || !$('picker').hidden || !$('settingsDlg').hidden || !!document.querySelector('.cu-overlay');
  }

  function segs() {
    if (!S.segs) S.segs = G().blockingSegments(S.map.geo, S.scene.doors);
    return S.segs;
  }

  // ------------------------------------------------------------------ изменения / синхронизация / сохранение
  function changed(o) {
    o = o || {};
    S.r.requestDraw();
    scheduleSave();
    VTT.sync.queueState(pushState);
    if (!o.noList) renderList();
    $('roundNum').textContent = S.scene.round;
  }
  function scheduleSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(function () {
      if (S.scene) VTT.store.saveScene(S.scene).catch(function (e) { console.warn('save', e); });
    }, 500);
  }
  function pushMap() {
    if (!S.map || !VTT.sync.isOpen()) return;
    S.sentImages = {};
    VTT.sync.send({ t: 'map', name: S.map.name, cols: S.map.cols, rows: S.map.rows, ppg: S.map.ppg, image: S.map.imageURL,
      imageGrid: S.map.imageGrid, labels: S.map.labels || [], geoDoors: S.map.geo.doors });
    pushState();
  }
  function pushState() {
    if (!S.scene || !VTT.sync.isOpen()) return;
    var sc = S.scene, imgs = {}, any = false, vis = [];
    sc.tokens.forEach(function (t) {
      if (t.hidden) { delete S.sentImages[t.id]; return; }
      // токен целиком в тумане игрокам не отправляем вовсе (не только не рисуем)
      if (footprint(t).every(function (i) { return sc.fog.charAt(i) === '1'; })) return;
      var c = Object.assign({}, t); delete c.image; c.hasImage = !!t.image;
      // инициатива и здоровье врагов — только мастеру; у партии и союзников игрокам уходит полоска HP
      delete c.init; delete c.initMod;
      if (t.kind !== 'pc' && t.kind !== 'ally') { delete c.hp; delete c.maxHp; delete c.ac; }
      vis.push(c);
      if (t.image) {
        var k = VTT.tokensDraw.imgKey(t);
        if (S.sentImages[t.id] !== k) { S.sentImages[t.id] = k; imgs[t.id] = t.image; any = true; }
      }
    });
    if (any) VTT.sync.send({ t: 'images', images: imgs });
    var visIds = {}; vis.forEach(function (c) { visIds[c.id] = true; });
    var queue = VTT.combat ? VTT.combat.queueFor(visIds) : null;
    var mode = sc.settings.playerView;
    if (mode === 'gm' && !S.sentView) S.sentView = S.r.getView();
    VTT.sync.send({
      t: 'state', tokens: vis, fog: sc.fog, doors: sc.doors, settings: sc.settings,
      view: mode === 'gm' ? S.sentView : S.r.getView(), round: sc.round,
      turnId: sc.combat && sc.combat.active ? sc.combat.turnId : null,
      queue: queue
    });
  }

  // ------------------------------------------------------------------ карта
  async function openMap(map) {
    S.map = map;
    var sc = null;
    try { sc = await VTT.store.loadScene(map.name); } catch (e) { console.warn(e); }
    sc = sc ? normalizeScene(sc, map) : newScene(map);
    S.scene = sc; S.segs = null; S.undo = []; S.sel = null; S.pending = null; S.drag = null; S.sentView = null;
    S.r.setMap(map); S.r.setScene(sc); S.r.selectedId = null; S.r.ruler = null;
    S.r.fit();
    hideReloadBar();
    $('picker').hidden = true;
    syncSettingsUI();
    $('roundNum').textContent = sc.round;
    renderList();
    pushMap();
    if (map.warning) VTT.ui.alert({ title: tr('common.attention'), text: map.warning });
    S.lastMapName = map.name;
    try { VTT.store.setKV('lastMap', map.name).catch(function () {}); } catch (e) {}
    setMsg(tr('gm.map.status', { name: map.title || map.name, cols: map.cols, rows: map.rows }));
  }
  function openEntry(en) {
    $('pickerMsg').textContent = '';
    return VTT.store.loadMapFromEntry(en).then(function (map) { S.curEntry = en; return openMap(map); }).catch(function (e) {
      $('pickerMsg').textContent = tr('gm.err.load', { msg: e.message || e });
    });
  }

  // ------------------------------------------------------------------ выбор карты / папка карт / импорт
  var refreshSeq = 0;
  function mapsRoot() { return S.camp && S.camp.folders ? S.camp.folders.maps : null; }

  async function refreshMaps(quiet) {
    var list = $('mapList'), hasRoot = !!mapsRoot();
    $('btnPickDir').hidden = hasRoot;
    $('btnImportMap').hidden = false;
    $('dirName').textContent = hasRoot ? tr('picker.dirName', { dir: mapsRoot() }) : '';
    if (!quiet) { list.textContent = ''; S.entries = []; }
    if (!hasRoot) { list.textContent = tr('picker.noDir'); S.entries = []; return []; }
    if (!quiet) list.textContent = tr('picker.reading');
    var mySeq = ++refreshSeq;
    try {
      var found = await VTT.store.listMaps();
      if (mySeq !== refreshSeq) return found;       // пришёл более новый запрос
      S.entries = found;
    } catch (e) {
      list.textContent = '';
      if (!VTT.store.isRootUnset(e)) $('pickerMsg').textContent = tr('picker.err.read', { msg: e.message });
      return [];
    }
    list.textContent = '';
    if (!S.entries.length) list.textContent = tr('picker.empty');
    S.entries.forEach(function (en) {
      var b = document.createElement('button');
      b.textContent = '🗺 ' + en.name + (en.name === S.lastMapName ? tr('picker.last') : '');
      b.onclick = function () { openEntry(en); };
      list.appendChild(b);
    });
    return S.entries;
  }

  async function pickMapsDir() {
    try {
      var dir = await window.host.dialog.pickFolder({ title: tr('folder.maps.pickTitle') });
      if (!dir || !S.camp) return;
      var c = await window.host.campaigns.update(S.camp.id, { folders: { maps: dir } });
      if (c) S.camp = c;
      await refreshMaps();
      reloadLibrary();
    } catch (e) { $('pickerMsg').textContent = e.message || String(e); }
  }

  // импорт: пути файлов (*.map.json + png) -> копия в maps -> открыть
  async function importMapPaths(paths) {
    $('pickerMsg').textContent = '';
    try {
      if (!mapsRoot()) {
        var ok = await VTT.ui.confirm({ title: tr('gm.confirm.noMapsDir.title'), text: tr('gm.confirm.noMapsDir.text'), ok: tr('common.pickFolder'), cancel: tr('common.cancel') });
        if (!ok) return;
        await pickMapsDir();
        if (!mapsRoot()) return;
      }
      var en = await VTT.store.importMapFiles(paths, async function (imgName) {
        var ok2 = await VTT.ui.confirm({ title: tr('gm.imgMissing.title'), text: tr('gm.imgMissing.text', { name: imgName }), ok: tr('gm.imgMissing.ok'), cancel: tr('gm.imgMissing.skip') });
        if (!ok2) return [];
        return window.host.dialog.pickFiles({ title: tr('gm.import.image.title'), filters: [{ name: tr('gm.import.images.filter'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }], multi: false });
      });
      await refreshMaps();
      await openEntry(en);
      toast(tr('gm.toast.mapImported', { name: en.name }));
    } catch (e) {
      $('pickerMsg').textContent = e.message || String(e);
      toast(e.message || String(e), 4000);
    }
  }
  async function importMapDialog() {
    var paths = await window.host.dialog.pickFiles({
      title: tr('gm.import.map.title'),
      filters: [{ name: tr('gm.import.map.filter'), extensions: ['json', 'png', 'jpg', 'jpeg', 'webp'] }], multi: true
    });
    if (paths && paths.length) await importMapPaths(paths);
  }

  async function initPicker() {
    try { S.lastMapName = (await VTT.store.getKV('lastMap')) || null; } catch (e) {}
    var es = await refreshMaps();
    var last = es.filter(function (e) { return e.name === S.lastMapName; })[0];
    if (last && !S.map) openEntry(last);
  }

  // ------------------------------------------------------------------ токены: геометрия
  function footprint(t) {
    var out = [], size = t.size || 1;
    for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) out.push((t.y + yy) * S.map.cols + t.x + xx);
    return out;
  }
  function occupiedSet(exceptId) {
    var s = new Set();
    S.scene.tokens.forEach(function (t) {
      if (t.id === exceptId || t.status === 'dead') return;
      footprint(t).forEach(function (i) { s.add(i); });
    });
    return s;
  }
  function pathOpts(t, free) {
    return { diagonal: S.scene.settings.diagonal, size: t.size || 1, occupied: occupiedSet(t.id), free: !!free };
  }
  function tokenAtCell(x, y) {
    var best = null, ts = S.scene.tokens;
    for (var i = ts.length - 1; i >= 0; i--) {
      var t = ts[i], s = t.size || 1;
      if (x >= t.x && x < t.x + s && y >= t.y && y < t.y + s) {
        if (t.status !== 'dead') return t;
        if (!best) best = t;
      }
    }
    return best;
  }
  function clampPos(x, y, size) {
    return { x: Math.max(0, Math.min(S.map.cols - size, x)), y: Math.max(0, Math.min(S.map.rows - size, y)) };
  }

  // ------------------------------------------------------------------ туман
  function setFog(idxs, val) {
    var a = S.scene.fog.split(''), ch = false;
    for (var i = 0; i < idxs.length; i++) {
      var k = idxs[i];
      if (k >= 0 && k < a.length && a[k] !== val) { a[k] = val; ch = true; }
    }
    if (ch) S.scene.fog = a.join('');
    return ch;
  }
  function paintBrush(cx, cy, val) {
    var n = S.brush, half = Math.floor(n / 2), idx = [];
    for (var y = cy - half; y < cy - half + n; y++) for (var x = cx - half; x < cx - half + n; x++) {
      if (x >= 0 && y >= 0 && x < S.map.cols && y < S.map.rows) idx.push(y * S.map.cols + x);
    }
    return setFog(idx, val);
  }
  function autoReveal(t, force) {
    var st = S.scene.settings;
    if ((!st.autoReveal && !force) || (t.kind !== 'pc' && t.kind !== 'ally')) return false;
    if (t.status === 'dead' || t.status === 'unconscious') return false;
    var size = t.size || 1, off = (size - 1) / 2;
    var rad = (t.vision || 0) / (S.map.feet || 5) + off;
    var cells = G().visibleCells(S.map, segs(), t.x + off, t.y + off, rad);
    var idx = Array.prototype.slice.call(cells);
    // клетки под самим токеном всегда открыты
    footprint(t).forEach(function (i) { idx.push(i); });
    return setFog(idx, '0');
  }
  function revealPlayers() {
    if (!S.map) return;
    var ch = false, n = 0;
    S.scene.tokens.forEach(function (t) {
      if ((t.kind !== 'pc' && t.kind !== 'ally') || t.status === 'dead' || t.status === 'unconscious') return;
      n++; if (autoReveal(t, true)) ch = true;
    });
    if (ch) changed({ noList: true }); else S.r.requestDraw();
    toast(n ? (ch ? tr('gm.toast.revealed') : tr('gm.toast.noNewCells')) : tr('gm.toast.noParty'));
  }
  function autoRevealAll() { S.scene.tokens.forEach(autoReveal); }

  // ------------------------------------------------------------------ перемещение
  function commitMove(t, tx, ty, res, free) {
    S.undo.push({ id: t.id, x: t.x, y: t.y, moved: t.moved });
    if (S.undo.length > 50) S.undo.shift();
    t.x = tx; t.y = ty;
    if (!free && isFinite(res.feet)) t.moved = (t.moved || 0) + res.feet;
    autoReveal(t);
    changed();
  }
  function undo() {
    var u = S.undo.pop();
    if (!u) { toast(tr('gm.toast.nothingToUndo')); return; }
    var t = getToken(u.id);
    if (!t) return;
    t.x = u.x; t.y = u.y; t.moved = u.moved;
    changed();
    toast(tr('gm.toast.moveUndone'));
  }
  function stepSelected(dx, dy, free) {
    var t = selToken(); if (!t) return;
    var p = clampPos(t.x + dx, t.y + dy, t.size || 1);
    if (p.x === t.x && p.y === t.y) return;
    var res = M().findPath(S.map, segs(), { x: t.x, y: t.y }, p, pathOpts(t, free));
    if (!res.ok) { toast(tr('gm.toast.cantGo')); return; }
    commitMove(t, p.x, p.y, res, free);
  }

  function dragTarget(e) {
    var d = S.drag, c = S.r.screenToCell(e.offsetX, e.offsetY), t = getToken(d.id);
    var p = clampPos(Math.round(c.fx - d.ox), Math.round(c.fy - d.oy), t.size || 1);
    return p;
  }
  function updateDrag(e) {
    var d = S.drag, t = getToken(d.id);
    if (!t) { S.drag = null; return; }
    var p = dragTarget(e);
    if (!d.started) {
      if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) < 5 && p.x === t.x && p.y === t.y) return;
      d.started = true; S.r.dragId = t.id;
    }
    var free = e.shiftKey;
    var key = p.x + ',' + p.y + ',' + free;
    d.tx = p.x; d.ty = p.y;
    if (d.key !== key) {
      d.key = key;
      d.res = M().findPath(S.map, segs(), { x: t.x, y: t.y }, p, pathOpts(t, free));
    }
    var res = d.res, rem = Math.max(0, (t.speed || 0) - (t.moved || 0)), color, label;
    if (free) { color = '#8b949e'; label = tr('gm.ruler.free', { feet: Math.round(res.feet) }); }
    else if (!res.ok) { color = '#f85149'; label = tr('gm.ruler.noPath'); }
    else {
      color = res.feet <= rem ? '#3fb950' : (res.feet <= rem + (t.speed || 0) ? '#d29922' : '#f85149');
      label = tr('gm.ruler.cost', { feet: Math.round(res.feet) }) + (res.difficult ? tr('gm.ruler.difficultSuffix') : '');
    }
    S.r.ruler = { path: res.path, label: label, color: color, size: t.size || 1, free: free };
    var dh = (res.elevTo || 0) - (res.elevFrom || 0);
    $('stDrag').textContent = res.ok || free
      ? tr('gm.ruler.pathHeight', { feet: Math.round(res.feet), dh: (dh > 0 ? '+' : '') + dh })
      : tr('gm.ruler.noPath');
    if (!t.hidden && S.scene.settings.rulerToPlayers !== false) VTT.sync.sendRuler(S.r.ruler);
    S.r.requestDraw();
  }
  function endDrag(e, cancel) {
    var d = S.drag; S.drag = null;
    S.r.dragId = null; S.r.ruler = null; $('stDrag').textContent = '';
    VTT.sync.sendRuler(null);
    S.r.requestDraw();
    if (!d || !d.started || cancel) return;
    var t = getToken(d.id); if (!t) return;
    var free = e.shiftKey;
    var p = { x: d.tx, y: d.ty };
    if (p.x === t.x && p.y === t.y) return;
    var res = M().findPath(S.map, segs(), { x: t.x, y: t.y }, p, pathOpts(t, free));
    if (!res.ok) { toast(tr('gm.toast.noPath')); return; }
    commitMove(t, p.x, p.y, res, free);
  }

  // ------------------------------------------------------------------ создание/правка токенов
  function startPlacement(tpl) {
    S.pending = tpl;
    S.r.canvas.style.cursor = 'crosshair';
    setMsg(tr('gm.msg.placeToken', { name: tpl.name }));
    S.r.requestDraw();
  }
  function cancelPlacement() {
    S.party = false; S.pending = null; S.r.canvas.style.cursor = ''; setMsg(''); S.r.requestDraw();
  }
  function tokenFromTpl(tpl, x, y) {
    var t = Object.assign({}, tpl, { id: newId(), moved: 0, status: 'ok' });
    delete t.updated; delete t.init;
    if (t.maxHp > 0) t.hp = t.maxHp; else { delete t.hp; delete t.maxHp; }
    if (!tpl.lid) delete t.lid;
    t.size = t.size || 1;
    var p = clampPos(x, y, t.size);
    t.x = p.x; t.y = p.y;
    if (nameExists(t.name)) {
      var nn = nextName(baseOf(t.name));
      if (t.label === initials(baseOf(t.name))) t.label = (initials(baseOf(t.name)) + nn.n).slice(0, 3);
      t.name = nn.name;
    }
    return t;
  }
  function placeToken(cx, cy) {
    var tpl = S.pending; cancelPlacement();
    var t = tokenFromTpl(tpl, cx, cy);
    S.scene.tokens.push(t);
    S.sel = t.id; S.r.selectedId = t.id;
    autoReveal(t);
    changed();
  }
  function findFree(x0, y0, size, occ, rad0, rad1) {
    for (var rad = rad0; rad <= rad1; rad++) {
      for (var dy = -rad; dy <= rad; dy++) for (var dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        var x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x + size > S.map.cols || y + size > S.map.rows) continue;
        var ok = true;
        for (var j = 0; j < size && ok; j++) for (var i = 0; i < size; i++) {
          if (occ.has((y + j) * S.map.cols + x + i) || M().cellRule(S.map, x + i, y + j).blocked) { ok = false; break; }
        }
        if (ok) return { x: x, y: y };
      }
    }
    return null;
  }
  function findFreeNear(t) {
    return findFree(t.x, t.y, t.size || 1, occupiedSet(null), 1, 8) || { x: t.x, y: t.y };
  }
  function onMapByLid(lid) {
    return lid ? S.scene.tokens.filter(function (t) { return t.lid === lid; })[0] || null : null;
  }
  function startParty() {
    if (!S.map) { toast(tr('common.openMapFirst')); return; }
    if (!S.lib.some(function (l) { return l.kind === 'pc'; })) { toast(tr('gm.toast.noPartyTemplates')); return; }
    cancelPlacement();
    S.party = true; S.r.canvas.style.cursor = 'crosshair';
    setMsg(tr('gm.msg.placeParty'));
  }
  function placeParty(cx, cy) {
    cancelPlacement();
    var occ = occupiedSet(null), skipped = [], failed = [], placed = 0;
    S.lib.filter(function (l) { return l.kind === 'pc'; }).forEach(function (tpl) {
      if (onMapByLid(tpl.lid)) { skipped.push(tpl.name); return; }
      var size = tpl.size || 1;
      var p = findFree(cx, cy, size, occ, 0, 14);
      if (!p) { failed.push(tpl.name); return; }
      var t = tokenFromTpl(tpl, p.x, p.y);
      footprint(t).forEach(function (i) { occ.add(i); });
      S.scene.tokens.push(t); S.sel = t.id; S.r.selectedId = t.id;
      autoReveal(t); placed++;
    });
    changed();
    var msg = tr('gm.party.placed', { n: placed });
    if (skipped.length) msg += tr('gm.party.skipped', { list: skipped.join(', ') });
    if (failed.length) msg += tr('gm.party.failed', { list: failed.join(', ') });
    toast(msg, 4500);
  }
  function duplicate(t) {
    var c = JSON.parse(JSON.stringify(t));
    var base = baseOf(t.name), nn = nextName(base);
    c.id = newId(); c.name = nn.name; c.moved = 0; c.status = 'ok'; delete c.init;
    if (c.maxHp > 0) c.hp = c.maxHp;
    if (t.label === initials(base) || t.label === initials(t.name)) c.label = (initials(base) + nn.n).slice(0, 3);
    var p = findFreeNear(t); c.x = p.x; c.y = p.y;
    S.scene.tokens.push(c);
    S.sel = c.id; S.r.selectedId = c.id;
    changed();
    toast(tr('gm.toast.created', { name: c.name }));
  }
  async function removeToken(t) {
    if (!(await VTT.ui.confirm({ title: tr('gm.confirm.delToken.title'), text: tr('gm.confirm.delToken.text', { name: t.name }), ok: tr('common.delete'), danger: true }))) return;
    if (VTT.blog) VTT.blog.onRemoved(t);
    S.scene.tokens = S.scene.tokens.filter(function (x) { return x.id !== t.id; });
    VTT.tokensDraw.forget(t.id);
    if (S.sel === t.id) { S.sel = null; S.r.selectedId = null; }
    changed();
  }
  function setStatus(t, st) { if (VTT.blog) VTT.blog.onStatus(t, st); t.status = st; if (st === 'ok' || st === 'incapacitated') autoReveal(t); changed(); }
  function toggleHidden(t) { t.hidden = !t.hidden; changed(); }
  function selectToken(id, center) {
    S.sel = id; S.r.selectedId = id;
    if (center) { var t = getToken(id); if (t) S.r.centerOn(t.x + (t.size || 1) / 2, t.y + (t.size || 1) / 2, 300); }
    renderList(); S.r.requestDraw();
  }

  // библиотека
  function toTemplate(t) {
    return { lid: newId(), updated: Date.now(), name: baseOf(t.name), label: t.label, color: t.color, kind: t.kind, size: t.size,
             speed: t.speed, vision: t.vision, image: t.image || null, hidden: false, category: t.category || '',
             maxHp: t.maxHp || 0, ac: t.ac || 0, team: t.team || 0, initMod: t.initMod || 0 };
  }
  function migrateLib(arr) {
    var now = Date.now(), seen = {};
    return (arr || []).filter(function (t) { return t && typeof t === 'object'; }).map(function (t) {
      if (!t.lid || seen[t.lid]) t.lid = newId();
      seen[t.lid] = 1;
      if (!t.updated) t.updated = now;
      delete t.x; delete t.y; delete t.moved; delete t.status;
      return t;
    });
  }
  function libChanged(immediate) {
    renderLib();
    var run = function () {
      VTT.store.saveLibrary(S.lib).catch(function (e) { console.warn('library save', e); });
    };
    clearTimeout(S.libTimer);
    if (immediate) run(); else S.libTimer = setTimeout(run, 500);
  }
  function reloadLibrary() {
    return VTT.store.getLibrary().then(function (l) { S.lib = migrateLib(VTT.store.mergeLibs(S.lib, migrateLib(l))); libChanged(true); })
      .catch(function () { renderLib(); });
  }
  function addToLibrary(t) {
    var tpl = S.lib.filter(function (l) { return l.lid === t.lid; })[0];
    if (tpl) {
      Object.assign(tpl, { name: baseOf(t.name), label: t.label, color: t.color, kind: t.kind, size: t.size,
        speed: t.speed, vision: t.vision, image: t.image || null, maxHp: t.maxHp || 0, ac: t.ac || 0, team: t.team || 0, initMod: t.initMod || 0, updated: Date.now() });
      libChanged();
      toast(tr('gm.toast.templateUpdated'));
    } else {
      tpl = toTemplate(t);
      t.lid = tpl.lid;
      S.lib.push(tpl);
      libChanged();
      scheduleSave();
      toast(tr('gm.toast.addedToLib', { name: baseOf(t.name) }));
    }
  }
  function placeFromLib(tpl) {
    if (!S.map) { toast(tr('common.openMapFirst')); return; }
    var ex = tpl.kind === 'pc' ? onMapByLid(tpl.lid) : null;
    if (ex) { selectToken(ex.id, true); toast(tr('gm.toast.alreadyOnMap', { name: tpl.name })); return; }
    S.party = false;
    startPlacement(Object.assign({}, tpl));
  }

  // ------------------------------------------------------------------ диалог токена
  var dlg = { mode: 'new', token: null, image: null, colorTouched: false, labelTouched: false };
  function drawPreview() {
    var c = $('tfPreview'), x = c.getContext('2d');
    x.clearRect(0, 0, 64, 64);
    x.beginPath(); x.arc(32, 32, 29, 0, 6.2832);
    x.fillStyle = $('tfColor').value; x.fill();
    function rim() {
      x.beginPath(); x.arc(32, 32, 29, 0, 6.2832);
      x.lineWidth = 3; x.strokeStyle = VTT.tokensDraw.KIND_COLOR[$('tfKind').value]; x.stroke();
    }
    if (dlg.image) {
      var im = new Image();
      im.onload = function () {
        x.save(); x.beginPath(); x.arc(32, 32, 29, 0, 6.2832); x.clip(); x.drawImage(im, 3, 3, 58, 58); x.restore(); rim();
      };
      im.src = dlg.image;
    } else {
      x.fillStyle = '#fff'; x.font = 'bold 24px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText($('tfLabel').value, 32, 34);
      rim();
    }
  }
  function openTokenDialog(mode, token) {
    dlg.mode = mode; dlg.token = token || null;
    var t = token || { name: '', label: '', color: KIND_FILL.pc, kind: 'pc', size: 1, speed: 30, vision: 60, image: null, hidden: false };
    $('tokTitle').textContent = mode === 'new' ? tr('tokdlg.titleNew') : tr('tokdlg.titleEdit');
    $('tfOk').textContent = mode === 'new' ? tr('tokdlg.ok.create') : tr('common.save');
    $('tfName').value = t.name; $('tfLabel').value = t.label; $('tfKind').value = t.kind;
    $('tfColor').value = t.color; $('tfSize').value = String(t.size || 1);
    $('tfSpeed').value = t.speed; $('tfVision').value = t.vision; $('tfHidden').checked = !!t.hidden;
    $('tfMaxHp').value = t.maxHp || ''; $('tfAc').value = t.ac || ''; $('tfTeam').value = String(t.team > 0 && t.team <= 4 ? t.team : 0); $('tfInitMod').value = t.initMod || 0;
    $('tfImage').value = ''; dlg.image = t.image || null;
    dlg.colorTouched = mode !== 'new'; dlg.labelTouched = mode !== 'new';
    $('tfLibRow').hidden = mode !== 'new'; $('tfLib').checked = false;
    $('tfCat').value = t.category || ''; $('tfCatRow').hidden = mode === 'edit'; fillCatList();
    if (mode === 'tpl') { $('tokTitle').textContent = tr('tokdlg.titleTpl'); $('tfOk').textContent = tr('common.save'); $('tfHidden').checked = false; }
    $('tokenDlg').hidden = false;
    drawPreview();
    setTimeout(function () { $('tfName').focus(); }, 0);
  }
  function closeTokenDialog() { $('tokenDlg').hidden = true; }
  function processImage(file) {
    return VTT.store._readAsDataURL(file).then(VTT.store._loadImage).then(function (im) {
      var c = document.createElement('canvas'); c.width = c.height = 256;
      var side = Math.min(im.naturalWidth, im.naturalHeight);
      var sx = (im.naturalWidth - side) / 2, sy = (im.naturalHeight - side) / 2;
      c.getContext('2d').drawImage(im, sx, sy, side, side, 0, 0, 256, 256);
      return c.toDataURL('image/png');
    });
  }
  function bindDialog() {
    $('tfKind').onchange = function () {
      if (!dlg.colorTouched) $('tfColor').value = KIND_FILL[$('tfKind').value];
      drawPreview();
    };
    $('tfColor').oninput = function () { dlg.colorTouched = true; drawPreview(); };
    $('tfName').oninput = function () {
      if (!dlg.labelTouched) $('tfLabel').value = initials($('tfName').value);
      drawPreview();
    };
    $('tfLabel').oninput = function () { dlg.labelTouched = true; drawPreview(); };
    $('tfImage').onchange = function () {
      var f = $('tfImage').files[0]; if (!f) return;
      processImage(f).then(function (u) { dlg.image = u; drawPreview(); }).catch(function (e) { toast(e.message); });
    };
    $('tfImgClear').onclick = function () { dlg.image = null; $('tfImage').value = ''; drawPreview(); };
    $('tfCancel').onclick = closeTokenDialog;
    $('tokForm').onsubmit = function (e) {
      e.preventDefault();
      var data = {
        name: $('tfName').value.trim() || tr('token.defaultName'), label: $('tfLabel').value.trim().slice(0, 3),
        kind: $('tfKind').value, color: $('tfColor').value, size: parseInt($('tfSize').value, 10) || 1,
        speed: Math.max(0, parseInt($('tfSpeed').value, 10) || 0), vision: Math.max(0, parseInt($('tfVision').value, 10) || 0),
        image: dlg.image || null, hidden: $('tfHidden').checked,
        maxHp: Math.max(0, parseInt($('tfMaxHp').value, 10) || 0), ac: Math.max(0, parseInt($('tfAc').value, 10) || 0), team: parseInt($('tfTeam').value, 10) || 0, initMod: parseInt($('tfInitMod').value, 10) || 0
      };
      if (dlg.mode !== 'edit') data.category = $('tfCat').value.trim();
      if (!data.label && !data.image) data.label = initials(data.name);
      closeTokenDialog();
      if (dlg.mode === 'new') {
        var pend = data;
        if ($('tfLib').checked) {
          var nt = Object.assign({ lid: newId(), updated: Date.now() }, data, { hidden: false });
          S.lib.push(nt); libChanged();
          pend = Object.assign({}, data, { lid: nt.lid });
        }
        startPlacement(pend);
      } else if (dlg.mode === 'tpl' && dlg.token) {
        Object.assign(dlg.token, data, { hidden: false, updated: Date.now() });
        libChanged();
        toast(tr('gm.toast.templateUpdated'));
      } else if (dlg.token) {
        var t = dlg.token;
        var p = clampPos(t.x, t.y, data.size);
        var oldMax = t.maxHp || 0;
        Object.assign(t, data, { x: p.x, y: p.y });
        if (data.maxHp > 0) t.hp = (t.hp == null || !oldMax) ? data.maxHp : Math.min(t.hp, data.maxHp);
        else { delete t.hp; delete t.maxHp; }
        changed();
      }
    };
  }

  // ------------------------------------------------------------------ правая панель
  function renderList() {
    var box = $('tokList'); box.textContent = '';
    var ts = S.scene ? S.scene.tokens : [];
    $('tokCount').textContent = ts.length ? '(' + ts.length + ')' : '';
    ts.forEach(function (t) {
      var row = document.createElement('div');
      row.className = 'tok k-' + t.kind + (t.id === S.sel ? ' sel' : '') + (t.hidden ? ' hid' : '');
      var l1 = document.createElement('div'); l1.className = 'l1';
      var dot = document.createElement('span'); dot.className = 'dot s-' + t.status; dot.textContent = STATUS_SYM[t.status];
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = t.name; nm.title = t.name;
      var mv = document.createElement('span'); mv.className = 'mv'; mv.textContent = tr('gm.token.moved', { moved: Math.round(t.moved || 0), speed: t.speed });
      l1.appendChild(dot); l1.appendChild(nm); l1.appendChild(mv);
      var l2 = document.createElement('div'); l2.className = 'l2';
      var sel = document.createElement('select');
      Object.keys(STATUS_NAMES).forEach(function (k) {
        var o = document.createElement('option'); o.value = k; o.textContent = STATUS_NAMES[k]; if (k === t.status) o.selected = true; sel.appendChild(o);
      });
      sel.onchange = function () { setStatus(t, sel.value); };
      var eye = document.createElement('button'); eye.textContent = t.hidden ? '🚫' : '👁';
      eye.title = t.hidden ? tr('gm.token.hidden.title') : tr('gm.token.visible.title');
      eye.onclick = function () { toggleHidden(t); };
      var ed = document.createElement('button'); ed.textContent = '✎'; ed.title = tr('common.edit');
      ed.onclick = function () { openTokenDialog('edit', t); };
      l2.appendChild(sel); l2.appendChild(eye); l2.appendChild(ed);
      row.appendChild(l1); row.appendChild(l2);
      row.onclick = function (e) { if (e.target.closest('select,button')) return; selectToken(t.id, true); };
      row.oncontextmenu = function (e) { e.preventDefault(); showTokenMenu(e.clientX, e.clientY, t); };
      box.appendChild(row);
    });
    if (VTT.combat) VTT.combat.render();
  }
  function newRound() {
    S.scene.round++; S.scene.tokens.forEach(function (t) { t.moved = 0; }); S.undo = [];
    if (VTT.blog) VTT.blog.onRound(S.scene.round);
    if (VTT.combat) VTT.combat.onNewRound();
    changed(); toast(tr('gm.toast.round', { n: S.scene.round }));
  }
  // категории: «01 Авантюристы» — сортировка по номеру, показ без номера
  var NO_CAT = tr('lib.noCategory');
  function catTitle(c) { return String(c || '').replace(/^\d+\s+/, '') || NO_CAT; }
  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
  function libCats() {
    var set = {};
    S.lib.forEach(function (l) { if (l.kind !== 'pc' && l.category) set[l.category] = 1; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ru', { numeric: true }); });
  }
  function fillCatList() {
    var dl = $('catList'); dl.textContent = '';
    libCats().forEach(function (c) { var o = document.createElement('option'); o.value = c; dl.appendChild(o); });
  }
  function libRow(tpl, withCat) {
    var row = document.createElement('div'); row.className = 'libi';
    var sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = tpl.color;
    if (tpl.image) sw.style.backgroundImage = 'url(' + tpl.image + ')';
    sw.style.borderColor = VTT.tokensDraw.KIND_COLOR[tpl.kind];
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = tpl.name;
    var ed = document.createElement('button'); ed.textContent = '✎'; ed.title = tr('tokdlg.titleTpl');
    ed.onclick = function (e) { e.stopPropagation(); openTokenDialog('tpl', tpl); };
    var x = document.createElement('button'); x.textContent = '🗑'; x.title = tr('lib.remove.title');
    x.onclick = async function (e) {
      e.stopPropagation();
      if (!(await VTT.ui.confirm({ title: tr('lib.confirm.title'), text: tr('lib.confirm.text', { name: tpl.name }), ok: tr('common.delete'), danger: true }))) return;
      S.lib = S.lib.filter(function (l) { return l.lid !== tpl.lid; });
      libChanged();
    };
    row.appendChild(sw); row.appendChild(nm); row.appendChild(ed); row.appendChild(x);
    row.title = tr('lib.row.title') + (withCat ? tr('lib.row.category', { cat: catTitle(tpl.category) }) : '');
    row.onclick = function () { placeFromLib(tpl); };
    return row;
  }
  var LIB_SEARCH_MAX = 300;   // при поиске показываем не больше строк
  function renderLib() {
    var box = $('libList'); box.textContent = '';
    $('libEmpty').hidden = S.lib.length > 0;
    var q = norm(S.libQuery).trim(), words = q ? q.split(/\s+/) : [], searching = words.length > 0;
    // группы: партия (kind pc) → категории по номеру → без категории
    var groups = [{ key: '__pc', title: tr('lib.party'), items: [] }], byCat = {};
    libCats().forEach(function (c) { byCat[c] = { key: c, title: catTitle(c), items: [] }; groups.push(byCat[c]); });
    var none = { key: '__none', title: NO_CAT, items: [] }; groups.push(none);
    var shown = 0;
    S.lib.forEach(function (l) {
      if (searching) {
        var hay = norm(l.name + ' ' + (l.kind === 'pc' ? tr('lib.partyKeywords') : catTitle(l.category)));
        for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return;
      }
      shown++;
      (l.kind === 'pc' ? groups[0] : (l.category && byCat[l.category]) || none).items.push(l);
    });
    if (searching && !shown) {
      var m = document.createElement('div'); m.className = 'muted small'; m.textContent = tr('lib.notFound');
      box.appendChild(m); return;
    }
    var budget = LIB_SEARCH_MAX;
    groups.forEach(function (g) {
      if (!g.items.length) return;
      // по умолчанию раскрыта только партия; при поиске раскрыто всё найденное
      var collapsed = searching ? false : (g.key in S.libCollapsed ? S.libCollapsed[g.key] : g.key !== '__pc');
      var grp = document.createElement('div'); grp.className = 'libg' + (collapsed ? ' collapsed' : '');
      var gh = document.createElement('div'); gh.className = 'gh';
      var gb = document.createElement('div'); gb.className = 'gb';
      var filled = false;
      var fill = function () {   // строки строятся только у раскрытых групп
        if (filled) return; filled = true;
        var list = g.items;
        if (searching) { list = list.slice(0, Math.max(0, budget)); budget -= list.length; }
        list.forEach(function (tpl) { gb.appendChild(libRow(tpl, searching)); });
        if (list.length < g.items.length) {
          var more = document.createElement('div'); more.className = 'muted small';
          more.textContent = tr('lib.more', { n: g.items.length - list.length });
          gb.appendChild(more);
        }
      };
      var setHead = function () { gh.textContent = (grp.classList.contains('collapsed') ? '▸ ' : '▾ ') + g.title + ' (' + g.items.length + ')'; };
      setHead();
      gh.onclick = function () {
        grp.classList.toggle('collapsed');
        var c = grp.classList.contains('collapsed');
        if (!searching) S.libCollapsed[g.key] = c;
        if (!c) fill();
        setHead();
      };
      if (!collapsed) fill();
      grp.appendChild(gh); grp.appendChild(gb); box.appendChild(grp);
    });
  }
  function syncSettingsUI() {
    var st = S.scene.settings;
    $('setDiag').value = st.diagonal; $('setAuto').checked = !!st.autoReveal;
    $('setGridGM').checked = !!st.gridGM; $('setGridPl').checked = !!st.gridPlayer;
    $('setLabGM').checked = st.labelsGM !== false; $('setLabPl').checked = st.labelsPlayer !== false; $('setRuler').checked = st.rulerToPlayers !== false;
    Array.prototype.forEach.call(document.querySelectorAll('.pview'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-pview') === st.playerView);
    });
  }

  // ------------------------------------------------------------------ контекстное меню
  function closeMenu() { $('ctxMenu').hidden = true; }
  function buildMenu(parent, items) {
    items.forEach(function (it) {
      var d = document.createElement('div');
      if (it === 'sep') { d.className = 'sep'; parent.appendChild(d); return; }
      d.className = 'it' + (it.danger ? ' danger' : '') + (it.cur ? ' cur' : '');
      var s = document.createElement('span'); s.textContent = it.label; d.appendChild(s);
      if (it.sub) {
        var a = document.createElement('span'); a.textContent = '▸'; d.appendChild(a);
        var sub = document.createElement('div'); sub.className = 'sub'; buildMenu(sub, it.sub); d.appendChild(sub);
      } else {
        d.onclick = function () { closeMenu(); it.fn(); };
      }
      parent.appendChild(d);
    });
  }
  function showMenu(x, y, items) {
    var m = $('ctxMenu'); m.textContent = ''; buildMenu(m, items);
    m.hidden = false;
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(0, Math.min(x, innerWidth - w - 4)) + 'px';
    m.style.top = Math.max(0, Math.min(y, innerHeight - h - 4)) + 'px';
    if (x + w + 180 > innerWidth) Array.prototype.forEach.call(m.querySelectorAll('.sub'), function (s) { s.classList.add('flip'); });
  }
  function showTokenMenu(x, y, t) {
    selectToken(t.id);
    showMenu(x, y, [
      { label: tr('gm.menu.status'), sub: Object.keys(STATUS_NAMES).map(function (k) {
        return { label: STATUS_NAMES[k], cur: t.status === k, fn: function () { setStatus(t, k); } };
      }) },
      { label: t.hidden ? tr('gm.menu.showPlayers') : tr('gm.menu.hidePlayers'), fn: function () { toggleHidden(t); } },
      { label: tr('gm.menu.edit'), fn: function () { openTokenDialog('edit', t); } },
      { label: tr('gm.menu.duplicate'), fn: function () { duplicate(t); } },
      { label: tr('gm.menu.toLibrary'), fn: function () { addToLibrary(t); } },
      'sep',
      { label: tr('common.delete'), danger: true, fn: function () { removeToken(t); } }
    ]);
  }

  // ------------------------------------------------------------------ инструменты
  function setTool(name) {
    S.tool = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === name);
    });
    S.r.canvas.style.cursor = S.pending ? 'crosshair' : (name === 'select' ? '' : (name === 'doors' ? 'pointer' : 'crosshair'));
    S.r.requestDraw();
  }
  function setBrush(n) {
    S.brush = n;
    Array.prototype.forEach.call(document.querySelectorAll('.brush'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-brush') === String(n));
    });
    S.r.requestDraw();
  }
  function ping(fx, fy) {
    S.r.pings.push({ x: fx, y: fy, t0: performance.now() });
    VTT.sync.send({ t: 'ping', x: fx, y: fy });
    S.r.requestDraw();
  }
  function toggleDoorAt(fx, fy) {
    var doors = S.map.geo.doors || [], best = -1, bd = 0.5;
    for (var i = 0; i < doors.length; i++) {
      var d = G().distToSegment(fx, fy, doors[i]);
      if (d <= bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    S.scene.doors[best] = !S.scene.doors[best];
    S.segs = null;
    if (S.scene.settings.autoReveal) autoRevealAll();
    changed({ noList: true });
    toast(S.scene.doors[best] ? tr('gm.toast.doorOpen') : tr('gm.toast.doorClosed'));
  }
  function paintLine(a, b, val) {
    var n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) || 1, ch = false;
    for (var i = 0; i <= n; i++) {
      var x = Math.round(a.x + (b.x - a.x) * i / n), y = Math.round(a.y + (b.y - a.y) * i / n);
      ch = paintBrush(x, y, val) || ch;
    }
    return ch;
  }

  // ------------------------------------------------------------------ статус-строка
  function hoverInfo(c) {
    var m = S.map;
    if (!m || c.x < 0 || c.y < 0 || c.x >= m.cols || c.y >= m.rows) { $('stCell').textContent = '—'; return; }
    var L = m.meta.layers || {}, parts = [G().cellName(c.x, c.y)];
    var e = L.elevation_ft && L.elevation_ft[c.y] ? L.elevation_ft[c.y][c.x] : 0;
    parts.push(tr('gm.cell.height', { h: (e > 0 ? '+' : '') + (e || 0) }));
    var terr = L.terrain && L.terrain[c.y] ? String(L.terrain[c.y][c.x] || '') : '';
    if (L.difficult && L.difficult[c.y][c.x] == 1) parts.push(tr('gm.cell.difficult'));
    if (/water/.test(terr)) parts.push(tr('gm.cell.water'));
    if (L.hazard && L.hazard[c.y][c.x] === 'hole') parts.push(tr('gm.cell.hole'));
    else if (L.hazard && L.hazard[c.y][c.x]) parts.push(String(L.hazard[c.y][c.x]));
    if (L.obstacle && L.obstacle[c.y][c.x] == 1) parts.push(tr('gm.cell.obstacle'));
    var rule = M().cellRule(m, c.x, c.y);
    if (rule.blocked && parts.indexOf(tr('gm.cell.obstacle')) < 0 && parts.indexOf(tr('gm.cell.hole')) < 0) parts.push(tr('gm.cell.blocked'));
    $('stCell').textContent = parts.join(' · ');
  }

  // ------------------------------------------------------------------ оверлей мастера
  function overlay(ctx, r) {
    var px = r.cellPx(), h = S.hover, td = VTT.tokensDraw;
    if (S.pending && h) {
      var p = r.cellToScreen(h.x, h.y);
      td.drawToken(ctx, Object.assign({}, S.pending, { x: h.x, y: h.y, status: 'ok' }), px, p.x, p.y, { gm: true, dragging: true });
    }
    if ((S.tool === 'reveal' || S.tool === 'hide') && h && !S.pending) {
      var half = Math.floor(S.brush / 2), q = r.cellToScreen(h.x - half, h.y - half);
      ctx.strokeStyle = S.tool === 'reveal' ? '#3fb950' : '#f85149';
      ctx.lineWidth = 2; ctx.strokeRect(q.x, q.y, S.brush * px, S.brush * px);
    }
    if (S.rect) {
      var a = S.rect, x0 = Math.min(a.x0, a.x1), x1 = Math.max(a.x0, a.x1) + 1, y0 = Math.min(a.y0, a.y1), y1 = Math.max(a.y0, a.y1) + 1;
      var s0 = r.cellToScreen(x0, y0);
      ctx.fillStyle = 'rgba(88,166,255,.2)'; ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2;
      ctx.fillRect(s0.x, s0.y, (x1 - x0) * px, (y1 - y0) * px);
      ctx.strokeRect(s0.x, s0.y, (x1 - x0) * px, (y1 - y0) * px);
    }
    if (S.drag && S.drag.started) {
      var t = getToken(S.drag.id);
      if (t) {
        var g = r.cellToScreen(S.drag.tx, S.drag.ty);
        td.drawToken(ctx, Object.assign({}, t, { x: S.drag.tx, y: S.drag.ty }), px, g.x, g.y, { gm: true, selected: true });
      }
    }
  }

  // ------------------------------------------------------------------ события канваса
  function bindCanvas() {
    var cv = S.r.canvas;
    function stopPan(e, allowMenu) {
      var p = S.pan; if (!p) return;
      S.pan = null;
      try { if (cv.hasPointerCapture && cv.hasPointerCapture(p.id)) cv.releasePointerCapture(p.id); } catch (err) {}
      cv.style.cursor = S.space ? 'grab' : '';
      if (allowMenu && p.button === 2 && p.dist < 4 && S.map) {
        var c = S.r.screenToCell(e.offsetX, e.offsetY), t = tokenAtCell(c.x, c.y);
        if (t) showTokenMenu(e.clientX, e.clientY, t);
      }
    }
    cv.addEventListener('pointerdown', function (e) {
      closeMenu();
      if (!S.map) return;
      if (e.button === 1 || e.button === 2 || (e.button === 0 && S.space)) {
        S.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, dist: 0, button: e.button };
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
        cv.style.cursor = 'grabbing';
        e.preventDefault(); return;
      }
      if (e.button !== 0) return;
      var c = S.r.screenToCell(e.offsetX, e.offsetY);
      S.hover = c;
      if (S.party) { placeParty(c.x, c.y); return; }
      if (S.pending) { placeToken(c.x, c.y); return; }
      if (e.altKey || S.tool === 'ping') { ping(c.fx, c.fy); return; }
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      if (S.tool === 'select') {
        var t = tokenAtCell(c.x, c.y);
        selectToken(t ? t.id : null);
        if (t) S.drag = { id: t.id, cx: e.clientX, cy: e.clientY, ox: c.fx - t.x, oy: c.fy - t.y, started: false, tx: t.x, ty: t.y, key: '' };
      } else if (S.tool === 'reveal' || S.tool === 'hide') {
        S.painting = { last: { x: c.x, y: c.y }, val: S.tool === 'reveal' ? '0' : '1' };
        if (paintBrush(c.x, c.y, S.painting.val)) changed({ noList: true });
      } else if (S.tool === 'rect') {
        S.rect = { x0: c.x, y0: c.y, x1: c.x, y1: c.y };
      } else if (S.tool === 'doors') {
        toggleDoorAt(c.fx, c.fy);
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!S.map) return;
      if (S.pan) {
        if (e.pointerId !== S.pan.id) return;
        var dx = e.clientX - S.pan.x, dy = e.clientY - S.pan.y;
        S.pan.x = e.clientX; S.pan.y = e.clientY;
        S.pan.dist = Math.max(S.pan.dist, Math.abs(e.clientX - S.pan.sx) + Math.abs(e.clientY - S.pan.sy));
        if (dx || dy) S.r.panBy(dx, dy);
        return;
      }
      var c = S.r.screenToCell(e.offsetX, e.offsetY);
      var prev = S.hover; S.hover = c;
      hoverInfo(c);
      if (S.drag) updateDrag(e);
      else if (S.painting) {
        if (paintLine(S.painting.last, c, S.painting.val)) changed({ noList: true });
        S.painting.last = { x: c.x, y: c.y };
      } else if (S.rect) {
        S.rect.x1 = c.x; S.rect.y1 = c.y; S.r.requestDraw();
      } else if (S.pending || S.tool === 'reveal' || S.tool === 'hide') {
        if (!prev || prev.x !== c.x || prev.y !== c.y) S.r.requestDraw();
      } else if (S.tool === 'select') {
        cv.style.cursor = tokenAtCell(c.x, c.y) ? 'grab' : '';
      }
    });
    function up(e) {
      if (S.pan) { stopPan(e, true); return; }
      if (S.drag) endDrag(e, false);
      if (S.painting) S.painting = null;
      if (S.rect) {
        var a = S.rect; S.rect = null;
        var idx = [];
        for (var y = Math.min(a.y0, a.y1); y <= Math.max(a.y0, a.y1); y++)
          for (var x = Math.min(a.x0, a.x1); x <= Math.max(a.x0, a.x1); x++)
            if (x >= 0 && y >= 0 && x < S.map.cols && y < S.map.rows) idx.push(y * S.map.cols + x);
        if (setFog(idx, '0')) changed({ noList: true }); else S.r.requestDraw();
      }
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', function (e) { if (S.drag) endDrag(e, true); stopPan(e, false); S.painting = null; S.rect = null; S.r.requestDraw(); });
    cv.addEventListener('lostpointercapture', function (e) { stopPan(e, false); });
    cv.addEventListener('pointerleave', function () { if (!S.drag && !S.painting) { S.hover = null; S.r.requestDraw(); } });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault(); closeMenu();
      if (!S.map) return;
      S.r.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('auxclick', function (e) { e.preventDefault(); });
  }

  // ------------------------------------------------------------------ клавиатура
  function bindKeys() {
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('tokenDlg').hidden) { closeTokenDialog(); return; }
        if (!$('help').hidden) { $('help').hidden = true; return; }
        if (!$('ctxMenu').hidden) { closeMenu(); return; }
        if (S.drag) { endDrag(e, true); return; }
        if (S.pending || S.party) { cancelPlacement(); return; }
        if (!$('settingsDlg').hidden) { VTT.settings.close(); return; }
        if (!$('picker').hidden && S.map) { $('picker').hidden = true; return; }
        return;
      }
      if (inputFocused() || modalOpen()) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ') { e.preventDefault(); undo(); }
        return;
      }
      var k = e.key;
      if (k === ' ') { e.preventDefault(); if (!S.space) { S.space = true; S.r.canvas.style.cursor = 'grab'; } return; }
      if (k === '?' || k === 'F1') { e.preventDefault(); $('help').hidden = false; return; }
      if (!S.map) return;
      switch (e.code) {
        case 'KeyV': setTool('select'); return;
        case 'KeyR': setTool(e.shiftKey ? 'rect' : 'reveal'); return;
        case 'KeyH': setTool('hide'); return;
        case 'KeyD': setTool('doors'); return;
        case 'Digit1': setBrush(1); return;
        case 'Digit3': setBrush(3); return;
        case 'Digit5': setBrush(5); return;
        case 'Digit0': S.r.fit(null, 250); return;
        case 'KeyN': if (VTT.combat) VTT.combat.next(); return;
        case 'ArrowLeft': e.preventDefault(); stepSelected(-1, 0, e.shiftKey); return;
        case 'ArrowRight': e.preventDefault(); stepSelected(1, 0, e.shiftKey); return;
        case 'ArrowUp': e.preventDefault(); stepSelected(0, -1, e.shiftKey); return;
        case 'ArrowDown': e.preventDefault(); stepSelected(0, 1, e.shiftKey); return;
        case 'Delete': { var t = selToken(); if (t) removeToken(t); return; }
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.key === ' ') { S.space = false; if (!S.pan) S.r.canvas.style.cursor = ''; }
    });
    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('#ctxMenu')) closeMenu();
    }, true);
    window.addEventListener('blur', function () { S.space = false; });
  }

  // ------------------------------------------------------------------ init
  function bindUI() {
    $('btnMaps').onclick = function () { $('picker').hidden = false; refreshMaps(); };
    $('btnPickerClose').onclick = function () { $('picker').hidden = true; };
    $('btnPickDir').onclick = pickMapsDir;
    $('btnImportMap').onclick = importMapDialog;
    $('btnImportMapTb').onclick = importMapDialog;
    $('btnSettings').onclick = function () { VTT.settings.open(); };

    $('btnPlayer').onclick = function () {
      Promise.resolve(VTT.sync.openPlayerWindow()).catch(function (e) { toast(tr('gm.err.openPlayer', { msg: e && e.message || e }), 4000); });
    };
    VTT.sync.onHello(function () { pushMap(); });
    VTT.sync.onState(function (open) { $('btnPlayer').classList.toggle('active', open); if (open) setTimeout(pushMap, 300); });

    Array.prototype.forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.onclick = function () { setTool(b.getAttribute('data-tool')); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.brush'), function (b) {
      b.onclick = function () { setBrush(parseInt(b.getAttribute('data-brush'), 10)); };
    });
    $('btnRevealAll').onclick = function () {
      if (!S.map) return;
      S.scene.fog = new Array(S.map.cols * S.map.rows + 1).join('0'); changed({ noList: true });
    };
    $('btnHideAll').onclick = async function () {
      if (!S.map) return;
      if (!(await VTT.ui.confirm({ title: tr('gm.confirm.hideAll.title'), text: tr('gm.confirm.hideAll.text'), ok: tr('common.hide') }))) return;
      S.scene.fog = new Array(S.map.cols * S.map.rows + 1).join('1'); changed({ noList: true });
    };
    $('btnNewRound').onclick = function () {
      if (!S.map) return;
      newRound();
    };
    $('btnRevealPlayers').onclick = revealPlayers;
    $('btnResetRounds').onclick = async function () {
      if (!S.map) return;
      if (!(await VTT.ui.confirm({ title: tr('gm.confirm.resetRounds.title'), text: tr('gm.confirm.resetRounds.text'), ok: tr('common.reset') }))) return;
      S.scene.round = 1; S.scene.tokens.forEach(function (t) { t.moved = 0; }); S.undo = [];
      changed(); toast(tr('gm.toast.roundsReset'));
    };
    $('btnClearScene').onclick = async function () {
      if (!S.map || !S.scene) return;
      if (!(await VTT.ui.confirm({ title: tr('gm.confirm.clearScene.title'), text: tr('gm.confirm.clearScene.text'), ok: tr('common.continue'), danger: true }))) return;
      if (!(await VTT.ui.confirm({ title: tr('gm.confirm.clearScene2.title'), text: tr('gm.confirm.clearScene2.text'), ok: tr('gm.confirm.clearScene2.ok'), danger: true }))) return;
      if (VTT.blog && VTT.blog.hasData()) await VTT.blog.promptSave(tr('gm.prompt.saveBeforeClear'));
      var sc = S.scene;
      cancelPlacement();
      sc.tokens = [];
      sc.fog = new Array(S.map.cols * S.map.rows + 1).join('1');
      sc.round = 1;
      sc.combat = { active: false, order: [], turnId: null };
      if (Array.isArray(sc.counters)) sc.counters = [];
      S.sel = null; S.r.selectedId = null; S.undo = []; S.sentImages = {};
      changed(); toast(tr('gm.toast.sceneCleared'));
    };
    $('btnPlaceParty').onclick = startParty;
    $('libSearch').oninput = function () {
      clearTimeout(S.libSearchTimer);
      S.libSearchTimer = setTimeout(function () { S.libQuery = $('libSearch').value; renderLib(); }, 150);
    };
    $('libSearch').onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { $('libSearch').value = ''; S.libQuery = ''; renderLib(); }
    };
    $('btnLibExport').onclick = function () {
      VTT.store.exportLibrary(S.lib).catch(function (e) { toast(tr('common.saveFailed', { msg: e && e.message || e }), 4000); });
    };
    $('btnLibImport').onclick = function () { $('fileLib').click(); };
    $('fileLib').onchange = function () {
      var f = $('fileLib').files[0]; $('fileLib').value = '';
      if (!f) return;
      VTT.store.importLibraryFile(f).then(function (arr) {
        var before = S.lib.length;
        // данные из импортируемого файла главнее: шаблон с тем же lid заменяется целиком, остальные сохраняются
        var imp = migrateLib(arr), now = Date.now(), byLid = {};
        imp.forEach(function (t) { t.updated = now; byLid[t.lid] = t; });
        var kept = S.lib.filter(function (t) { return !byLid[t.lid]; });
        S.lib = migrateLib(imp.concat(kept));
        libChanged(true);
        toast(tr('gm.toast.libImported', { n: imp.length, added: Math.max(0, S.lib.length - before) }));
      }).catch(function (e) { VTT.ui.alert({ title: tr('gm.import.lib.title'), text: e.message || String(e) }); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('.pview'), function (b) {
      b.onclick = function () {
        if (!S.map) return;
        S.scene.settings.playerView = b.getAttribute('data-pview');
        S.sentView = S.scene.settings.playerView === 'gm' ? S.r.getView() : null;
        syncSettingsUI(); changed({ noList: true });
      };
    });
    $('btnSendView').onclick = function () {
      if (!S.map) return;
      S.scene.settings.playerView = 'gm'; S.sentView = S.r.getView();
      syncSettingsUI(); changed({ noList: true }); toast(tr('gm.toast.viewSent'));
    };
    // «Как у меня»: раз в секунду досылаем игрокам текущий вид мастера, если он изменился
    setInterval(function () {
      if (!S.map || !S.scene || S.scene.settings.playerView !== 'gm' || !VTT.sync.isOpen()) return;
      var v = S.r.getView(), o = S.sentView;
      if (!v) return;
      if (o && Math.abs(v.cx - o.cx) < 0.05 && Math.abs(v.cy - o.cy) < 0.05 && Math.abs(v.cellsW - o.cellsW) < 0.05) return;
      S.sentView = v;
      pushState();
    }, 1000);
    $('btnHelp').onclick = function () { $('help').hidden = false; };
    $('btnHelpClose').onclick = function () { $('help').hidden = true; };
    $('btnPanel').onclick = function () { $('app').classList.toggle('nopanel'); };
    $('btnNewToken').onclick = function () {
      if (!S.map) { toast(tr('common.openMapFirst')); return; }
      openTokenDialog('new');
    };

    function setting(id, key, conv) {
      $(id).onchange = function () {
        if (!S.scene) return;
        S.scene.settings[key] = conv ? conv($(id)) : $(id).checked;
        changed({ noList: true });
      };
    }
    setting('setDiag', 'diagonal', function (el) { return el.value; });
    setting('setAuto', 'autoReveal'); setting('setGridGM', 'gridGM'); setting('setGridPl', 'gridPlayer'); setting('setRuler', 'rulerToPlayers');
    setting('setLabGM', 'labelsGM'); setting('setLabPl', 'labelsPlayer');

    $('btnExport').onclick = function () {
      if (S.scene) VTT.store.exportScene(S.scene).catch(function (e) { toast(tr('common.saveFailed', { msg: e && e.message || e }), 4000); });
    };
    $('btnImport').onclick = function () { $('fileScene').click(); };
    $('fileScene').onchange = function () {
      var f = $('fileScene').files[0]; $('fileScene').value = '';
      if (!f) return;
      if (!S.map) { VTT.ui.alert({ title: tr('gm.import.scene.title'), text: tr('gm.import.scene.needMap') }); return; }
      VTT.store.importScene(f).then(function (sc) {
        if (sc.map !== S.map.name) { VTT.ui.alert({ title: tr('gm.import.scene.title'), text: tr('gm.err.sceneMismatch', { scene: sc.map, open: S.map.name }) }); return; }
        S.scene = normalizeScene(sc, S.map); S.segs = null; S.undo = []; S.sel = null; S.r.selectedId = null; S.sentView = null;
        S.r.setScene(S.scene); syncSettingsUI(); changed(); pushMap(); toast(tr('gm.toast.sceneImported'));
      }).catch(function (e) { VTT.ui.alert({ title: tr('gm.import.scene.title'), text: tr('gm.err.importFail', { msg: e.message }) }); });
    };

    // перетаскивание файлов
    var dragDepth = 0;
    window.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { dragDepth++; document.body.classList.add('dragover'); } });
    window.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragover'); });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragover');
      var fl = e.dataTransfer && e.dataTransfer.files;
      if (!fl || !fl.length) return;
      var paths = Array.prototype.map.call(fl, function (f) { return window.host.fs.pathForFile(f); }).filter(Boolean);
      if (paths.length) importMapPaths(paths);
    });
  }

  // ------------------------------------------------------------------ смена кампании / живое обновление папки карт
  function hideReloadBar() { var b = $('reloadBar'); if (b) b.hidden = true; }
  function showReloadBar() {
    var b = $('reloadBar'); if (!b || !S.map) return;
    $('reloadText').textContent = tr('watch.mapChanged', { name: S.map.title || S.map.name });
    b.hidden = false;
  }
  // сохранить отложенное (сцена, библиотека) в ТЕКУЩУЮ кампанию — вызывать ДО переключения кампании
  async function flush() {
    var jobs = [];
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; if (S.scene) jobs.push(VTT.store.saveScene(S.scene)); }
    if (S.libTimer) { clearTimeout(S.libTimer); S.libTimer = null; jobs.push(VTT.store.saveLibrary(S.lib)); }
    try { await Promise.all(jobs); } catch (e) { console.warn('flush', e); }
  }
  // закрыть сцену: карта, токены, библиотека, окно игроков
  function closeScene() {
    clearTimeout(S.saveTimer); S.saveTimer = null; clearTimeout(S.libTimer); S.libTimer = null;
    S.map = null; S.scene = null; S.segs = null; S.undo = []; S.sel = null; S.pending = null; S.drag = null; S.rect = null; S.painting = null;
    S.lib = []; S.entries = []; S.lastMapName = null; S.curEntry = null; S.sentImages = {}; S.sentView = null; S.hover = null;
    S.r.setMap(null); S.r.setScene(null); S.r.selectedId = null; S.r.ruler = null;
    hideReloadBar(); closeMenu();
    $('roundNum').textContent = '1';
    setMsg('');
    renderList(); renderLib();
    VTT.sync.send({ t: 'reset' });
  }
  async function loadCampaignData() {
    $('pickerMsg').textContent = '';
    $('picker').hidden = false;
    try { S.lib = migrateLib(await VTT.store.getLibrary()); } catch (e) { S.lib = []; }
    renderLib(); libChanged(true);
    await initPicker();
  }
  // полная переинициализация под (новую) текущую кампанию без перезапуска
  async function reinit() {
    try { S.camp = await window.host.campaigns.current(); } catch (e) { S.camp = null; }
    closeScene();
    if (!S.camp) { window.host.app.showWizard(); return; }
    await loadCampaignData();
  }
  function onCampaign(c) {
    var prev = mapsRoot(), prevId = S.camp && S.camp.id;
    S.camp = c || null;
    if (!c || c.id !== prevId) { reinit(); return; }
    if (mapsRoot() !== prev) { refreshMaps(); reloadLibrary(); }
  }
  function onWatch(ev) {
    if (!ev || !S.camp) return;
    if (ev.kind !== 'maps') return;
    refreshMaps(true);
    if (!S.map || !S.curEntry) return;
    var mine = [String(S.curEntry.rel).toLowerCase(), String(S.map.imageRel || '').toLowerCase()];
    if ((ev.rels || []).some(function (r) { return mine.indexOf(String(r).toLowerCase()) >= 0; })) showReloadBar();
  }
  // перечитать открытую карту с диска, сцена (токены, туман, бой) сохраняется
  async function reloadCurrent() {
    var en = S.curEntry;
    hideReloadBar();
    if (!en || !S.map) return;
    try {
      var map = await VTT.store.loadMapFromEntry(en, { bust: true });
      var sc = normalizeScene(S.scene, map);
      S.map = map; S.scene = sc; S.segs = null;
      S.r.setMap(map); S.r.setScene(sc);
      syncSettingsUI();
      renderList();
      pushMap();
      if (map.warning) VTT.ui.alert({ title: tr('common.attention'), text: map.warning });
      setMsg(tr('gm.map.status', { name: map.title || map.name, cols: map.cols, rows: map.rows }));
      toast(tr('watch.reloaded'));
    } catch (e) {
      toast(tr('gm.err.load', { msg: e && e.message || e }), 4000);
    }
  }
  function onMenu(action) {
    if (action === 'import-map') { $('picker').hidden = false; refreshMaps(); importMapDialog(); }
    else if (action === 'settings') VTT.settings.open();
    else if (action === 'wizard') window.host.app.showWizard();
    else if (action === 'campaigns') VTT.campaignsUi.openManager();
    else if (action === 'report') VTT.reportUi.open();
  }

  VTT.gm = {
    init: async function () {
      S.r = VTT.render.createRenderer($('canvas'), { mode: 'gm' });
      S.r.overlay = overlay;
      VTT.sync.initGm();
      bindUI(); bindDialog(); bindCanvas(); bindKeys();
      window.host.menu.onAction(onMenu);
      try { S.camp = await window.host.campaigns.current(); } catch (e) { S.camp = null; }
      if (!S.camp) { window.host.app.showWizard(); return; }
      window.host.campaigns.onChanged(onCampaign);
      window.host.watch.onChange(onWatch);
      $('btnReload').onclick = reloadCurrent;
      $('btnReloadX').onclick = hideReloadBar;
      if (VTT.blog) VTT.blog.init();
      await loadCampaignData();
    },
    flush: flush,
    reinit: reinit,
    _state: S,
    _api: { openMap: openMap, pushMap: pushMap, pushState: pushState, setStatus: setStatus, placeToken: placeToken, startPlacement: startPlacement, duplicate: duplicate,
            changed: changed, selectToken: selectToken, newRound: newRound, toast: toast, getToken: getToken }
  };
})();
