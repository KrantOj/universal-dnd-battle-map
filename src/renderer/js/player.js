/* VTT.player — режим игроков: только канвас */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var r = null, map = null, scene = null, images = {}, pendingState = null;
  var lastState = null, lastBox = '', hideTimer = null, helloTimer = null;
  var splash = null;

  function defaults() {
    return { diagonal: '5', autoReveal: true, gridGM: false, gridPlayer: false, playerView: 'fit-map', rulerToPlayers: true, showQueue: false };
  }

  var mapKey = '';
  function applyMap(msg) {
    // Мастер шлёт карту при открытии окна несколько раз (таймер, hello, повторы). Повтор той же карты игнорируем:
    // иначе он сбрасывал туман в «всё закрыто» уже после того, как пришло правильное состояние, и экран оставался тёмным.
    var key = msg.name + '|' + msg.cols + 'x' + msg.rows + '|' + (msg.image || '');
    if (key === mapKey) return;
    mapKey = key;
    var im = new Image();
    im.onload = function () {
      if (key !== mapKey) return;     // за это время пришла другая карта
      map = { name: msg.name, cols: msg.cols, rows: msg.rows, ppg: msg.ppg, image: im,
        imageGrid: msg.imageGrid || null, labels: msg.labels || [], portals: msg.portals || [],
        geo: { doors: msg.geoDoors || [], walls: [] } };
      scene = { tokens: [], fog: '1'.repeat(msg.cols * msg.rows), doors: [], round: 1, settings: defaults() };
      lastBox = '';
      r.setMap(map);
      r.setScene(scene);
      r.fit();
      splash.style.display = 'none';
      // состояние могло прийти до конца загрузки картинки — применяем его (или последнее известное) сразу
      var s = pendingState || lastState; pendingState = null;
      if (s && s.fog && s.fog.length === msg.cols * msg.rows) applyState(s);
    };
    im.src = msg.image;
  }

  function revealedBox() {
    var f = scene.fog, c = map.cols, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (var i = 0; i < f.length; i++) {
      if (f.charCodeAt(i) === 48) {
        var x = i % c, y = (i / c) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    return { x0: Math.max(0, x0 - 1), y0: Math.max(0, y0 - 1), x1: Math.min(map.cols, x1 + 2), y1: Math.min(map.rows, y1 + 2) };
  }

  function applyView(force) {
    if (!map || !scene || !lastState) return;
    var mode = scene.settings.playerView;
    var key;
    if (mode === 'fit-map') {
      key = 'map';
      if (force || lastBox !== key) { lastBox = key; r.fit(null, force === 'instant' ? 0 : 400); }
    } else if (mode === 'fit-revealed') {
      var b = revealedBox();
      key = 'rev:' + (b ? [b.x0, b.y0, b.x1, b.y1].join(',') : 'none');
      if (force || lastBox !== key) { lastBox = key; r.fit(b, force === 'instant' ? 0 : 400); }
    } else {
      var v = lastState.view;
      key = 'gm:' + (v ? [v.cx.toFixed(2), v.cy.toFixed(2), v.cellsW.toFixed(2)].join(',') : 'none');
      if (v && (force || lastBox !== key)) {
        lastBox = key;
        var cam = r.viewToCamera(v);
        if (cam) r.flyTo(cam, 400);
      }
    }
  }

  function applyState(msg) {
    // нет карты или туман от другой карты (размер не совпал) — ждём загрузки карты
    if (!map || (msg.fog && msg.fog.length !== map.cols * map.rows)) { pendingState = msg; return; }
    lastState = msg;
    var prevMode = scene.settings.playerView;
    scene = {
      tokens: (msg.tokens || []).map(function (t) {
        var c = Object.assign({}, t);
        if (images[t.id]) c.image = images[t.id];
        return c;
      }),
      fog: msg.fog,
      doors: msg.doors || [],
      round: msg.round,
      turnId: msg.turnId || null,
      settings: Object.assign(defaults(), msg.settings || {})
    };
    if (scene.settings.playerView !== prevMode) lastBox = '';
    r.setScene(scene);
    applyView();
    renderQueue(msg.queue, msg.round);
  }

  // ---- очередь ходов (показывается, только если мастер включил) ----
  var qEl = null, qKey = '';
  function renderQueue(q, round) {
    if (!q || !q.length) { if (qEl) qEl.classList.remove('on'); qKey = ''; return; }
    var key = JSON.stringify([q, round, Object.keys(images).length]);
    if (key === qKey) return;
    qKey = key;
    if (!qEl) { qEl = document.createElement('div'); qEl.id = 'queueShow'; document.body.appendChild(qEl); }
    qEl.textContent = '';
    var h = document.createElement('div'); h.className = 'q-h'; h.textContent = 'Раунд ' + round; qEl.appendChild(h);
    q.forEach(function (t) {
      var row = document.createElement('div'); row.className = 'q-i k-' + t.kind + (t.turn ? ' turn' : '');
      var av = document.createElement('span'); av.className = 'q-av'; av.style.background = t.color || '#555';
      if (t.hasImage && images[t.id]) { av.style.backgroundImage = 'url(' + images[t.id] + ')'; }
      else av.textContent = t.label || '';
      var nm = document.createElement('span'); nm.className = 'q-nm'; nm.textContent = t.name;
      row.appendChild(av); row.appendChild(nm); qEl.appendChild(row);
    });
    qEl.classList.add('on');
  }

  // ---- Показ (портреты, гербы, карты) ----
  var FADE = 400;
  var sc = { layer: null, imgs: [], cap: null, cur: -1, seq: 0, urls: [null, null], timer: null };

  function buildShowcase() {
    if (sc.layer) return;
    var layer = document.createElement('div');
    layer.id = 'showcase';
    for (var i = 0; i < 2; i++) {
      var im = document.createElement('img');
      im.alt = ''; im.draggable = false;
      layer.appendChild(im);
      sc.imgs.push(im);
    }
    sc.cap = document.createElement('div');
    sc.cap.className = 'sc-cap';
    layer.appendChild(sc.cap);
    document.body.appendChild(layer);
    sc.layer = layer;
  }

  function freeSlot(i) {
    var im = sc.imgs[i];
    im.classList.remove('cur');
    im.removeAttribute('src');
    if (sc.urls[i]) { try { URL.revokeObjectURL(sc.urls[i]); } catch (e) {} sc.urls[i] = null; }
  }

  function showItem(item) {
    buildShowcase();
    var seq = ++sc.seq;
    clearTimeout(sc.timer);
    if (!item) {
      sc.layer.classList.remove('on');
      sc.cap.classList.remove('on');
      sc.cur = -1;
      sc.timer = setTimeout(function () {
        if (seq !== sc.seq) return;
        freeSlot(0); freeSlot(1); sc.cap.textContent = '';
      }, FADE + 50);
      return;
    }
    var slot = sc.cur === 0 ? 1 : 0;           // свободный слот (не текущий)
    var im = sc.imgs[slot];
    // после «убрать показ» оба слота могли остаться с картинкой (таймер очистки отменён) — второй гасим сразу
    if (sc.cur < 0) freeSlot(1 - slot);
    var url = item.url;
    if (!url) return;
    var obj = null;
    // слот мог ещё гаснуть от прошлой смены — освобождаем без анимации
    im.style.transition = 'none';
    freeSlot(slot);
    void im.offsetWidth;
    im.style.transition = '';
    sc.urls[slot] = obj;

    function go() {
      if (seq !== sc.seq) return;               // пришёл более новый показ
      var old = sc.cur;
      sc.cur = slot;
      im.classList.add('cur');
      if (old >= 0) {
        sc.imgs[old].classList.remove('cur');
        sc.timer = setTimeout(function () { if (seq === sc.seq) freeSlot(old); }, FADE + 50);
      }
      var capOn = !!(item.caption && item.title);
      sc.cap.textContent = capOn ? item.title : '';
      sc.cap.classList.toggle('on', capOn);
      sc.layer.classList.add('on');
    }
    function fail() {
      if (seq !== sc.seq) { if (sc.urls[slot] === obj && obj) { /* уже освобождён новым показом */ } return; }
      freeSlot(slot);
    }
    im.onload = null; im.onerror = null;
    im.src = url;
    if (im.decode) im.decode().then(go, function () { if (seq === sc.seq && im.complete && im.naturalWidth) go(); else fail(); });
    else { im.onload = go; im.onerror = fail; }
  }

  function receive(msg) {
    if (!msg || !msg.t) return;
    if (helloTimer && msg.t === 'map') { clearInterval(helloTimer); helloTimer = null; }
    switch (msg.t) {
      case 'show': showItem(msg.item || null); break;
      case 'map': applyMap(msg); break;
      case 'state': applyState(msg); break;
      case 'images':
        Object.keys(msg.images || {}).forEach(function (id) {
          images[id] = msg.images[id];
          if (scene) scene.tokens.forEach(function (t) { if (t.id === id) t.image = images[id]; });
        });
        if (r) r.requestDraw();
        break;
      case 'ruler':
        if (r) { r.ruler = msg.ruler || null; r.requestDraw(); }
        break;
      case 'ping':
        if (r) { r.pings.push({ x: msg.x, y: msg.y, t0: performance.now() }); r.requestDraw(); }
        break;
      case 'roll': showRoll(msg); break;
    }
  }

  // ---- бросок кубиков, показанный мастером ----
  var rollEl = null, rollTimer = null, rollQ = [], rollBusy = false;
  // броски идут по очереди (инициатива всей партии), каждый виден ~2,5 с; одиночный — 5 с
  function showRoll(msg) {
    rollQ.push(msg);
    if (!rollBusy) nextRoll();
  }
  function nextRoll() {
    var msg = rollQ.shift();
    if (!msg) { rollBusy = false; return; }
    rollBusy = true;
    displayRoll(msg, rollQ.length ? 2700 : 5200);
  }
  var rollLand = null, rollFlick = null;
  var THROW_MS = 1150;   // длительность броска (CSS-анимация rsThrow в combat.css)
  function q(sel) { return rollEl.querySelector(sel); }
  // Кубик влетает, кувыркается, подпрыгивает и замирает на результате (как в Baldur's Gate 3); числа на нём мелькают.
  function displayRoll(msg, ms) {
    if (!rollEl) {
      rollEl = document.createElement('div');
      rollEl.id = 'rollShow';
      rollEl.innerHTML = '<div class="rs-who"></div><div class="rs-stage"><div class="rs-burst"></div><div class="rs-die"></div><div class="rs-num"></div></div>' +
        '<div class="rs-badge"></div><div class="rs-text"></div>';
      document.body.appendChild(rollEl);
    }
    clearTimeout(rollTimer); clearTimeout(rollLand); clearInterval(rollFlick);
    var sides = msg.sides || 20, num = q('.rs-num');
    q('.rs-who').textContent = (msg.who ? msg.who + ' · ' : '') + (msg.expr || '');
    q('.rs-die').innerHTML = VTT.dice.svg(sides, { label: '' });
    q('.rs-badge').textContent = ''; q('.rs-text').textContent = '';
    num.textContent = ''; num.removeAttribute('data-len');
    rollEl.classList.remove('landed', 'nat20', 'nat1', 'throw', 'on');
    void rollEl.offsetWidth;                                  // перезапуск CSS-анимации
    rollEl.classList.add('on', 'throw');
    rollFlick = setInterval(function () { num.textContent = String(1 + Math.floor(Math.random() * sides)); }, 55);
    rollLand = setTimeout(function () {
      clearInterval(rollFlick);
      var tot = String(msg.total);
      num.textContent = tot; num.setAttribute('data-len', String(Math.min(tot.length, 4)));
      rollEl.classList.add('landed');
      if (msg.d20 === 20) { rollEl.classList.add('nat20'); q('.rs-badge').textContent = 'Критический успех!'; }
      else if (msg.d20 === 1) { rollEl.classList.add('nat1'); q('.rs-badge').textContent = 'Критический провал'; }
      q('.rs-text').textContent = msg.text || '';
    }, THROW_MS);
    rollTimer = setTimeout(function () {
      clearInterval(rollFlick);
      if (rollQ.length) nextRoll();
      else { rollEl.classList.remove('on'); rollBusy = false; }
    }, Math.max(ms, THROW_MS + 1200));
  }

  function toggleFullscreen() {
    try { window.host.windows.togglePlayerFullscreen(); } catch (e) { /* ignore */ }
  }

  VTT.player = {
    init: function () {
      document.body.classList.add('player');
      var canvas = document.getElementById('canvas');
      splash = document.getElementById('splash');
      buildShowcase();
      r = VTT.render.createRenderer(canvas, { mode: 'player' });
      r.onresize = function () { if (map && scene) { lastBox = ''; applyView('instant'); } };
      VTT.sync.listen(receive);
      VTT.sync.hello();
      helloTimer = setInterval(VTT.sync.hello, 500);   // пока карты нет — просим чаще, чтобы окно не висело тёмным

      window.addEventListener('dblclick', toggleFullscreen);
      window.addEventListener('keydown', function (e) { if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') toggleFullscreen(); });
      function wake() {
        document.body.classList.remove('idle');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { document.body.classList.add('idle'); }, 2000);
      }
      window.addEventListener('mousemove', wake);
      wake();
    },
    _receive: receive,
    _renderer: function () { return r; }
  };
})();
