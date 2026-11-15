/* VTT.dice3d — 3D-анимация броска кубиков (three.js, модели из STL → dice-models.js).
 *
 * Результат броска УЖЕ известен (его считает dice.js); здесь только показываем: кубик кувыркается,
 * замедляется и останавливается нужной гранью к зрителю. Физики нет — траектория сценарная, но выглядит живо.
 *
 *   VTT.dice3d.available(dice)  → true, если все кубики формулы можно показать (иначе — запасной 2D-вариант)
 *   VTT.dice3d.play(canvas, dice, { cx, cy, size, fast, onLand }) → { landMs, stop() }
 *     dice = [{ s: граней, v: выпавшее, k: учитывается ли (false — отброшенный кубик, по приземлении тускнеет) }]
 *     cx, cy — центр сцены в пикселях окна, size — «диаметр» одиночного кубика в px.
 *   VTT.dice3d.expand(dice) — чистая функция (без WebGL): раскладка d100 на два d10 и подписи граней (для тестов).
 */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var MODEL_KEY = { 2: 'd2', 4: 'd4', 6: 'd6', 8: 'd8', 10: 'd10', 12: 'd12', 20: 'd20', 100: 'd10' };
  var MAX_DICE = 10;      // больше — не успеем нормально показать, ведущий 2D-режим
  var BODY = 0x2b3a56, EDGE = 0xb89f5a, GOLD = '#f6e7b8';

  // ------------------------------------------------------------ чистая логика (без WebGL)
  // подпись грани по значению v (1..N) и режиму кубика
  function faceLabel(mode, v) {
    if (mode === 'tens') return (v % 10 === 0) ? '00' : (v % 10) + '0';
    if (mode === 'units' || mode === 'd10') return v === 10 ? '0' : String(v);
    return String(v);
  }
  // [{s,v,k}] → [{ key, mode, v (значение грани 1..N), k }]; d100 → десятки + единицы
  function expand(dice) {
    var out = [];
    (dice || []).forEach(function (d) {
      if (d.s === 100) {
        var r = d.v === 100 ? 0 : d.v, t = Math.floor(r / 10), u = r % 10;
        out.push({ key: 'd10', mode: 'tens', v: t === 0 ? 10 : t, k: d.k !== false });
        out.push({ key: 'd10', mode: 'units', v: u === 0 ? 10 : u, k: d.k !== false });
      } else {
        out.push({ key: MODEL_KEY[d.s], mode: d.s === 10 ? 'd10' : 'plain', v: d.v, k: d.k !== false });
      }
    });
    return out;
  }
  function supportedSides(s) { return !!MODEL_KEY[s]; }
  function plan(dice) {
    if (!dice || !dice.length) return null;
    var i;
    for (i = 0; i < dice.length; i++) if (!supportedSides(dice[i].s)) return null;
    var list = expand(dice);
    return list.length > MAX_DICE ? null : list;
  }

  // ------------------------------------------------------------ WebGL
  var failed = false, renderer = null, canvasOf = null;
  var geoCache = {}, texCache = {};

  function T() { return window.THREE; }

  function ensureRenderer(canvas) {
    if (renderer && canvasOf === canvas) return renderer;
    try {
      if (renderer) { renderer.dispose(); renderer = null; }
      renderer = new (T().WebGLRenderer)({ canvas: canvas, alpha: true, antialias: true });
      canvasOf = canvas;
      renderer.setClearColor(0x000000, 0);
    } catch (e) {
      failed = true; renderer = null;
      return null;
    }
    return renderer;
  }

  function available(dice) {
    return !failed && !!T() && !!VTT.diceModels && !!plan(dice);
  }

  function bodyGeometry(key) {
    if (geoCache[key]) return geoCache[key];
    var m = VTT.diceModels[key], g = new (T().BufferGeometry)();
    g.setAttribute('position', new (T().BufferAttribute)(new Float32Array(m.pos), 3));
    g.computeVertexNormals();                              // не индексирована → плоское затенение по граням
    geoCache[key] = { geo: g, edges: new (T().EdgesGeometry)(g, 12) };
    return geoCache[key];
  }

  function labelTexture(text) {
    if (texCache[text]) return texCache[text];
    var c = document.createElement('canvas'), n = 256;
    c.width = c.height = n;
    var x = c.getContext('2d'), two = text.length > 1;
    var fs = two ? 132 : 170;
    x.font = '700 ' + fs + 'px Georgia, "Times New Roman", serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 14; x.strokeStyle = 'rgba(0,0,0,.55)';
    x.strokeText(text, n / 2, n / 2 + 6);
    x.fillStyle = GOLD;
    x.fillText(text, n / 2, n / 2 + 6);
    if (/^[69]0?$/.test(text)) {                         // 6/9 не спутать: подчёркивание
      var w = x.measureText(text).width;
      x.fillRect(n / 2 - w / 2, n / 2 + fs * 0.42, w, 12);
    }
    var tex = new (T().CanvasTexture)(c);
    tex.anisotropy = 4;
    texCache[text] = tex;
    return tex;
  }

  // ориентация: грань с нормалью n и «верхом» u → к зрителю (+Z), верх цифры → +Y
  function faceToCamera(face) {
    var THREE = T(), n = new THREE.Vector3().fromArray(face.n), u = new THREE.Vector3().fromArray(face.u);
    var x = new THREE.Vector3().crossVectors(u, n).normalize();
    var m = new THREE.Matrix4().makeBasis(x, u, n);
    return new THREE.Quaternion().setFromRotationMatrix(m).invert();
  }

  function buildDie(spec) {
    var THREE = T(), model = VTT.diceModels[spec.key], g = bodyGeometry(spec.key);
    var root = new THREE.Group(), mats = [];
    var bodyMat = new THREE.MeshStandardMaterial({ color: BODY, metalness: 0.45, roughness: 0.38, flatShading: true, transparent: true });
    root.add(new THREE.Mesh(g.geo, bodyMat)); mats.push(bodyMat);
    var lineMat = new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.85 });
    root.add(new THREE.LineSegments(g.edges, lineMat)); mats.push(lineMat);
    var target = null;
    model.faces.forEach(function (f) {
      if (f.v === spec.v) target = f;
      var mat = new THREE.MeshBasicMaterial({ map: labelTexture(faceLabel(spec.mode, f.v)), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      mats.push(mat);
      var side = f.r * 1.75;
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(side, side), mat);
      var n = new THREE.Vector3().fromArray(f.n), u = new THREE.Vector3().fromArray(f.u);
      var x = new THREE.Vector3().crossVectors(u, n).normalize();
      plane.matrixAutoUpdate = false;
      plane.matrix.makeBasis(x, u, n).setPosition(new THREE.Vector3().fromArray(f.c).addScaledVector(n, 0.004));
      root.add(plane);
    });
    return { root: root, mats: mats, face: target, radius: 1 };
  }

  function easeOut(p, k) { return 1 - Math.pow(1 - p, k); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  var BASE_MS = 1150, FAST_MS = 800;

  function play(canvas, dice, o) {
    o = o || {};
    var THREE = T(), list = plan(dice);
    var r = list && ensureRenderer(canvas);
    if (!r) return null;
    var W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.setPixelRatio(dpr); r.setSize(W, H, false);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    var scene = new THREE.Scene(), CAMZ = 7, fov = 32;
    var cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 50);
    cam.position.set(0, 0, CAMZ);
    var visH = 2 * CAMZ * Math.tan(fov * Math.PI / 360), ppu = H / visH;   // пикселей на единицу мира в плоскости z=0
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.9));
    var key = new THREE.DirectionalLight(0xfff0d0, 1.5); key.position.set(-2.5, 4, 6); scene.add(key);
    var rim = new THREE.DirectionalLight(0x6f8cff, 0.6); rim.position.set(4, -2, 3); scene.add(rim);

    var n = list.length;
    var cols = n <= 3 ? n : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols);
    var size = (o.size || Math.min(0.5 * H, 300)) * (n <= 1 ? 1 : n <= 2 ? 0.8 : n <= 4 ? 0.64 : n <= 6 ? 0.52 : 0.44);
    size = Math.min(size, W * 0.92 / (cols * 1.12), H * 0.7 / (rows * 1.12));   // в узком окне ряд не должен вылезать за край
    var unit = size / 2 / ppu;                                  // единиц мира на единицу модели (радиус ≈ 1)
    var cell = size * 1.12, ms = o.fast ? FAST_MS : BASE_MS, stagger = Math.min(0.06 * ms, 70);
    var cx = o.cx == null ? W / 2 : o.cx, cy = o.cy == null ? H / 2 : o.cy;

    var dies = list.map(function (spec, i) {
      var d = buildDie(spec), row = Math.floor(i / cols), inRow = (row === rows - 1) ? n - row * cols : cols;
      var col = i - row * cols;
      var px = cx + (col - (inRow - 1) / 2) * cell, py = cy + (row - (rows - 1) / 2) * cell;
      d.rest = new THREE.Vector3((px - W / 2) / ppu, -(py - H / 2) / ppu, 0);
      var tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-0.22, 0.05), rnd(-0.3, 0.3), 0));
      d.qFinal = tilt.multiply(faceToCamera(d.face));
      d.axis = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-0.6, 0.6)).normalize();
      d.spin = (rnd(2.2, 3.4) + i * 0.15) * Math.PI * 2 * (Math.random() < 0.5 ? -1 : 1);
      d.from = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * rnd(0.25, 0.5) * W / ppu, rnd(0.25, 0.45) * H / ppu * (Math.random() < 0.7 ? 1 : -0.3), 0);
      d.delay = i * stagger;
      d.root.scale.setScalar(unit);
      d.spec = spec;
      scene.add(d.root);
      return d;
    });

    var t0 = performance.now(), raf = 0, stopped = false, landed = false, qs = new THREE.Quaternion();
    var total = ms + (n - 1) * stagger;

    function frame(now) {
      if (stopped) return;
      var el = now - t0, i, d, p, e;
      for (i = 0; i < dies.length; i++) {
        d = dies[i];
        p = Math.min(1, Math.max(0, (el - d.delay) / ms));
        e = easeOut(p, 3);
        var bounce = (1 - p) * (1 - p) * Math.abs(Math.sin(Math.PI * 2.4 * p)) * 0.55;
        d.root.position.set(d.rest.x + d.from.x * (1 - e), d.rest.y + d.from.y * (1 - e) + bounce * (H / ppu) * 0.22, 2.4 * (1 - easeOut(p, 2)) + bounce * 1.2);
        qs.setFromAxisAngle(d.axis, d.spin * (1 - easeOut(p, 4)));
        d.root.quaternion.copy(qs).multiply(d.qFinal);
        d.root.visible = el >= d.delay;
      }
      r.render(scene, cam);
      if (el < total) { raf = requestAnimationFrame(frame); return; }
      if (!landed) {
        landed = true;
        dies.forEach(function (dd) {
          if (!dd.spec.k) dd.mats.forEach(function (m) { m.opacity = 0.32; });   // отброшенный кубик тускнеет
        });
        r.render(scene, cam);
        if (o.onLand) o.onLand();
      }
    }
    raf = requestAnimationFrame(frame);

    return {
      landMs: Math.round(total),
      stop: function () {
        stopped = true; cancelAnimationFrame(raf);
        dies.forEach(function (d) {
          scene.remove(d.root);
          d.root.traverse(function (obj) { if (obj.geometry && obj.geometry.type === 'PlaneGeometry') obj.geometry.dispose(); });
          d.mats.forEach(function (m) { m.dispose(); });
        });
        r.clear();
      }
    };
  }

  VTT.dice3d = { available: available, play: play, expand: expand, plan: plan, faceLabel: faceLabel, MAX_DICE: MAX_DICE, BASE_MS: BASE_MS };
})();
