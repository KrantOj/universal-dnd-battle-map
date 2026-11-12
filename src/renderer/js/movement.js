/* VTT.movement — стоимость шага, Дейкстра, путь в футах. Зависит от VTT.geometry. */
(function () {
  'use strict';
  window.VTT = window.VTT || {};
  var G = function () { return window.VTT.geometry; };

  function layersOf(map) {
    return (map.meta && map.meta.layers) || map.layers || {};
  }
  function at(grid, x, y, def) {
    if (!grid || !grid[y]) return def;
    var v = grid[y][x];
    return v === undefined ? def : v;
  }

  /** Правило проходимости клетки (см. ARCHITECTURE.md, раздел 2). */
  function cellRule(map, x, y) {
    if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return { blocked: true, mult: 1, reason: '' };
    var L = layersOf(map);
    if (at(L.obstacle, x, y, 0) == 1) return { blocked: true, mult: 1, reason: '' };
    if (at(L.hazard, x, y, null) === 'hole') return { blocked: true, mult: 1, reason: '' };
    if (at(L.walkable, x, y, 1) == 0) {
      var t = String(at(L.terrain, x, y, '')).toLowerCase();
      if (t.indexOf('water') >= 0) return { blocked: false, mult: 2, reason: 'water' };
      return { blocked: true, mult: 1, reason: '' };
    }
    if (at(L.difficult, x, y, 0) == 1) return { blocked: false, mult: 2, reason: 'difficult' };
    return { blocked: false, mult: 1, reason: '' };
  }

  // ---- бинарная куча (min-heap по ключу) ----
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.size = function () { return this.k.length; };
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v;
    var topK = k[0], topV = v[0];
    var lk = k.pop(), lv = v.pop();
    var n = k.length;
    if (n > 0) {
      var i = 0;
      for (;;) {
        var c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.topKey = topK;
    return topV;
  };

  // эффективная скорость 5е по альтернативной формуле для диагоналей 5-10-5
  function freeFeet(dx, dy, mode, unit) {
    dx = Math.abs(dx); dy = Math.abs(dy);
    var d = Math.min(dx, dy), s = Math.max(dx, dy) - d;
    return unit * (mode === '5-10-5' ? s + d + Math.floor(d / 2) : s + d);
  }

  function elevAt(map, x, y) {
    return +at(layersOf(map).elevation_ft, x, y, 0) || 0;
  }

  /** Ядро Дейкстры. target — {x,y} или null (тогда считаем всё до budget). */
  function search(map, segs, from, opts, target, budget) {
    var geo = G();
    var cols = map.cols, rows = map.rows, N = cols * rows;
    var size = Math.max(1, opts.size | 0 || 1);
    var diagMode = opts.diagonal === '5-10-5';
    var unit = map.feet || 5;
    var hasWalls = segs && segs.length > 0;
    var dist = new Float64Array(2 * N).fill(Infinity);
    var prev = new Int32Array(2 * N).fill(-1);
    var rc = new Uint8Array(N); // кэш правил: 0 — не считали, 1 — блок, 2 — ×1, 3 — ×2

    function ruleAt(x, y) {
      var i = y * cols + x;
      if (!rc[i]) {
        var r = cellRule(map, x, y);
        rc[i] = r.blocked ? 1 : (r.mult === 2 ? 3 : 2);
      }
      return rc[i];
    }
    // множитель для следа size×size с левым верхним (x,y); 0 — нельзя
    function footMult(x, y) {
      if (x < 0 || y < 0 || x + size > cols || y + size > rows) return 0;
      var m = 1;
      for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) {
        var r = ruleAt(x + i, y + j);
        if (r === 1) return 0;
        if (r === 3) m = 2;
      }
      return m;
    }
    // стены на пути шага (dx,dy) для каждой клетки следа; диагональ — ещё оба «угла»
    function wallsOK(x, y, dx, dy) {
      if (!hasWalls) return true;
      for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) {
        var cx = x + i, cy = y + j;
        if (dx !== 0 && dy !== 0) {
          if (geo.edgeBlocked(segs, cx, cy, cx + dx, cy)) return false;
          if (geo.edgeBlocked(segs, cx, cy, cx, cy + dy)) return false;
          if (geo.edgeBlocked(segs, cx + dx, cy, cx + dx, cy + dy)) return false;
          if (geo.edgeBlocked(segs, cx, cy + dy, cx + dx, cy + dy)) return false;
        }
        if (geo.edgeBlocked(segs, cx, cy, cx + dx, cy + dy)) return false;
      }
      return true;
    }

    var heap = new Heap();
    var start = (from.y * cols + from.x) * 2;
    dist[start] = 0;
    heap.push(0, start);
    var tIdx = target ? target.y * cols + target.x : -1;
    var found = -1;
    while (heap.size()) {
      var node = heap.pop();
      var d = heap.topKey;
      if (d > dist[node]) continue;
      if (d > budget) break;
      var idx = node >> 1, par = node & 1;
      if (idx === tIdx) { found = node; break; }
      var x = idx % cols, y = (idx - x) / cols;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx, ny = y + dy;
        var mult = footMult(nx, ny);
        if (!mult) continue;
        if (!wallsOK(x, y, dx, dy)) continue;
        var diag = dx !== 0 && dy !== 0;
        var base = (diag && diagMode && par === 1) ? 2 * unit : unit;
        var npar = (diag && diagMode) ? (par ^ 1) : par;
        var nn = ((ny * cols + nx) << 1) | npar;
        var nd = d + base * mult;
        if (nd < dist[nn]) { dist[nn] = nd; prev[nn] = node; heap.push(nd, nn); }
      }
    }
    return { dist: dist, prev: prev, found: found, size: size, footMult: footMult };
  }

  function occupiedHit(opts, x, y, size, cols) {
    var occ = opts.occupied;
    if (!occ) return false;
    for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) {
      if (occ.has((y + j) * cols + (x + i))) return true;
    }
    return false;
  }

  /** Кратчайший путь по правилам. См. ARCHITECTURE.md раздел 5. */
  function findPath(map, segs, from, to, opts) {
    opts = opts || {};
    var cols = map.cols, rows = map.rows;
    var size = Math.max(1, opts.size | 0 || 1);
    var unit = map.feet || 5;
    var res = {
      path: [{ x: from.x, y: from.y }], feet: Infinity, ok: false, difficult: false,
      elevFrom: elevAt(map, from.x, from.y), elevTo: elevAt(map, to.x, to.y)
    };
    if (opts.free) {
      res.path = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
      res.feet = freeFeet(to.x - from.x, to.y - from.y, opts.diagonal, unit);
      res.ok = true;
      return res;
    }
    if (from.x === to.x && from.y === to.y) { res.feet = 0; res.ok = true; return res; }
    if (occupiedHit(opts, to.x, to.y, size, cols)) return res;
    var s = search(map, segs || [], from, opts, to, Infinity);
    if (s.found < 0) return res;
    var nodes = [];
    for (var n = s.found; n !== -1; n = s.prev[n]) nodes.push(n);
    nodes.reverse();
    var path = [], difficult = false;
    for (var i = 0; i < nodes.length; i++) {
      var idx = nodes[i] >> 1, x = idx % cols, y = (idx - x) / cols;
      path.push({ x: x, y: y });
      if (i > 0 && s.footMult(x, y) === 2) difficult = true;
    }
    res.path = path; res.feet = s.dist[s.found]; res.ok = true; res.difficult = difficult;
    return res;
  }

  /** Досягаемые клетки: Map<idx, feet> (левый верх следа). Клетки, где нельзя встать
   *  (occupied), в результат не входят; сама стартовая клетка — с 0. */
  function reach(map, segs, from, budgetFt, opts) {
    opts = opts || {};
    var cols = map.cols, size = Math.max(1, opts.size | 0 || 1);
    var s = search(map, segs || [], from, opts, null, budgetFt);
    var out = new Map();
    var N = map.cols * map.rows;
    for (var i = 0; i < N; i++) {
      var d = Math.min(s.dist[2 * i], s.dist[2 * i + 1]);
      if (d > budgetFt) continue;
      var x = i % cols, y = (i - x) / cols;
      if (i !== from.y * cols + from.x && occupiedHit(opts, x, y, size, cols)) continue;
      out.set(i, d);
    }
    return out;
  }

  window.VTT.movement = { cellRule: cellRule, findPath: findPath, reach: reach };
})();
