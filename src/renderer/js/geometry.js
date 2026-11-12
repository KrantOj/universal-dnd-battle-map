/* VTT.geometry — чистая геометрия: стены, двери, пересечения, линия видимости.
 * Классический скрипт, без зависимостей. Координаты стен — в клетках (углы клеток);
 * центр клетки (x,y) = (x+0.5, y+0.5). */
(function () {
  'use strict';
  window.VTT = window.VTT || {};

  var EPS = 1e-9;

  // Ориентированная площадь треугольника (a,b,c)
  function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  /** Строгое пересечение двух отрезков: касание концом / коллинеарность не считаются. */
  function segIntersect(a, b) {
    var d1 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
    var d2 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
    var d3 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
    var d4 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
    return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
           ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
  }

  /** Есть ли среди segs отрезок, пересекающий (ax,ay)-(bx,by). Быстрый отсев по bbox. */
  function rayBlocked(segs, ax, ay, bx, by) {
    var minx = Math.min(ax, bx), maxx = Math.max(ax, bx);
    var miny = Math.min(ay, by), maxy = Math.max(ay, by);
    var r = { x1: ax, y1: ay, x2: bx, y2: by };
    // Луч, проходящий ровно через вершину стены (угол полилинии, стык стены и двери),
    // строгий тест пропускает. Для таких вершин запоминаем, по какую сторону луча лежат
    // другие концы сходящихся в ней отрезков: если по обе — луч проходит СКВОЗЬ угол.
    var touched = null;
    var len = Math.hypot(bx - ax, by - ay) || 1;
    function onRay(px, py) {
      var t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (len * len);
      return t > 1e-6 && t < 1 - 1e-6 && Math.abs(orient(ax, ay, bx, by, px, py)) / len < 1e-6;
    }
    function mark(px, py, ox, oy) {
      var side = orient(ax, ay, bx, by, ox, oy);
      if (Math.abs(side) < EPS) return;
      var key = px.toFixed(4) + ',' + py.toFixed(4);
      touched = touched || {};
      touched[key] = (touched[key] || 0) | (side > 0 ? 1 : 2);
      return touched[key] === 3;
    }
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.x1 < minx && s.x2 < minx) continue;
      if (s.x1 > maxx && s.x2 > maxx) continue;
      if (s.y1 < miny && s.y2 < miny) continue;
      if (s.y1 > maxy && s.y2 > maxy) continue;
      if (segIntersect(r, s)) return true;
      if (onRay(s.x1, s.y1) && mark(s.x1, s.y1, s.x2, s.y2)) return true;
      if (onRay(s.x2, s.y2) && mark(s.x2, s.y2, s.x1, s.y1)) return true;
    }
    return false;
  }

  /** Переход из центра клетки (x0,y0) в центр клетки (x1,y1) пересекает стену? */
  function edgeBlocked(segs, x0, y0, x1, y1) {
    return rayBlocked(segs, x0 + 0.5, y0 + 0.5, x1 + 0.5, y1 + 0.5);
  }

  /** Стены (из line_of_sight) и двери (из portals; doors[i] ↔ portals[i]). */
  function segmentsFromMap(meta) {
    var walls = [], doors = [];
    var los = (meta && meta.line_of_sight) || [];
    for (var i = 0; i < los.length; i++) {
      var pl = los[i];
      for (var k = 0; k + 1 < pl.length; k++) {
        walls.push({ x1: pl[k].x, y1: pl[k].y, x2: pl[k + 1].x, y2: pl[k + 1].y });
      }
    }
    var portals = (meta && meta.portals) || [];
    for (var p = 0; p < portals.length; p++) {
      var q = portals[p];
      var x = q.position.x, y = q.position.y;
      var w = q.size ? q.size[0] : 1, h = q.size ? q.size[1] : 1;
      if (q.dir === 'v') {
        doors.push({ x1: x, y1: y, x2: x, y2: y + Math.max(w, h) });
      } else {
        doors.push({ x1: x, y1: y, x2: x + (w > 0 ? w : Math.max(w, h)), y2: y });
      }
    }
    return { walls: walls, doors: doors };
  }

  /** Стены + закрытые двери (doorsOpen[i] === true → дверь открыта и не мешает). */
  function blockingSegments(geo, doorsOpen) {
    var out = geo.walls.slice();
    for (var i = 0; i < geo.doors.length; i++) {
      if (!(doorsOpen && doorsOpen[i])) out.push(geo.doors[i]);
    }
    return out;
  }

  /** Видимые клетки от клетки (cx,cy) в радиусе radiusCells.
   *  Точка наблюдения = (cx+0.5, cy+0.5); для токена size>1 передавайте центр следа
   *  как x+(size-1)/2. Цель видна, если луч к любой из 5 точек клетки свободен.
   *  Возвращает массив индексов y*cols+x. */
  function visibleCells(map, segs, cx, cy, radiusCells) {
    var cols = map.cols, rows = map.rows;
    var ox = cx + 0.5, oy = cy + 0.5;
    var r = radiusCells;
    var x0 = Math.max(0, Math.floor(ox - r - 1)), x1 = Math.min(cols - 1, Math.ceil(ox + r + 1));
    var y0 = Math.max(0, Math.floor(oy - r - 1)), y1 = Math.min(rows - 1, Math.ceil(oy + r + 1));
    var out = [];
    var offs = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x + 0.5 - ox, dy = y + 0.5 - oy;
        if (dx * dx + dy * dy > r * r + 1e-9) continue;
        var vis = false;
        for (var k = 0; k < offs.length && !vis; k++) {
          if (!rayBlocked(segs, ox, oy, x + offs[k][0], y + offs[k][1])) vis = true;
        }
        if (vis) out.push(y * cols + x);
      }
    }
    return out;
  }

  /** x→A..Z,AA..; y→1-based. cellName(3,5)='D6'. */
  function cellName(x, y) {
    var s = '', n = x + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s + (y + 1);
  }

  /** Расстояние от точки (px,py) до отрезка seg. */
  function distToSegment(px, py, seg) {
    var dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px - seg.x1) * dx + (py - seg.y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var qx = seg.x1 + t * dx, qy = seg.y1 + t * dy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }

  window.VTT.geometry = {
    segmentsFromMap: segmentsFromMap,
    blockingSegments: blockingSegments,
    segIntersect: segIntersect,
    edgeBlocked: edgeBlocked,
    rayBlocked: rayBlocked,
    visibleCells: visibleCells,
    cellName: cellName,
    distToSegment: distToSegment
  };
})();
