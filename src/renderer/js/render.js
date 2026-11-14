/* VTT.render — общий рендерер сцены (камера, карта, туман, токены, линейка, пинги) */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var all = [];

  function createRenderer(canvas, opts) {
    opts = opts || {};
    var mode = opts.mode || 'gm';
    var gm = mode === 'gm';
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = 0, H = 0;
    var dirty = false, scheduled = false;
    var fogCanvas = null, fogCtx = null, fogStr = null, fogDims = '';
    var anim = null; // {from,to,t0,dur}

    var r = {
      canvas: canvas, mode: mode,
      map: null, scene: null,
      camera: { x: 0, y: 0, scale: 1 },
      ruler: null, pings: [], overlay: null,
      dragId: null, selectedId: null,
      showDoors: gm
    };

    r.resize = function () {
      dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      W = w; H = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (r.onresize) r.onresize(W, H);
      r.requestDraw();
    };
    r.size = function () { return { w: W, h: H }; };

    r.setMap = function (map) {
      r.map = map;
      fogStr = null; fogDims = '';
      r.requestDraw();
    };
    r.setScene = function (scene) {
      r.scene = scene;
      fogStr = null;
      r.requestDraw();
    };

    r.screenToCell = function (sx, sy) {
      var c = r.camera, ppg = r.map ? r.map.ppg : 70;
      var fx = (c.x + sx / c.scale) / ppg, fy = (c.y + sy / c.scale) / ppg;
      return { x: Math.floor(fx), y: Math.floor(fy), fx: fx, fy: fy };
    };
    r.cellToScreen = function (x, y) {
      var c = r.camera, ppg = r.map ? r.map.ppg : 70;
      return { x: (x * ppg - c.x) * c.scale, y: (y * ppg - c.y) * c.scale };
    };
    r.cellPx = function () { return (r.map ? r.map.ppg : 70) * r.camera.scale; };

    // Местность карт из редактора (meta.editor_overlay): в картинке её нет, поэтому рисуем по слоям map.json.
    // Карты скилла battle-map рисуют местность в самой картинке и флага не имеют. Результат кэшируется в канвасе 1 клетка = ppg px.
    var OV_COLOR = { difficult: '#e0a020', water: '#2f7fe0', hole: '#111111', obstacle: '#8a8a8a', impassable: '#d03030' };
    var OV_ALPHA = { difficult: 0.4, water: 0.45, hole: 0.7, obstacle: 0.6, impassable: 0.35 };
    function ovElevColor(v, a) {
      var t = Math.min(1, Math.abs(v) / 60);
      if (v > 0) return 'hsla(' + Math.round(50 - 50 * t) + ',90%,' + Math.round(55 - 10 * t) + '%,' + a + ')';
      return 'hsla(' + Math.round(200 + 30 * t) + ',80%,' + Math.round(60 - 15 * t) + '%,' + a + ')';
    }
    function overlayCanvas(m) {
      if (m._ovl && m._ovl.src === m.meta) return m._ovl.cv;
      var L = (m.meta && m.meta.layers) || {}, P = m.ppg, cols = m.cols, rows = m.rows;
      var cv = document.createElement('canvas'); cv.width = Math.max(1, cols * P); cv.height = Math.max(1, rows * P);
      var c = cv.getContext('2d'), x, y;
      function cell(layer, xx, yy) { return L[layer] && L[layer][yy] ? L[layer][yy][xx] : undefined; }
      function kind(xx, yy) {
        if (cell('obstacle', xx, yy) == 1) return 'obstacle';
        if (cell('hazard', xx, yy) === 'hole') return 'hole';
        if (cell('walkable', xx, yy) == 0) return String(cell('terrain', xx, yy) || '').toLowerCase().indexOf('water') >= 0 ? 'water' : 'impassable';
        if (cell('difficult', xx, yy) == 1) return 'difficult';
        return 'normal';
      }
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
        var k = kind(x, y), e = +cell('elevation_ft', x, y) || 0;
        if (k !== 'normal') {
          c.globalAlpha = OV_ALPHA[k]; c.fillStyle = OV_COLOR[k]; c.fillRect(x * P, y * P, P, P);
          if (k === 'obstacle' || k === 'impassable') {
            c.globalAlpha = 0.9; c.strokeStyle = OV_COLOR[k]; c.lineWidth = 2; c.beginPath();
            c.moveTo(x * P + 3, y * P + 3); c.lineTo((x + 1) * P - 3, (y + 1) * P - 3); c.moveTo((x + 1) * P - 3, y * P + 3); c.lineTo(x * P + 3, (y + 1) * P - 3); c.stroke();
          }
          if (k === 'difficult') {   // «◆◆» в углу клетки, как у карт скилла
            c.globalAlpha = 1; c.fillStyle = '#f2b233'; c.strokeStyle = '#000'; c.lineWidth = 1;
            [0.74, 0.9].forEach(function (dx) {
              var cx = (x + dx) * P, cy = (y + 0.15) * P, rr = 0.07 * P;
              c.beginPath(); c.moveTo(cx, cy - rr); c.lineTo(cx + rr, cy); c.lineTo(cx, cy + rr); c.lineTo(cx - rr, cy); c.closePath(); c.fill(); c.stroke();
            });
          }
        }
        if (e) { c.globalAlpha = 1; c.fillStyle = ovElevColor(e, 0.2); c.fillRect(x * P, y * P, P, P); }
      }
      c.globalAlpha = 1; c.lineCap = 'butt'; c.lineWidth = Math.max(2, P * 0.05);
      function ev(xx, yy) { return xx < 0 || yy < 0 || xx >= cols || yy >= rows ? 0 : (+cell('elevation_ft', xx, yy) || 0); }
      function edge(e1, e2, x1, y1, x2, y2) {
        if (e1 === e2) return;
        var v = Math.abs(e1) >= Math.abs(e2) ? e1 : e2;
        c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = Math.max(3, P * 0.09); c.setLineDash([]);
        c.beginPath(); c.moveTo(x1 * P, y1 * P); c.lineTo(x2 * P, y2 * P); c.stroke();
        c.strokeStyle = ovElevColor(v, 1); c.lineWidth = Math.max(2, P * 0.05); c.setLineDash([P * 0.25, P * 0.1]);
        c.beginPath(); c.moveTo(x1 * P, y1 * P); c.lineTo(x2 * P, y2 * P); c.stroke(); c.setLineDash([]);
      }
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
        edge(ev(x, y), ev(x + 1, y), x + 1, y, x + 1, y + 1);
        edge(ev(x, y), ev(x, y + 1), x, y + 1, x + 1, y + 1);
        if (x === 0) edge(ev(x, y), 0, 0, y, 0, y + 1);
        if (y === 0) edge(ev(x, y), 0, x, 0, x + 1, 0);
      }
      m._ovl = { src: m.meta, cv: cv };
      return cv;
    }

    function imgGrid(m) {
      var g = m.imageGrid;
      if (g && g.width > 0 && g.height > 0) return { x: g.x || 0, y: g.y || 0, width: g.width, height: g.height };
      return { x: 0, y: 0, width: m.cols * m.ppg, height: m.rows * m.ppg };
    }
    // rect в клетках: {x0,y0,x1,y1} (x1,y1 — эксклюзивно)
    function fitCamera(rect) {
      var m = r.map;
      if (!m || !W || !H) return null;
      if (!rect) {
        var ig = imgGrid(m);
        rect = { x0: -ig.x / m.ppg, y0: -ig.y / m.ppg, x1: (ig.width - ig.x) / m.ppg, y1: (ig.height - ig.y) / m.ppg };
      }
      var w = (rect.x1 - rect.x0) * m.ppg, h = (rect.y1 - rect.y0) * m.ppg;
      var s = Math.min(W / w, H / h);
      return {
        scale: s,
        x: rect.x0 * m.ppg + w / 2 - W / (2 * s),
        y: rect.y0 * m.ppg + h / 2 - H / (2 * s)
      };
    }
    r.fit = function (rect, animMs) {
      var c = fitCamera(rect);
      if (!c) return;
      if (animMs) r.flyTo(c, animMs);
      else { anim = null; r.camera = c; r.requestDraw(); }
    };
    r.viewToCamera = function (v) {
      var m = r.map;
      if (!m || !v || !W) return null;
      var s = W / (v.cellsW * m.ppg);
      return { scale: s, x: v.cx * m.ppg - W / (2 * s), y: v.cy * m.ppg - H / (2 * s) };
    };
    r.getView = function () {
      var m = r.map, c = r.camera;
      if (!m) return null;
      return {
        cx: (c.x + W / (2 * c.scale)) / m.ppg,
        cy: (c.y + H / (2 * c.scale)) / m.ppg,
        cellsW: W / (c.scale * m.ppg)
      };
    };
    r.flyTo = function (cam, ms) {
      anim = { from: { x: r.camera.x, y: r.camera.y, scale: r.camera.scale }, to: cam, t0: performance.now(), dur: ms || 400 };
      r.requestDraw();
    };
    r.zoomAt = function (sx, sy, factor) {
      var c = r.camera;
      var ns = Math.max(0.05, Math.min(8, c.scale * factor));
      var wx = c.x + sx / c.scale, wy = c.y + sy / c.scale;
      r.camera = { scale: ns, x: wx - sx / ns, y: wy - sy / ns };
      anim = null;
      r.requestDraw();
    };
    r.panBy = function (dx, dy) {
      r.camera.x -= dx / r.camera.scale;
      r.camera.y -= dy / r.camera.scale;
      anim = null;
      r.requestDraw();
    };
    r.centerOn = function (cx, cy, animMs) {
      var m = r.map; if (!m) return;
      var c = r.camera;
      var cam = { scale: c.scale, x: cx * m.ppg - W / (2 * c.scale), y: cy * m.ppg - H / (2 * c.scale) };
      if (animMs) r.flyTo(cam, animMs); else { r.camera = cam; r.requestDraw(); }
    };

    r.requestDraw = function () {
      dirty = true;
      if (!scheduled) { scheduled = true; requestAnimationFrame(frame); }
    };

    function updateFog() {
      var m = r.map, s = r.scene;
      if (!m || !s) return;
      var dims = m.cols + 'x' + m.rows;
      if (!fogCanvas || fogDims !== dims) {
        fogCanvas = document.createElement('canvas');
        fogCanvas.width = m.cols; fogCanvas.height = m.rows;
        fogCtx = fogCanvas.getContext('2d');
        fogDims = dims; fogStr = null;
      }
      if (fogStr === s.fog) return;
      fogStr = s.fog;
      var id = fogCtx.createImageData(m.cols, m.rows), d = id.data, f = s.fog;
      for (var i = 0; i < m.cols * m.rows; i++) {
        d[i * 4 + 3] = f.charCodeAt(i) === 49 ? 255 : 0; // '1' скрыто
      }
      fogCtx.putImageData(id, 0, 0);
    }

    function footprintVisible(t) {
      var s = r.scene, m = r.map, size = t.size || 1;
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        var x = t.x + xx, y = t.y + yy;
        if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
        if (s.fog.charCodeAt(y * m.cols + x) === 48) return true;
      }
      return false;
    }

    function cellFogged(x, y) {
      var m = r.map, s = r.scene;
      if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) return true;
      return s.fog.charCodeAt(y * m.cols + x) !== 48;
    }
    function cellRevealed(x, y) {
      var m = r.map;
      if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) return false;
      return r.scene.fog.charCodeAt(y * m.cols + x) === 48;
    }
    function doorSeen(d) {
      var horiz = Math.abs(d.y2 - d.y1) < 1e-6, k;
      if (horiz) {
        var y = Math.round(d.y1), xa = Math.floor(Math.min(d.x1, d.x2) + 1e-6), xb = Math.ceil(Math.max(d.x1, d.x2) - 1e-6);
        for (k = xa; k < xb; k++) if (cellRevealed(k, y - 1) || cellRevealed(k, y)) return true;
      } else {
        var x = Math.round(d.x1), ya = Math.floor(Math.min(d.y1, d.y2) + 1e-6), yb = Math.ceil(Math.max(d.y1, d.y2) - 1e-6);
        for (k = ya; k < yb; k++) if (cellRevealed(x - 1, k) || cellRevealed(x, k)) return true;
      }
      return false;
    }
    function drawDoors(m, s, ox, oy, px) {
      ctx.save();
      ctx.lineCap = 'butt';
      m.geo.doors.forEach(function (d, i) {
        if (!gm && !doorSeen(d)) return;
        var open = !!(s.doors && s.doors[i]);
        var dx = d.x2 - d.x1, dy = d.y2 - d.y1, len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-6) return;
        var ux = dx / len, uy = dy / len;
        if (open) {
          var ang = 75 * Math.PI / 180, c = Math.cos(ang), sn = Math.sin(ang);
          var rx = ux * c - uy * sn, ry = ux * sn + uy * c; // +75°
          var horiz = Math.abs(dy) < Math.abs(dx);
          if (horiz ? ry < 0 : rx < 0) { rx = ux * c + uy * sn; ry = -ux * sn + uy * c; }
          ux = rx; uy = ry;
        }
        var ins = Math.min(0.1, len / 4), L = len - 0.2 < 0.1 ? len / 2 : len - 0.2;
        var ax = d.x1 + ux * ins, ay = d.y1 + uy * ins, bx = ax + ux * L, by = ay + uy * L;
        var sx = ox + ax * px, sy = oy + ay * px, ex = ox + bx * px, ey = oy + by * px;
        var th = Math.max(2, 0.18 * px);
        ctx.strokeStyle = '#2a1808'; ctx.lineWidth = th + Math.max(2, th * 0.3);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = '#a07040'; ctx.lineWidth = th;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        if (gm) {
          var a = { x: ox + d.x1 * px, y: oy + d.y1 * px }, b = { x: ox + d.x2 * px, y: oy + d.y2 * px };
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.strokeStyle = open ? '#3fb950' : '#f85149'; ctx.lineWidth = 2;
          if (open) ctx.setLineDash([8, 6]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.setLineDash([]); ctx.lineCap = 'butt';
        }
      });
      ctx.restore();
    }

    function drawRuler(px) {
      var rl = r.ruler;
      if (!rl || !rl.path || !rl.path.length) return;
      var off = (rl.size || 1) / 2;
      var pts = rl.path.map(function (p) { return r.cellToScreen(p.x + off, p.y + off); });
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 7;
      ctx.beginPath();
      pts.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      ctx.strokeStyle = rl.color || '#3fb950'; ctx.lineWidth = 4;
      if (rl.free) ctx.setLineDash([10, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rl.color || '#3fb950';
      pts.forEach(function (p, i) {
        ctx.beginPath(); ctx.arc(p.x, p.y, i === pts.length - 1 ? 6 : 3, 0, 6.2832); ctx.fill();
      });
      var e = pts[pts.length - 1];
      if (rl.label) {
        ctx.font = 'bold 15px system-ui, sans-serif';
        var tw = ctx.measureText(rl.label).width + 16;
        var lx = e.x - tw / 2, ly = e.y - px * 0.5 - 30;
        ctx.fillStyle = 'rgba(13,17,23,.92)';
        ctx.strokeStyle = rl.color || '#3fb950'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(lx, ly, tw, 26, 8); else ctx.rect(lx, ly, tw, 26);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(rl.label, e.x, ly + 13.5);
      }
      ctx.restore();
    }

    function drawPings(now) {
      var m = r.map;
      r.pings = r.pings.filter(function (p) { return now - p.t0 < 1500; });
      r.pings.forEach(function (p) {
        var sp = r.cellToScreen(p.x, p.y);
        var k = (now - p.t0) / 1500;
        for (var i = 0; i < 3; i++) {
          var kk = k - i * 0.18;
          if (kk <= 0 || kk >= 1) continue;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, (0.2 + kk * 1.6) * m.ppg * r.camera.scale, 0, 6.2832);
          ctx.strokeStyle = 'rgba(255,220,60,' + (1 - kk).toFixed(2) + ')';
          ctx.lineWidth = 4 * (1 - kk) + 1;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 5, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,220,60,' + (1 - k).toFixed(2) + ')';
        ctx.fill();
      });
    }

    function frame() {
      scheduled = false;
      var now = performance.now();
      if (anim) {
        var k = Math.min(1, (now - anim.t0) / anim.dur);
        var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        var a = anim.from, b = anim.to;
        r.camera = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, scale: a.scale + (b.scale - a.scale) * e };
        if (k >= 1) anim = null;
      }
      draw(now);
      dirty = false;
      var need = anim || r.pings.length;
      if (!need && r.scene && r.map) {
        var ts = r.scene.tokens;
        for (var i = 0; i < ts.length; i++) {
          if (ts[i].status === 'incapacitated' && (gm || !ts[i].hidden)) { need = true; break; }
        }
      }
      if (need || dirty) { scheduled = true; requestAnimationFrame(frame); }
    }

    function draw(now) {
      if (!W) r.resize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
      var m = r.map, s = r.scene;
      if (!m) return;
      var sc = r.camera.scale, ppg = m.ppg;
      var ox = -r.camera.x * sc, oy = -r.camera.y * sc;
      var mw = m.cols * ppg * sc, mh = m.rows * ppg * sc;
      var px = ppg * sc;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var ig = imgGrid(m);
      if (m.image) ctx.drawImage(m.image, ox - ig.x * sc, oy - ig.y * sc, ig.width * sc, ig.height * sc);
      else { ctx.fillStyle = '#222'; ctx.fillRect(ox, oy, mw, mh); }
      if (m.meta && m.meta.editor_overlay) ctx.drawImage(overlayCanvas(m), ox, oy, mw, mh);
      if (!s) return;

      // сетка
      var showGrid = gm ? s.settings.gridGM : s.settings.gridPlayer;
      if (showGrid && px > 6) {
        ctx.beginPath();
        for (var gx = 0; gx <= m.cols; gx++) { ctx.moveTo(Math.round(ox + gx * px) + 0.5, oy); ctx.lineTo(Math.round(ox + gx * px) + 0.5, oy + mh); }
        for (var gy = 0; gy <= m.rows; gy++) { ctx.moveTo(ox, Math.round(oy + gy * px) + 0.5); ctx.lineTo(ox + mw, Math.round(oy + gy * px) + 0.5); }
        ctx.strokeStyle = 'rgba(255,255,255,.22)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // токены
      var td = VTT.tokensDraw;
      var tokens = s.tokens;
      function visibleFor(t) {
        if (gm) return true;
        if (t.hidden) return false;
        return footprintVisible(t);
      }
      var turnId = s.combat ? (s.combat.active ? s.combat.turnId : null) : (s.turnId || null);
      function drawT(t) {
        td.drawToken(ctx, t, px, ox + t.x * px, oy + t.y * px, {
          gm: gm, selected: gm && t.id === r.selectedId, dragging: t.id === r.dragId, turn: !!turnId && t.id === turnId
        });
      }
      tokens.forEach(function (t) { if (t.status === 'dead' && visibleFor(t)) drawT(t); });
      tokens.forEach(function (t) { if (t.status !== 'dead' && visibleFor(t)) drawT(t); });

      // туман
      updateFog();
      if (fogCanvas) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = gm ? 0.4 : 1;
        ctx.drawImage(fogCanvas, ox, oy, mw, mh);
        ctx.restore();
      }

      // подписи (после тумана; игрокам — только в открытых клетках)
      var showLabels = gm ? s.settings.labelsGM !== false : s.settings.labelsPlayer !== false;
      if (showLabels && m.labels && m.labels.length) {
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        m.labels.forEach(function (lb) {
          if (!lb || !lb.text) return;
          if (!gm && cellFogged(Math.floor(lb.x), Math.floor(lb.y))) return;
          var fpx = (lb.size || (lb.kind === 'area' ? 0.42 : 0.26)) * px;
          if (fpx < 4) return;
          ctx.font = (lb.kind === 'area' ? 'italic ' : '') + fpx.toFixed(1) + "px Georgia, 'Times New Roman', serif";
          ctx.lineWidth = fpx * 0.21;
          ctx.strokeStyle = '#000'; ctx.fillStyle = '#f3e6c4';
          var lx = ox + lb.x * px, ly = oy + lb.y * px;
          ctx.strokeText(lb.text, lx, ly);
          ctx.fillText(lb.text, lx, ly);
        });
        ctx.restore();
      }

      // двери
      if ((!gm || r.showDoors) && m.geo && m.geo.doors) drawDoors(m, s, ox, oy, px);

      if (r.ruler && (gm || s.settings.rulerToPlayers !== false)) drawRuler(px);
      if (r.pings.length) drawPings(now);
      if (r.overlay) { ctx.save(); r.overlay(ctx, r); ctx.restore(); }
    }

    if (window.ResizeObserver) new ResizeObserver(function () { r.resize(); }).observe(canvas);
    window.addEventListener('resize', function () { r.resize(); });
    all.push(r);
    r.resize();
    return r;
  }

  VTT.render = { createRenderer: createRenderer };
  if (VTT.tokensDraw) VTT.tokensDraw.onload = function () { all.forEach(function (r) { r.requestDraw(); }); };
})();
