/* VTT.editorModel — чистая модель редактора карт: сетка, стены, двери, слои местности, проверка, история.
 * Классический скрипт без DOM; нужен только VTT.geometry (заливка с учётом стен). Формат — docs/MAP-FORMAT.md.
 * Модель -> toMeta() даёт обычный map.json; fromMeta() читает существующий (в т.ч. от скилла/генератора) и
 * запоминает всё, чего редактор не знает (extra, неизвестные слои, поля дверей), чтобы при сохранении ничего не потерять. */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var FORMAT = 'vestfalia-battlemap/1';
  var OWNED = ['format', 'name', 'image', 'image_grid', 'resolution', 'feet_per_cell', 'layers', 'line_of_sight', 'portals', 'labels'];
  var LAYERS = ['terrain', 'elevation_ft', 'difficult', 'hazard', 'obstacle', 'walkable'];
  var LAYER_DEF = { terrain: '', elevation_ft: 0, difficult: 0, hazard: null, obstacle: 0, walkable: 1 };
  var KINDS = ['normal', 'difficult', 'water', 'hole', 'obstacle', 'impassable'];
  var EPS = 1e-6;

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function grid(cols, rows, v) {
    var g = [];
    for (var y = 0; y < rows; y++) { var r = []; for (var x = 0; x < cols; x++) r.push(v); g.push(r); }
    return g;
  }
  function defOf(sample) { return typeof sample === 'string' ? '' : typeof sample === 'number' ? 0 : null; }

  /** Привести слой к размеру rows × cols (значения сохраняются, новые клетки — def). */
  function fitGrid(src, cols, rows, def) {
    var g = [];
    for (var y = 0; y < rows; y++) {
      var r = [];
      for (var x = 0; x < cols; x++) {
        var v = src && src[y] ? src[y][x] : undefined;
        r.push(v === undefined ? def : v);
      }
      g.push(r);
    }
    return g;
  }

  // ------------------------------------------------------------------ создание / чтение / запись
  /** Новая карта по картинке: o = {name, image, imgW, imgH, ppg, feet, offX, offY, cols, rows}. */
  function create(o) {
    var ppg = o.ppg || 70, offX = o.offX || 0, offY = o.offY || 0;
    var size = autoSize(o.imgW, o.imgH, ppg, offX, offY);
    var cols = o.cols || size.cols, rows = o.rows || size.rows;
    var m = {
      title: o.name || '', image: o.image || '', imgW: o.imgW || 0, imgH: o.imgH || 0,
      ppg: ppg, feet: o.feet || 5, offX: offX, offY: offY, cols: cols, rows: rows,
      layers: {}, extraLayers: {}, walls: [], doors: [], labels: [], extra: {}, resExtra: {}, order: null, origGrid: null, hadLabels: false
    };
    LAYERS.forEach(function (n) { m.layers[n] = grid(cols, rows, n === 'terrain' ? 'floor' : LAYER_DEF[n]); });
    return m;
  }

  /** Прочитать map.json. img = {width, height} фактической картинки (или null). */
  function fromMeta(meta, img) {
    var res = meta.resolution || {}, size = res.map_size || {};
    var cols = size.x | 0, rows = size.y | 0, ppg = res.pixels_per_grid || 70;
    var ig = meta.image_grid;
    var m = {
      title: meta.name || '', image: meta.image || '',
      imgW: img ? img.width : (ig && ig.width) || cols * ppg, imgH: img ? img.height : (ig && ig.height) || rows * ppg,
      ppg: ppg, feet: meta.feet_per_cell || 5,
      offX: ig && ig.width && ig.height ? ig.x || 0 : 0, offY: ig && ig.width && ig.height ? ig.y || 0 : 0,
      cols: cols, rows: rows, layers: {}, extraLayers: {}, walls: [], doors: [], labels: clone(meta.labels) || [],
      extra: {}, resExtra: {}, order: Object.keys(meta), origGrid: ig && ig.width && ig.height ? { width: ig.width, height: ig.height } : null,
      hadLabels: Array.isArray(meta.labels)
    };
    Object.keys(res).forEach(function (k) { if (k !== 'map_size' && k !== 'pixels_per_grid') m.resExtra[k] = clone(res[k]); });
    Object.keys(meta).forEach(function (k) { if (OWNED.indexOf(k) < 0) m.extra[k] = clone(meta[k]); });
    var L = meta.layers || {};
    LAYERS.forEach(function (n) { m.layers[n] = fitGrid(L[n], cols, rows, LAYER_DEF[n]); });
    Object.keys(L).forEach(function (n) {
      if (LAYERS.indexOf(n) >= 0) return;
      var s = L[n] && L[n][0] ? L[n][0][0] : undefined;
      m.extraLayers[n] = fitGrid(L[n], cols, rows, defOf(s));
    });
    (meta.line_of_sight || []).forEach(function (pl) { if (Array.isArray(pl)) m.walls.push(clone(pl)); });
    (meta.portals || []).forEach(function (p) { if (p && p.position) m.doors.push(clone(p)); });
    return m;
  }

  /** Модель -> объект map.json. Стены получают разрывы под двери. */
  function toMeta(m) {
    var res = { map_origin: { x: 0, y: 0 } };
    Object.keys(m.resExtra || {}).forEach(function (k) { res[k] = clone(m.resExtra[k]); });
    res.map_size = { x: m.cols, y: m.rows };
    res.pixels_per_grid = m.ppg;
    var layers = {};
    LAYERS.forEach(function (n) { layers[n] = clone(m.layers[n]); });
    Object.keys(m.extraLayers || {}).forEach(function (n) { layers[n] = clone(m.extraLayers[n]); });
    var vals = {
      format: FORMAT, name: m.title || undefined, image: m.image || undefined,
      image_grid: { x: m.offX, y: m.offY, width: m.imgW, height: m.imgH },
      resolution: res, feet_per_cell: m.feet, layers: layers,
      line_of_sight: cutWalls(m.walls, m.doors), portals: clone(m.doors)
    };
    if (m.hadLabels || (m.labels && m.labels.length)) vals.labels = clone(m.labels);
    var out = {};
    (m.order || []).forEach(function (k) {
      if (k in vals && vals[k] !== undefined) out[k] = vals[k]; else if (k in m.extra) out[k] = clone(m.extra[k]);
    });
    OWNED.forEach(function (k) { if (!(k in out) && vals[k] !== undefined) out[k] = vals[k]; });
    Object.keys(m.extra || {}).forEach(function (k) { if (!(k in out)) out[k] = clone(m.extra[k]); });
    return out;
  }

  // ------------------------------------------------------------------ сетка
  function autoSize(imgW, imgH, ppg, offX, offY) {
    return {
      cols: Math.max(1, Math.floor(((imgW || 0) - (offX || 0)) / ppg + 1e-9)),
      rows: Math.max(1, Math.floor(((imgH || 0) - (offY || 0)) / ppg + 1e-9))
    };
  }
  function mod(a, n) { return ((a % n) + n) % n; }
  /** Рамка одной клетки в пикселях картинки -> {ppg, offX, offY} (смещение приводится в диапазон [0, ppg)). */
  function gridFromBox(b) {
    var ppg = Math.max(1, Math.round((Math.abs(b.w) + Math.abs(b.h)) / 2));
    return { ppg: ppg, offX: mod(Math.round(Math.min(b.x, b.x + b.w)), ppg), offY: mod(Math.round(Math.min(b.y, b.y + b.h)), ppg) };
  }
  /** Две отметки по горизонтали (x1, x2 в пикселях) и число клеток между ними -> {ppg, offX}. */
  function gridFromSpan(x1, x2, n) {
    var ppg = Math.max(1, Math.round(Math.abs(x2 - x1) / Math.max(1, n)));
    return { ppg: ppg, offX: mod(Math.round(Math.min(x1, x2)), ppg) };
  }
  /** Задать размер сетки; слои подгоняются (новые клетки — «обычные»). */
  function resize(m, cols, rows) {
    cols = Math.max(1, cols | 0); rows = Math.max(1, rows | 0);
    var hasT = m.layers.terrain.some(function (r) { return r.some(function (v) { return v !== ''; }); });
    LAYERS.forEach(function (n) { m.layers[n] = fitGrid(m.layers[n], cols, rows, n === 'terrain' ? (hasT ? 'floor' : '') : LAYER_DEF[n]); });
    Object.keys(m.extraLayers).forEach(function (n) {
      var s = m.extraLayers[n][0] ? m.extraLayers[n][0][0] : undefined;
      m.extraLayers[n] = fitGrid(m.extraLayers[n], cols, rows, defOf(s));
    });
    m.cols = cols; m.rows = rows;
  }

  // ------------------------------------------------------------------ состояние / история
  function snapshot(m) {
    return JSON.stringify({
      ppg: m.ppg, feet: m.feet, offX: m.offX, offY: m.offY, cols: m.cols, rows: m.rows,
      layers: m.layers, extraLayers: m.extraLayers, walls: m.walls, doors: m.doors, labels: m.labels, title: m.title
    });
  }
  function restore(m, s) {
    var o = JSON.parse(s);
    Object.keys(o).forEach(function (k) { m[k] = o[k]; });
  }
  function History(limit) { this.limit = limit || 100; this.stack = []; this.i = -1; }
  History.prototype.reset = function (s) { this.stack = [s]; this.i = 0; };
  History.prototype.push = function (s) {
    if (this.i >= 0 && this.stack[this.i] === s) return false;
    this.stack.length = this.i + 1;
    this.stack.push(s);
    if (this.stack.length > this.limit + 1) this.stack.shift();
    this.i = this.stack.length - 1;
    return true;
  };
  History.prototype.canUndo = function () { return this.i > 0; };
  History.prototype.canRedo = function () { return this.i < this.stack.length - 1; };
  History.prototype.undo = function () { return this.canUndo() ? this.stack[--this.i] : null; };
  History.prototype.redo = function () { return this.canRedo() ? this.stack[++this.i] : null; };

  // ------------------------------------------------------------------ стены
  /** Привязка к угловым точкам и серединам граней клеток (центры клеток исключены). */
  function snapPoint(x, y) {
    var c = [
      { x: Math.round(x), y: Math.round(y) },
      { x: Math.floor(x) + 0.5, y: Math.round(y) },
      { x: Math.round(x), y: Math.floor(y) + 0.5 }
    ];
    var best = c[0], bd = Infinity;
    c.forEach(function (p) { var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < bd) { bd = d; best = p; } });
    return best;
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  function dedupe(pts) {
    var out = [];
    pts.forEach(function (p) {
      var q = out[out.length - 1];
      if (!q || Math.abs(q.x - p.x) > EPS || Math.abs(q.y - p.y) > EPS) out.push({ x: p.x, y: p.y });
    });
    return out;
  }
  function addWall(m, pts) {
    var p = dedupe(pts);
    if (p.length < 2) return -1;
    m.walls.push(p);
    return m.walls.length - 1;
  }
  function distSeg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    var qx = x1 + t * dx, qy = y1 + t * dy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }
  /** Что под точкой (в клетках): точка стены -> {kind:'point', wi, pi}; отрезок -> {kind:'seg', wi, si}; дверь -> {kind:'door', di}. */
  function hit(m, x, y, tol) {
    var i, k, best = null, bd = tol;
    for (i = 0; i < m.walls.length; i++) {
      for (k = 0; k < m.walls[i].length; k++) {
        var d = Math.hypot(m.walls[i][k].x - x, m.walls[i][k].y - y);
        if (d <= tol * 0.8 && d < bd) { bd = d; best = { kind: 'point', wi: i, pi: k }; }
      }
    }
    if (best) return best;
    for (i = 0; i < m.doors.length; i++) {
      var s = doorSeg(m.doors[i]), dd = distSeg(x, y, s.x1, s.y1, s.x2, s.y2);
      if (dd < bd) { bd = dd; best = { kind: 'door', di: i }; }
    }
    for (i = 0; i < m.walls.length; i++) {
      for (k = 0; k + 1 < m.walls[i].length; k++) {
        var a = m.walls[i][k], b = m.walls[i][k + 1], d2 = distSeg(x, y, a.x, a.y, b.x, b.y);
        if (d2 < bd - 1e-9) { bd = d2; best = { kind: 'seg', wi: i, si: k }; }
      }
    }
    return best;
  }
  function movePoint(m, wi, pi, x, y) { m.walls[wi][pi] = { x: x, y: y }; }
  function deletePoint(m, wi, pi) {
    m.walls[wi].splice(pi, 1);
    if (dedupe(m.walls[wi]).length < 2) m.walls.splice(wi, 1);
  }
  function deleteWall(m, wi) { m.walls.splice(wi, 1); }
  /** Удалить один отрезок: полилиния делится на две. */
  function deleteSegment(m, wi, si) {
    var pl = m.walls[wi], a = pl.slice(0, si + 1), b = pl.slice(si + 1), out = [];
    if (a.length >= 2) out.push(a);
    if (b.length >= 2) out.push(b);
    Array.prototype.splice.apply(m.walls, [wi, 1].concat(out));
  }
  /** Добавить точку на отрезок (разбить его). */
  function insertPoint(m, wi, si, x, y) { m.walls[wi].splice(si + 1, 0, { x: x, y: y }); }

  // ------------------------------------------------------------------ двери
  function doorSeg(d) {
    var x = d.position.x, y = d.position.y, w = d.size ? d.size[0] : 1, h = d.size ? d.size[1] : 1;
    if (d.dir === 'v') return { x1: x, y1: y, x2: x, y2: y + Math.max(w, h) };
    return { x1: x, y1: y, x2: x + (w > 0 ? w : Math.max(w, h)), y2: y };
  }
  function isInt(v) { return Math.abs(v - Math.round(v)) < EPS; }
  /** Дверь на отрезке стены длиной в клетку под точкой (cx, cy) в клетках. null — стены рядом нет. */
  function doorAt(m, cx, cy, tol) {
    tol = tol || 0.35;
    var best = null, bd = tol;
    for (var i = 0; i < m.walls.length; i++) {
      for (var k = 0; k + 1 < m.walls[i].length; k++) {
        var a = m.walls[i][k], b = m.walls[i][k + 1];
        var horiz = Math.abs(a.y - b.y) < EPS, vert = Math.abs(a.x - b.x) < EPS;
        if (!horiz && !vert) continue;
        var d = distSeg(cx, cy, a.x, a.y, b.x, b.y);
        if (d >= bd) continue;
        var lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        var along = horiz ? cx : cy, line = horiz ? a.y : a.x;
        var u = Math.floor(along + EPS);
        if (u < Math.ceil(lo - EPS)) u = Math.ceil(lo - EPS);
        if (u + 1 > hi + EPS) u = Math.floor(hi + EPS) - 1;
        if (u < lo - EPS || u + 1 > hi + EPS || !isInt(line)) continue;
        bd = d;
        best = { position: horiz ? { x: u, y: Math.round(line) } : { x: Math.round(line), y: u }, size: [1, 1], dir: horiz ? 'h' : 'v', open: false };
      }
    }
    return best;
  }
  function addDoor(m, d) {
    for (var i = 0; i < m.doors.length; i++) {
      var o = m.doors[i];
      if (o.dir === d.dir && o.position.x === d.position.x && o.position.y === d.position.y) return i;
    }
    m.doors.push(d);
    return m.doors.length - 1;
  }
  /** Удалить дверь; restoreWall — на её месте появляется отрезок стены. */
  function removeDoor(m, i, restoreWall) {
    var s = doorSeg(m.doors[i]);
    m.doors.splice(i, 1);
    if (restoreWall) m.walls.push([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
  }

  /** Отрезки door (axis-aligned) вырезаются из стен; полилинии без пересечения с дверями остаются как есть. */
  function cutWalls(walls, doors) {
    var ds = (doors || []).map(doorSeg);
    return walls.map(function (pl) {
      var pieces = [], changed = false;
      for (var k = 0; k + 1 < pl.length; k++) {
        var segs = cutSeg(pl[k], pl[k + 1], ds);
        if (segs.length !== 1 || segs[0][0] !== pl[k] || segs[0][1] !== pl[k + 1]) changed = true;
        pieces = pieces.concat(segs);
      }
      if (!changed) return [clone(pl)];
      var out = [], cur = null;
      pieces.forEach(function (s) {
        var last = cur && cur[cur.length - 1];
        if (cur && Math.abs(last.x - s[0].x) < EPS && Math.abs(last.y - s[0].y) < EPS) cur.push({ x: s[1].x, y: s[1].y });
        else { cur = [{ x: s[0].x, y: s[0].y }, { x: s[1].x, y: s[1].y }]; out.push(cur); }
      });
      return out;
    }).reduce(function (a, b) { return a.concat(b); }, []);
  }
  function cutSeg(a, b, ds) {
    var horiz = Math.abs(a.y - b.y) < EPS, vert = Math.abs(a.x - b.x) < EPS;
    if (!horiz && !vert) return [[a, b]];
    var cuts = [];
    ds.forEach(function (s) {
      var dh = Math.abs(s.y1 - s.y2) < EPS;
      if (horiz !== dh) return;
      if (horiz ? Math.abs(s.y1 - a.y) > EPS : Math.abs(s.x1 - a.x) > EPS) return;
      var lo = horiz ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2), hi = horiz ? Math.max(s.x1, s.x2) : Math.max(s.y1, s.y2);
      cuts.push([lo, hi]);
    });
    if (!cuts.length) return [[a, b]];
    var p0 = horiz ? a.x : a.y, p1 = horiz ? b.x : b.y, dir = p1 >= p0 ? 1 : -1;
    var lo0 = Math.min(p0, p1), hi0 = Math.max(p0, p1);
    // оставшиеся интервалы после вычитания разрезов
    var free = [[lo0, hi0]];
    cuts.forEach(function (c) {
      var nf = [];
      free.forEach(function (f) {
        if (c[1] <= f[0] + EPS || c[0] >= f[1] - EPS) { nf.push(f); return; }
        if (c[0] > f[0] + EPS) nf.push([f[0], c[0]]);
        if (c[1] < f[1] - EPS) nf.push([c[1], f[1]]);
      });
      free = nf;
    });
    if (free.length === 1 && Math.abs(free[0][0] - lo0) < EPS && Math.abs(free[0][1] - hi0) < EPS) return [[a, b]];
    if (dir < 0) free = free.reverse().map(function (f) { return [f[1], f[0]]; });
    return free.map(function (f) {
      return horiz ? [{ x: f[0], y: a.y }, { x: f[1], y: a.y }] : [{ x: a.x, y: f[0] }, { x: a.x, y: f[1] }];
    });
  }

  // ------------------------------------------------------------------ местность и высота
  function inb(m, x, y) { return x >= 0 && y >= 0 && x < m.cols && y < m.rows; }
  function isWater(v) { return String(v || '').toLowerCase().indexOf('water') >= 0; }
  /** Тип клетки в том порядке, в каком его читает movement.cellRule. */
  function kindOf(m, x, y) {
    var L = m.layers;
    if (L.obstacle[y][x] == 1) return 'obstacle';
    if (L.hazard[y][x] === 'hole') return 'hole';
    if (L.walkable[y][x] == 0) return isWater(L.terrain[y][x]) ? 'water' : 'impassable';
    if (L.difficult[y][x] == 1) return 'difficult';
    return 'normal';
  }
  /** Поставить тип клетке: остальные признаки местности сбрасываются (одна клетка — один тип). */
  function setKind(m, x, y, kind) {
    if (!inb(m, x, y)) return false;
    var L = m.layers;
    var terr = isWater(L.terrain[y][x]) ? 'floor' : L.terrain[y][x];
    L.difficult[y][x] = 0; L.hazard[y][x] = null; L.obstacle[y][x] = 0; L.walkable[y][x] = 1; L.terrain[y][x] = terr;
    if (kind === 'difficult') L.difficult[y][x] = 1;
    else if (kind === 'water') { L.terrain[y][x] = 'water'; L.walkable[y][x] = 0; }
    else if (kind === 'hole') L.hazard[y][x] = 'hole';
    else if (kind === 'obstacle') L.obstacle[y][x] = 1;
    else if (kind === 'impassable') L.walkable[y][x] = 0;
    return true;
  }
  function setElev(m, x, y, v) { if (inb(m, x, y)) m.layers.elevation_ft[y][x] = v; }

  /** Клетки квадратной кисти n×n (n нечётное) с центром в (cx, cy). */
  function brushCells(m, cx, cy, n) {
    var r = Math.floor(n / 2), out = [];
    for (var y = cy - r; y <= cy + r; y++) for (var x = cx - r; x <= cx + r; x++) if (inb(m, x, y)) out.push({ x: x, y: y });
    return out;
  }
  function rectCells(m, x0, y0, x1, y1) {
    var out = [], ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (var y = ay; y <= by; y++) for (var x = ax; x <= bx; x++) if (inb(m, x, y)) out.push({ x: x, y: y });
    return out;
  }
  /** Заливка связной области клеток с тем же ключом; стены и закрытые двери — границы (если barrier). */
  function floodCells(m, x, y, keyFn, barrier) {
    if (!inb(m, x, y)) return [];
    var G = VTT.geometry, segs = [];
    if (barrier && G) {
      var geo = G.segmentsFromMap({ line_of_sight: cutWalls(m.walls, m.doors), portals: m.doors });
      segs = geo.walls.concat(geo.doors);
    }
    var key = keyFn(x, y), seen = {}, out = [], q = [[x, y]];
    seen[y * m.cols + x] = 1;
    while (q.length) {
      var c = q.pop(); out.push({ x: c[0], y: c[1] });
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = c[0] + d[0], ny = c[1] + d[1];
        if (!inb(m, nx, ny) || seen[ny * m.cols + nx] || keyFn(nx, ny) !== key) return;
        if (segs.length && G.edgeBlocked(segs, c[0], c[1], nx, ny)) return;
        seen[ny * m.cols + nx] = 1; q.push([nx, ny]);
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ проверка
  /** -> [{level:'error'|'warn', code, params}]; тексты — i18n 'editor.val.<code>'. */
  function validate(m) {
    var out = [], i, k;
    function add(level, code, params) { out.push({ level: level, code: code, params: params || {} }); }
    if (!String(m.title || '').trim()) add('error', 'noName');
    if (m.cols < 1 || m.rows < 1) add('error', 'size');
    if (m.ppg < 4) add('error', 'ppg');
    if (m.imgW && m.imgH) {
      var needW = m.offX + m.cols * m.ppg, needH = m.offY + m.rows * m.ppg;
      if (needW > m.imgW + 0.5 || needH > m.imgH + 0.5) add('warn', 'gridOutside', { need: needW + '×' + needH, have: m.imgW + '×' + m.imgH });
      if (m.origGrid && (m.origGrid.width !== m.imgW || m.origGrid.height !== m.imgH)) {
        add('warn', 'imageMismatch', { file: m.origGrid.width + '×' + m.origGrid.height, real: m.imgW + '×' + m.imgH });
      }
    }
    // двери
    var seen = {};
    for (i = 0; i < m.doors.length; i++) {
      var d = m.doors[i], s = doorSeg(d), name = G_name(d);
      var key = d.dir + ':' + d.position.x + ',' + d.position.y;
      if (seen[key]) add('warn', 'doorDup', { name: name });
      seen[key] = 1;
      if (!isInt(d.position.x) || !isInt(d.position.y)) add('warn', 'doorOdd', { name: name });
      if (s.x1 < -EPS || s.y1 < -EPS || s.x2 > m.cols + EPS || s.y2 > m.rows + EPS) { add('warn', 'doorOutside', { name: name }); continue; }
      if (!onWall(m, s)) add('warn', 'doorFloating', { name: name });
    }
    // стены
    var outside = 0, degenerate = 0;
    for (i = 0; i < m.walls.length; i++) {
      var pl = m.walls[i];
      if (dedupe(pl).length < 2) degenerate++;
      for (k = 0; k < pl.length; k++) if (pl[k].x < -EPS || pl[k].y < -EPS || pl[k].x > m.cols + EPS || pl[k].y > m.rows + EPS) { outside++; break; }
    }
    if (outside) add('warn', 'wallOutside', { n: outside });
    if (degenerate) add('warn', 'wallShort', { n: degenerate });
    // клетки
    var empty = 0, blocked = 0;
    for (var y = 0; y < m.rows; y++) for (var x = 0; x < m.cols; x++) {
      if (m.layers.terrain[y][x] === '' || m.layers.terrain[y][x] == null) empty++;
      var kd = kindOf(m, x, y);
      if (kd === 'obstacle' || kd === 'hole' || kd === 'impassable') blocked++;
    }
    if (empty) add('warn', 'emptyTerrain', { n: empty });
    if (m.cols * m.rows > 0 && blocked === m.cols * m.rows) add('warn', 'allBlocked');
    return out;
  }
  function G_name(d) { return (VTT.geometry ? VTT.geometry.cellName(Math.max(0, Math.floor(d.position.x)), Math.max(0, Math.floor(d.position.y))) : d.position.x + ',' + d.position.y) + (d.dir === 'v' ? '│' : '─'); }
  /** Дверной отрезок опирается на стену: лежит на ней или касается её концом/точкой. */
  function onWall(m, s) {
    var pts = [[s.x1, s.y1], [s.x2, s.y2], [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2]];
    for (var i = 0; i < m.walls.length; i++) {
      for (var k = 0; k + 1 < m.walls[i].length; k++) {
        var a = m.walls[i][k], b = m.walls[i][k + 1];
        for (var j = 0; j < pts.length; j++) if (distSeg(pts[j][0], pts[j][1], a.x, a.y, b.x, b.y) < 1e-4) return true;
      }
    }
    return false;
  }

  VTT.editorModel = {
    FORMAT: FORMAT, LAYERS: LAYERS, KINDS: KINDS, LAYER_DEF: LAYER_DEF,
    create: create, fromMeta: fromMeta, toMeta: toMeta,
    autoSize: autoSize, gridFromBox: gridFromBox, gridFromSpan: gridFromSpan, resize: resize,
    snapshot: snapshot, restore: restore, History: History,
    snapPoint: snapPoint, round2: round2, addWall: addWall, hit: hit, movePoint: movePoint, deletePoint: deletePoint,
    deleteWall: deleteWall, deleteSegment: deleteSegment, insertPoint: insertPoint,
    doorSeg: doorSeg, doorAt: doorAt, addDoor: addDoor, removeDoor: removeDoor, cutWalls: cutWalls,
    kindOf: kindOf, setKind: setKind, setElev: setElev, brushCells: brushCells, rectCells: rectCells, floodCells: floodCells,
    validate: validate, inb: inb
  };
})();
