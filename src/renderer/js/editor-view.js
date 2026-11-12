/* VTT.editorView — камера (зум/панорама) и рисование поля редактора. Рисует в пикселях картинки, сетка накладывается моделью. */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var M = function () { return VTT.editorModel; };

  var KIND_COLOR = { normal: 'rgba(0,0,0,0)', difficult: '#e0a020', water: '#2f7fe0', hole: '#111111', obstacle: '#8a8a8a', impassable: '#d03030' };
  var KIND_ALPHA = { difficult: 0.4, water: 0.45, hole: 0.7, obstacle: 0.6, impassable: 0.35 };

  /** Цвет высоты: вверх — от жёлтого к красному, вниз — голубой/синий. */
  function elevColor(v, a) {
    var t = Math.min(1, Math.abs(v) / 60);
    if (v > 0) return 'hsla(' + Math.round(50 - 50 * t) + ',90%,' + Math.round(55 - 10 * t) + '%,' + a + ')';
    return 'hsla(' + Math.round(200 + 30 * t) + ',80%,' + Math.round(60 - 15 * t) + '%,' + a + ')';
  }

  function create(canvas) {
    var v = { z: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
    var ctx = canvas.getContext('2d');

    v.resize = function () {
      var r = canvas.getBoundingClientRect();
      v.dpr = window.devicePixelRatio || 1;
      v.w = Math.max(1, Math.round(r.width)); v.h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(v.w * v.dpr); canvas.height = Math.round(v.h * v.dpr);
    };
    v.toImg = function (sx, sy) { return { x: (sx - v.ox) / v.z, y: (sy - v.oy) / v.z }; };
    v.toScreen = function (px, py) { return { x: px * v.z + v.ox, y: py * v.z + v.oy }; };
    v.fit = function (iw, ih) {
      v.z = Math.min(v.w / Math.max(1, iw), v.h / Math.max(1, ih)) * 0.95;
      v.ox = (v.w - iw * v.z) / 2; v.oy = (v.h - ih * v.z) / 2;
    };
    v.zoomAt = function (sx, sy, f) {
      var nz = Math.max(0.05, Math.min(40, v.z * f)), k = nz / v.z;
      v.ox = sx - (sx - v.ox) * k; v.oy = sy - (sy - v.oy) * k; v.z = nz;
    };
    v.pan = function (dx, dy) { v.ox += dx; v.oy += dy; };

    /** E: {model, img, vis:{walls,terrain,elev,grid}, sel, pv, tool}. */
    v.draw = function (E) {
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, v.w, v.h);
      var m = E.model;
      if (!m || !E.img) return;
      ctx.setTransform(v.dpr * v.z, 0, 0, v.dpr * v.z, v.dpr * v.ox, v.dpr * v.oy);
      ctx.imageSmoothingEnabled = v.z < 3;
      ctx.drawImage(E.img, 0, 0);
      var P = m.ppg, X0 = m.offX, Y0 = m.offY, px = 1 / v.z, x, y;
      function cx(c) { return X0 + c * P; }
      function cy(c) { return Y0 + c * P; }
      var showText = P * v.z >= 26;

      if (E.vis.terrain) {
        for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
          var k = M().kindOf(m, x, y);
          if (k === 'normal') continue;
          ctx.globalAlpha = KIND_ALPHA[k]; ctx.fillStyle = KIND_COLOR[k];
          ctx.fillRect(cx(x), cy(y), P, P);
          if (k === 'obstacle' || k === 'impassable') {
            ctx.globalAlpha = 0.9; ctx.strokeStyle = KIND_COLOR[k]; ctx.lineWidth = 2 * px;
            ctx.beginPath(); ctx.moveTo(cx(x) + 3 * px, cy(y) + 3 * px); ctx.lineTo(cx(x + 1) - 3 * px, cy(y + 1) - 3 * px);
            ctx.moveTo(cx(x + 1) - 3 * px, cy(y) + 3 * px); ctx.lineTo(cx(x) + 3 * px, cy(y + 1) - 3 * px); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      if (E.vis.elev) {
        var el = m.layers.elevation_ft;
        for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
          var e = +el[y][x] || 0;
          if (!e) continue;
          ctx.fillStyle = elevColor(e, 0.28); ctx.fillRect(cx(x), cy(y), P, P);
        }
        // контуры: граница между клетками с разной высотой, цвет — по большей
        ctx.lineWidth = 3 * px; ctx.lineCap = 'round';
        function edge(e1, e2, x1, y1, x2, y2) {
          if (e1 === e2) return;
          ctx.strokeStyle = elevColor(Math.abs(e1) >= Math.abs(e2) ? e1 : e2, 0.95);
          ctx.beginPath(); ctx.moveTo(cx(x1), cy(y1)); ctx.lineTo(cx(x2), cy(y2)); ctx.stroke();
        }
        function ev(xx, yy) { return xx < 0 || yy < 0 || xx >= m.cols || yy >= m.rows ? 0 : (+el[yy][xx] || 0); }
        for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
          edge(ev(x, y), ev(x + 1, y), x + 1, y, x + 1, y + 1);
          edge(ev(x, y), ev(x, y + 1), x, y + 1, x + 1, y + 1);
          if (x === 0) edge(ev(x, y), 0, 0, y, 0, y + 1);
          if (y === 0) edge(ev(x, y), 0, x, 0, x + 1, 0);
        }
        if (showText) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3 * px; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = 'bold ' + (P * 0.28) + 'px system-ui';
          for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
            var e2 = +el[y][x] || 0;
            if (!e2) continue;
            var tx = cx(x + 0.5), ty = cy(y + 0.5), s = (e2 > 0 ? '+' : '') + e2;
            ctx.strokeText(s, tx, ty); ctx.fillText(s, tx, ty);
          }
        }
      }

      if (E.vis.grid) {
        ctx.lineWidth = px; ctx.strokeStyle = 'rgba(255,235,60,.75)';
        ctx.beginPath();
        for (x = 0; x <= m.cols; x++) { ctx.moveTo(cx(x), cy(0)); ctx.lineTo(cx(x), cy(m.rows)); }
        for (y = 0; y <= m.rows; y++) { ctx.moveTo(cx(0), cy(y)); ctx.lineTo(cx(m.cols), cy(y)); }
        ctx.stroke();
        if (showText) {
          ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3 * px; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.font = (P * 0.2) + 'px system-ui';
          for (x = 0; x < m.cols; x++) { var nm = VTT.geometry.cellName(x, 0).replace(/\d+$/, ''); ctx.strokeText(nm, cx(x) + 2 * px, cy(0) + 2 * px); ctx.fillText(nm, cx(x) + 2 * px, cy(0) + 2 * px); }
          for (y = 1; y < m.rows; y++) { ctx.strokeText(String(y + 1), cx(0) + 2 * px, cy(y) + 2 * px); ctx.fillText(String(y + 1), cx(0) + 2 * px, cy(y) + 2 * px); }
        }
      }

      if (E.vis.walls) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // стены: показываем «как будут сохранены» (с разрывами под двери), поверх — полные стены тонкой пунктирной линией не нужны
        var cut = M().cutWalls(m.walls, m.doors);
        ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 4 * px;
        cut.forEach(function (pl) {
          ctx.beginPath(); pl.forEach(function (p, i) { if (i) ctx.lineTo(cx(p.x), cy(p.y)); else ctx.moveTo(cx(p.x), cy(p.y)); }); ctx.stroke();
        });
        m.doors.forEach(function (d, i) {
          var s = M().doorSeg(d), sel = E.sel && E.sel.kind === 'door' && E.sel.di === i;
          ctx.strokeStyle = sel ? '#00e5ff' : d.open ? '#3fb950' : '#ff9800'; ctx.lineWidth = 7 * px; ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(cx(s.x1), cy(s.y1)); ctx.lineTo(cx(s.x2), cy(s.y2)); ctx.stroke();
          ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * px;
          ctx.beginPath(); ctx.moveTo(cx(s.x1), cy(s.y1)); ctx.lineTo(cx(s.x2), cy(s.y2)); ctx.stroke();
        });
        ctx.lineCap = 'round';
        if (E.tool === 'select' || E.tool === 'wall') {
          m.walls.forEach(function (pl, wi) {
            pl.forEach(function (p, pi) {
              var sel = E.sel && E.sel.kind === 'point' && E.sel.wi === wi && E.sel.pi === pi;
              ctx.fillStyle = sel ? '#00e5ff' : '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = px;
              ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), 4.5 * px, 0, 6.2832); ctx.fill(); ctx.stroke();
            });
          });
          if (E.sel && E.sel.kind === 'seg') {
            var a = m.walls[E.sel.wi][E.sel.si], b = m.walls[E.sel.wi][E.sel.si + 1];
            ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 6 * px; ctx.beginPath(); ctx.moveTo(cx(a.x), cy(a.y)); ctx.lineTo(cx(b.x), cy(b.y)); ctx.stroke();
          }
        }
      }

      // предпросмотр инструментов
      var pv = E.pv || {};
      if (pv.wall && pv.wall.length) {
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 3 * px; ctx.setLineDash([6 * px, 4 * px]);
        ctx.beginPath(); pv.wall.forEach(function (p, i) { if (i) ctx.lineTo(cx(p.x), cy(p.y)); else ctx.moveTo(cx(p.x), cy(p.y)); }); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (pv.snap) {
        ctx.fillStyle = '#00e5ff'; ctx.beginPath(); ctx.arc(cx(pv.snap.x), cy(pv.snap.y), 5 * px, 0, 6.2832); ctx.fill();
      }
      if (pv.door) {
        var ds = M().doorSeg(pv.door);
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 8 * px; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(cx(ds.x1), cy(ds.y1)); ctx.lineTo(cx(ds.x2), cy(ds.y2)); ctx.stroke();
      }
      if (pv.cells) {
        ctx.fillStyle = 'rgba(0,229,255,.3)'; ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = px;
        pv.cells.forEach(function (c) { ctx.fillRect(cx(c.x), cy(c.y), P, P); ctx.strokeRect(cx(c.x), cy(c.y), P, P); });
      }
      if (pv.box) {
        var b2 = pv.box;
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2 * px; ctx.strokeRect(b2.x, b2.y, b2.w, b2.h);
        ctx.fillStyle = '#00e5ff';
        [[b2.x, b2.y], [b2.x + b2.w, b2.y], [b2.x, b2.y + b2.h], [b2.x + b2.w, b2.y + b2.h]].forEach(function (p) { ctx.fillRect(p[0] - 5 * px, p[1] - 5 * px, 10 * px, 10 * px); });
      }
      if (pv.span) {
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2 * px;
        pv.span.forEach(function (p) { ctx.beginPath(); ctx.moveTo(p.x, p.y - 20 * px); ctx.lineTo(p.x, p.y + 20 * px); ctx.stroke(); });
        if (pv.span.length === 2) { ctx.beginPath(); ctx.moveTo(pv.span[0].x, pv.span[0].y); ctx.lineTo(pv.span[1].x, pv.span[1].y); ctx.stroke(); }
      }
      // край картинки, если сетка не закрывает её целиком
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = px; ctx.strokeRect(0, 0, m.imgW, m.imgH);
    };
    return v;
  }

  VTT.editorView = { create: create, KIND_COLOR: KIND_COLOR, KIND_ALPHA: KIND_ALPHA, elevColor: elevColor };
})();
