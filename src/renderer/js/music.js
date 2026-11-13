/* VTT.music — музыкальный плеер мастера. Звук идёт только в окне мастера (окну игроков ничего не передаётся).
 *
 * Источник: корень `music` кампании. Плейлист = подпапка первого уровня; файлы в корне = «Без папки».
 * Два <audio> (A/B) дают кроссфейд; устройство вывода — audio.setSinkId (запоминается глобально: settings.musicSink).
 * Состояние кампании — kv-ключ `music` (плейлист, трек, позиция, громкость, перемешивание, повтор, кроссфейд).
 * Горячие клавиши — только внутри окна (settings.musicKeys), не глобальные. Чистая логика — music-logic.js. */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var L = VTT.musicLogic;
  var tr = VTT.i18n.t;
  var H = function () { return window.host; };
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function toast(m, ms) { if (VTT.gm && VTT.gm._api) VTT.gm._api.toast(m, ms || 3500); }

  var S = {
    camp: null, hasRoot: false, lists: [], listId: null,
    order: [], pos: -1,             // порядок воспроизведения (индексы треков плейлиста) и позиция в нём
    shuffle: false, repeat: 'off', volume: 0.8, xfade: 2, collapsed: false,
    playing: false, loaded: null,   // rel трека, загруженного в активный <audio>
    keys: L.mergeKeys(null), sinkWanted: '', sinkActive: '', devices: [],
    seeking: false, failStreak: 0, scanSeq: 0, ready: false
  };
  var A = [new Audio(), new Audio()];
  var cur = 0;                      // индекс активного <audio>
  var G = [1, 1];                   // множители громкости каждого элемента (кроссфейд)
  var F = null;                     // переход: {from, to, t0, dur}
  var advancing = false;            // автопереход уже запущен для текущего трека
  var saveTimer = null, tickTimer = null, built = false, restore = null;

  // ------------------------------------------------------------------ вспомогательное
  function curList() { for (var i = 0; i < S.lists.length; i++) if (S.lists[i].id === S.listId) return S.lists[i]; return null; }
  function trackAt(pos) { var l = curList(); return l && pos >= 0 && pos < S.order.length ? l.tracks[S.order[pos]] : null; }
  function curTrack() { return trackAt(S.pos); }
  function listName(l) { return l.id === L.ROOT_ID ? tr('music.rootList') : l.name; }
  function urlOf(t) { return H().fs.url('music', t.rel); }
  function applyVolume() {
    for (var i = 0; i < 2; i++) A[i].volume = Math.max(0, Math.min(1, S.volume * G[i]));
  }

  // ------------------------------------------------------------------ сохранение состояния кампании
  function snapshot() {
    var t = curTrack();
    return { playlist: S.listId, track: t ? t.rel : (S.loaded || null), pos: Math.round((A[cur].currentTime || 0) * 10) / 10,
      volume: Math.round(S.volume * 100) / 100, shuffle: S.shuffle, repeat: S.repeat, crossfade: S.xfade, collapsed: S.collapsed };
  }
  function persist() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!S.camp || !S.ready) return;
    try { Promise.resolve(H().kv.set('music', snapshot())).catch(function () {}); } catch (e) { /* ignore */ }
  }
  function persistSoon() { if (!saveTimer) saveTimer = setTimeout(persist, 400); }

  // ------------------------------------------------------------------ воспроизведение
  function finishFade() {
    if (!F) return;
    try { F.from.pause(); } catch (e) { /* ignore */ }
    G[A.indexOf(F.from)] = 1; G[A.indexOf(F.to)] = 1;
    F = null; applyVolume();
  }
  function tickFade() {
    if (!F) return;
    var p = (Date.now() - F.t0) / (F.dur * 1000);
    if (p >= 1) { finishFade(); return; }
    var g = L.fadeGains(p);
    G[A.indexOf(F.from)] = g.out; G[A.indexOf(F.to)] = g.in;
    applyVolume();
  }

  function stopAll() {
    finishFade();
    A.forEach(function (a) { try { a.pause(); } catch (e) { /* ignore */ } });
    S.playing = false; advancing = false;
  }

  /** Запустить трек на позиции pos порядка. o: {fade, seek} */
  function go(pos, o) {
    o = o || {};
    var t = trackAt(pos);
    if (!t) { stopAll(); renderAll(); return Promise.resolve(); }
    var prev = A[cur], wasPlaying = S.playing && !prev.paused;
    finishFade();
    var idx = 1 - cur, next = A[idx];
    var xf = L.effectiveXfade(S.xfade, prev.duration);
    var fade = !!o.fade && wasPlaying && xf > 0;
    S.pos = pos; S.loaded = t.rel; S.playing = true; advancing = false;
    G[idx] = fade ? 0 : 1; G[cur] = fade ? 1 : G[cur];
    next.src = urlOf(t);
    if (o.seek > 0) {
      var onMeta = function () { next.removeEventListener('loadedmetadata', onMeta); try { next.currentTime = o.seek; } catch (e) { /* ignore */ } };
      next.addEventListener('loadedmetadata', onMeta);
    }
    if (!fade) { try { prev.pause(); } catch (e) { /* ignore */ } G[cur] = 1; }
    var from = prev;
    cur = idx;
    if (fade) F = { from: from, to: next, t0: Date.now(), dur: xf };
    applyVolume();
    renderAll();
    var pr = next.play();
    if (pr && pr.catch) pr.catch(function (e) { if (e && e.name === 'AbortError') return; onTrackFailed(next, e); });
    persistSoon();
    return pr;
  }

  function onTrackFailed(a, e) {
    if (a !== A[cur] || !a.getAttribute('src')) return;
    var t = curTrack();
    toast(tr('music.err.track', { name: t ? t.title : '' }), 4000);
    console.warn('music: track failed', t && t.rel, e && (e.message || e.name));
    S.failStreak++;
    var l = curList();
    if (!l || S.failStreak >= l.tracks.length) { S.failStreak = 0; stopAll(); renderAll(); return; }
    finishFade();
    advance(1, true);
  }

  function reshuffleFrom(last) { S.order = L.reshuffle(curList().tracks.length, null, last); S.pos = 0; }

  /** Следующий/предыдущий трек. auto — трек доиграл сам. */
  function advance(dir, auto) {
    var l = curList();
    if (!l) return;
    var r = L.step({ len: S.order.length, pos: S.pos, dir: dir, repeat: S.repeat, auto: !!auto });
    if (r.pos < 0) { stopAll(); renderAll(); persist(); return; }
    var last = S.order[S.pos];
    if (r.wrapped && S.shuffle && dir > 0) { reshuffleFrom(last); go(0, { fade: true }); return; }
    go(r.pos, { fade: true });
  }

  function togglePlay() {
    var a = A[cur], t = curTrack();
    if (S.playing) {
      finishFade(); a.pause(); S.playing = false; renderAll(); persist(); return;
    }
    if (!t) { if (curList() && curList().tracks.length) { S.order = L.makeOrder(curList().tracks.length, S.shuffle, null, -1); go(0, {}); } return; }
    if (S.loaded === t.rel && a.getAttribute('src') && !a.ended) {
      S.playing = true;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function (e) { if (!e || e.name !== 'AbortError') onTrackFailed(a, e); });
      renderAll(); persist();
    } else go(S.pos, {});
  }
  function next() { var t = curTrack(); if (!t && curList()) { togglePlay(); return; } advance(1, false); }
  function prev() {
    var a = A[cur];
    if (a.currentTime > 3 && S.playing) { a.currentTime = 0; return; }   // как в плеерах: сначала в начало трека
    if (S.pos < 0) return;
    advance(-1, false);
  }
  function playIndex(i) {      // клик по треку списка
    var l = curList(); if (!l) return;
    S.order = L.makeOrder(l.tracks.length, S.shuffle, null, i);
    var pos = S.shuffle ? 0 : i;
    S.failStreak = 0;
    go(pos, { fade: true });
  }
  function setShuffle(v) {
    S.shuffle = !!v;
    var l = curList(); if (!l) { renderAll(); persistSoon(); return; }
    var cidx = S.pos >= 0 ? S.order[S.pos] : -1;
    S.order = L.makeOrder(l.tracks.length, S.shuffle, null, cidx);
    S.pos = cidx >= 0 ? (S.shuffle ? 0 : cidx) : -1;
    renderAll(); persistSoon();
  }
  function setRepeat(r) { S.repeat = r; renderAll(); persistSoon(); }
  function setVolume(v) { S.volume = Math.max(0, Math.min(1, v)); applyVolume(); renderAll(); persistSoon(); }
  function setXfade(v) { S.xfade = L.clampXfade(v); renderAll(); persistSoon(); }
  function seekTo(sec) { var a = A[cur]; if (isFinite(sec)) { try { a.currentTime = Math.max(0, sec); } catch (e) { /* ignore */ } } persistSoon(); }

  /** Выбор плейлиста. Если играем — плавно переходим на его первый трек. */
  function selectList(id, o) {
    o = o || {};
    var l = null; for (var i = 0; i < S.lists.length; i++) if (S.lists[i].id === id) l = S.lists[i];
    if (!l) return;
    var was = S.playing;
    S.listId = id;
    S.order = L.makeOrder(l.tracks.length, S.shuffle, null, -1);
    S.pos = -1; S.failStreak = 0;
    if (was) go(0, { fade: true });
    else if (o.pos !== undefined) S.pos = o.pos;
    renderAll(); persistSoon();
  }

  // ------------------------------------------------------------------ тикер: время, автопереход
  function tick() {
    var a = A[cur];
    tickFade();
    if (S.playing && !F && !advancing && a.duration > 0 && isFinite(a.duration)) {
      if (L.shouldStartFade(a.currentTime, a.duration, S.xfade)) {
        var r = L.step({ len: S.order.length, pos: S.pos, dir: 1, repeat: S.repeat, auto: true });
        if (r.pos >= 0) { advancing = true; advance(1, true); return; }
      }
    }
    renderTime();
  }
  function onEnded(a) {
    if (a !== A[cur] || F) return;                 // старый элемент после перехода — не событие
    if (!S.playing) return;
    advancing = true; advance(1, true);
  }

  // ------------------------------------------------------------------ плейлисты и папка
  async function scan() {
    var seq = ++S.scanSeq, entries = [];
    try { entries = await H().fs.list('music', '', { recursive: true }); S.hasRoot = true; }
    catch (e) { S.hasRoot = !/ROOT_NOT_SET/.test((e && e.message) || ''); entries = []; }
    if (seq !== S.scanSeq) return;
    var lists = L.buildPlaylists(entries);
    var curRel = S.loaded;
    S.lists = lists;
    var l = curList();
    if (!l) {                                      // выбранного плейлиста больше нет
      S.listId = lists.length ? lists[0].id : null; S.order = []; S.pos = -1;
      l = curList();
      if (l) S.order = L.makeOrder(l.tracks.length, S.shuffle, null, -1);
    } else {                                       // тот же плейлист: пересобрать порядок вокруг играющего трека
      var idx = -1;
      for (var i = 0; i < l.tracks.length; i++) if (l.tracks[i].rel === curRel) idx = i;
      S.order = L.makeOrder(l.tracks.length, S.shuffle, null, idx);
      S.pos = idx >= 0 ? (S.shuffle ? 0 : idx) : -1;
    }
    renderAll();
  }

  async function load() {
    S.ready = false; stopAll(); A.forEach(function (a) { a.removeAttribute('src'); }); S.loaded = null; G = [1, 1];
    S.lists = []; S.listId = null; S.order = []; S.pos = -1;
    var saved = null;
    try { saved = await H().kv.get('music'); } catch (e) { saved = null; }
    restore = L.normalizeState(saved);
    S.shuffle = restore.shuffle; S.repeat = restore.repeat; S.volume = restore.volume; S.xfade = restore.crossfade; S.collapsed = restore.collapsed;
    applyVolume();
    await scan();
    // вернуть плейлист и трек: загружаем без воспроизведения, чтобы полоса позиции работала
    var l = null;
    for (var i = 0; i < S.lists.length; i++) if (S.lists[i].id === restore.playlist) l = S.lists[i];
    if (l) {
      S.listId = l.id;
      var ti = -1;
      for (var j = 0; j < l.tracks.length; j++) if (l.tracks[j].rel === restore.track) ti = j;
      S.order = L.makeOrder(l.tracks.length, S.shuffle, null, ti);
      if (ti >= 0) {
        S.pos = S.shuffle ? 0 : ti;
        var t = l.tracks[ti], a = A[cur];
        S.loaded = t.rel; a.src = urlOf(t);
        if (restore.pos > 0) {
          var onMeta = function () { a.removeEventListener('loadedmetadata', onMeta); try { a.currentTime = restore.pos; } catch (e) { /* ignore */ } };
          a.addEventListener('loadedmetadata', onMeta);
        }
      }
    }
    S.ready = true;
    renderAll();
  }

  async function pickFolder() {
    if (!S.camp) return;
    var p = await H().dialog.pickFolder({ title: tr('music.pickTitle') });
    if (!p) return;
    try { await H().campaigns.update(S.camp.id, { folders: { music: p } }); } catch (e) { toast(tr('common.saveFailed', { msg: e && e.message || e }), 4000); }
  }

  // ------------------------------------------------------------------ устройство вывода
  async function refreshDevices() {
    var list = [];
    try {
      var all = await navigator.mediaDevices.enumerateDevices();
      list = all.filter(function (d) { return d.kind === 'audiooutput'; });
    } catch (e) { list = []; }
    S.devices = list;
    return list;
  }
  function hasDevice(id) { return S.devices.some(function (d) { return d.deviceId === id; }); }
  async function setSinkOn(id) {
    for (var i = 0; i < 2; i++) { if (A[i].setSinkId) await A[i].setSinkId(id); }
    S.sinkActive = id;
  }
  /** Применить выбранное устройство; если его нет — системное по умолчанию (и тост, когда это неожиданно). */
  async function applySink(quiet) {
    var want = S.sinkWanted;
    try {
      if (want && !hasDevice(want)) {
        if (S.sinkActive !== '') await setSinkOn('');
        if (!quiet) toast(tr('music.sink.gone'), 5000);
      } else if (S.sinkActive !== want) {
        await setSinkOn(want);
        if (want && quiet === 'back') toast(tr('music.sink.back'));
      }
    } catch (e) {
      console.warn('music: setSinkId', e && e.message);
      S.sinkActive = '';
      if (want) toast(tr('music.sink.failed'), 5000);
    }
    renderDevices();
  }
  async function chooseSink(id) {
    S.sinkWanted = id || '';
    try { await H().settings.set({ musicSink: S.sinkWanted }); } catch (e) { /* ignore */ }
    await applySink(false);
  }
  async function onDeviceChange() {
    var had = hasDevice(S.sinkWanted);
    await refreshDevices();
    var has = !S.sinkWanted || hasDevice(S.sinkWanted);
    if (S.sinkWanted && !has && S.sinkActive === S.sinkWanted) { await applySink(false); return; }   // пропало — тост
    if (S.sinkWanted && has && !had) { await applySink('back'); return; }                            // вернулось
    renderDevices();
  }

  // ------------------------------------------------------------------ горячие клавиши
  function inInput(t) {
    if (!t) return false;
    var n = t.tagName;
    if (n === 'INPUT') return !/^(range|checkbox|radio|button|submit|reset|file|color)$/i.test(t.type || 'text');   // ползунки и галочки хоткеи не глушат
    return n === 'TEXTAREA' || n === 'SELECT' || !!t.isContentEditable;
  }
  function runAction(a) {
    if (a === 'playPause') togglePlay();
    else if (a === 'next') next();
    else if (a === 'prev') prev();
    else if (a === 'volUp') setVolume(S.volume + 0.05);
    else if (a === 'volDown') setVolume(S.volume - 0.05);
  }
  function onKey(e) {
    if (inInput(e.target) || e.isComposing) return;
    var a = L.actionFor(e, S.keys);
    if (!a) return;
    e.preventDefault();
    if (e.repeat && a !== 'volUp' && a !== 'volDown') return;
    if (!S.hasRoot || !S.lists.length) return;
    runAction(a);
  }
  function onKeyUp(e) {      // Ctrl+Space на кнопке не должен «нажимать» её при отпускании
    if (L.actionFor(e, S.keys)) e.preventDefault();
  }
  async function loadKeys() {
    try { var s = await H().settings.get(); S.keys = L.mergeKeys(s && s.musicKeys); S.sinkWanted = (s && s.musicSink) || ''; }
    catch (e) { S.keys = L.mergeKeys(null); }
  }
  /** Назначить/снять клавишу действия (из окна настроек). -> {ok, reason?, cleared?} */
  async function setKey(action, spec) {
    if (L.KEY_ACTIONS.indexOf(action) < 0) return { ok: false, reason: 'bad' };
    var keys = Object.assign({}, S.keys), cleared = null;
    if (spec) {
      if (!L.validHotkey(spec)) return { ok: false, reason: 'invalid' };
      L.KEY_ACTIONS.forEach(function (o) { if (o !== action && keys[o] === spec) { keys[o] = ''; cleared = o; } });
    }
    keys[action] = spec || '';
    S.keys = keys;
    try { await H().settings.set({ musicKeys: keys }); } catch (e) { return { ok: false, reason: 'save' }; }
    return { ok: true, cleared: cleared };
  }
  async function resetKeys() {
    S.keys = L.mergeKeys(null);
    try { await H().settings.set({ musicKeys: S.keys }); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ интерфейс
  function renderTime() {
    if (!built) return;
    var a = A[cur], d = a.duration > 0 && isFinite(a.duration) ? a.duration : 0;
    $('muCur').textContent = L.fmtTime(a.currentTime);
    $('muDur').textContent = L.fmtTime(d);
    var sk = $('muSeek');
    sk.max = String(d || 1);
    if (!S.seeking) sk.value = String(a.currentTime || 0);
    sk.disabled = !d;
  }
  function renderDevices() {
    if (!built) return;
    var sel = $('muSink'); sel.textContent = '';
    var o = el('option', null, tr('music.sink.default')); o.value = ''; sel.appendChild(o);
    var n = 0;
    S.devices.forEach(function (d) {
      if (d.deviceId === 'default' || !d.deviceId) return;
      n++;
      var op = el('option', null, d.label || tr('music.sink.unnamed', { n: n })); op.value = d.deviceId; sel.appendChild(op);
    });
    if (S.sinkWanted && !hasDevice(S.sinkWanted)) {
      var gone = el('option', null, tr('music.sink.missing')); gone.value = S.sinkWanted; sel.appendChild(gone);
    }
    sel.value = S.sinkWanted;
  }
  function renderTracks() {
    var box = $('muTracks'); box.textContent = '';
    var l = curList(); if (!l) return;
    var ci = S.pos >= 0 ? S.order[S.pos] : -1;
    l.tracks.forEach(function (t, i) {
      var b = el('button', 'mu-trk' + (i === ci ? ' cur' : ''), (i === ci && S.playing ? '▶ ' : '') + t.title);
      b.title = t.rel; b.type = 'button';
      b.onclick = function () { playIndex(i); };
      box.appendChild(b);
    });
    var c = box.querySelector('.cur'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  }
  function renderAll() {
    if (!built) return;
    var noRoot = !S.hasRoot, empty = S.hasRoot && !S.lists.length;
    $('muBody').hidden = S.collapsed;
    $('muCaret').textContent = S.collapsed ? '▸' : '▾';
    $('muSetup').hidden = !noRoot;
    $('muEmpty').hidden = !empty;
    $('muMain').hidden = noRoot || empty;
    var t = curTrack();
    var head = $('muNow'); head.textContent = t ? (S.playing ? '▶ ' : '❚❚ ') + t.title : '';
    var sel = $('muList'); sel.textContent = '';
    S.lists.forEach(function (l) {
      var o = el('option', null, listName(l) + ' (' + l.tracks.length + ')'); o.value = l.id; sel.appendChild(o);
    });
    sel.value = S.listId || '';
    $('muTitle').textContent = t ? t.title : tr('music.nothing');
    $('muPlay').textContent = S.playing ? '⏸' : '▶';
    $('muShuffle').classList.toggle('active', S.shuffle);
    var rp = $('muRepeat'); rp.textContent = S.repeat === 'track' ? '🔂' : '🔁';
    rp.classList.toggle('active', S.repeat !== 'off');
    rp.title = tr('music.repeat.' + S.repeat);
    $('muVol').value = String(Math.round(S.volume * 100)); $('muVolVal').textContent = Math.round(S.volume * 100) + '%';
    $('muXf').value = String(S.xfade); $('muXfVal').textContent = S.xfade ? tr('music.xfade.sec', { n: S.xfade }) : tr('music.xfade.off');
    renderTracks(); renderTime(); renderDevices();
  }

  function build() {
    if (built) return;
    var sec = $('musicSec'); if (!sec) return;
    built = true;
    $('muHead').onclick = function () { S.collapsed = !S.collapsed; renderAll(); persistSoon(); };
    $('muPick').onclick = pickFolder; $('muPick2').onclick = pickFolder;
    $('muRescan').onclick = scan; $('muRescan2').onclick = scan;
    $('muList').onchange = function () { selectList($('muList').value); };
    $('muPlay').onclick = togglePlay;
    $('muNext').onclick = function () { runAction('next'); };
    $('muPrev').onclick = function () { runAction('prev'); };
    $('muShuffle').onclick = function () { setShuffle(!S.shuffle); };
    $('muRepeat').onclick = function () { setRepeat(L.nextRepeat(S.repeat)); };
    $('muVol').oninput = function () { setVolume(Number($('muVol').value) / 100); };
    $('muXf').oninput = function () { setXfade(Number($('muXf').value)); };
    $('muSink').onchange = function () { chooseSink($('muSink').value); };
    var sk = $('muSeek');
    sk.oninput = function () { S.seeking = true; $('muCur').textContent = L.fmtTime(Number(sk.value)); };
    sk.onchange = function () { seekTo(Number(sk.value)); S.seeking = false; };
    // клавиатура на ползунках не должна двигать токены/карту
    Array.prototype.forEach.call(sec.querySelectorAll('input[type=range]'), function (r) {
      r.addEventListener('keydown', function (e) { if (e.key.indexOf('Arrow') === 0 && !e.ctrlKey) e.stopPropagation(); });
    });
  }

  // ------------------------------------------------------------------ жизненный цикл
  async function onCampaign(c) {
    var prevId = S.camp && S.camp.id, prevRoot = S.camp && S.camp.folders && S.camp.folders.music;
    clearTimeout(saveTimer); saveTimer = null; S.ready = false;     // старое состояние в новую кампанию не пишем
    S.camp = c || null;
    if (!c) { stopAll(); S.hasRoot = false; S.lists = []; renderAll(); return; }
    var root = c.folders && c.folders.music;
    if (c.id !== prevId || root !== prevRoot) { await load(); }
    else S.ready = true;
  }
  function onWatch(ev) { if (ev && ev.kind === 'music' && S.camp) scan(); }

  function bindAudio() {
    A.forEach(function (a) {
      a.preload = 'auto';
      a.addEventListener('ended', function () { onEnded(a); });
      a.addEventListener('error', function () { if (a.getAttribute('src')) onTrackFailed(a, a.error); });
      a.addEventListener('playing', function () { if (a === A[cur]) S.failStreak = 0; });
      a.addEventListener('loadedmetadata', function () { if (a === A[cur]) renderTime(); });
    });
  }

  async function init() {
    build();
    bindAudio();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('beforeunload', persist);
    await loadKeys();
    try { S.camp = await H().campaigns.current(); } catch (e) { S.camp = null; }
    H().campaigns.onChanged(onCampaign);
    H().watch.onChange(onWatch);
    try { navigator.mediaDevices.addEventListener('devicechange', onDeviceChange); } catch (e) { /* ignore */ }
    tickTimer = setInterval(tick, 100);
    setInterval(function () { if (S.playing) persist(); }, 5000);
    await refreshDevices();
    await applySink(true);
    await load();
  }

  VTT.music = {
    init: init, setKey: setKey, resetKeys: resetKeys, getKeys: function () { return Object.assign({}, S.keys); },
    _state: S, _audio: A, _cur: function () { return cur; },
    _api: { go: go, next: next, prev: prev, togglePlay: togglePlay, selectList: selectList, setVolume: setVolume, setXfade: setXfade, setShuffle: setShuffle,
            setRepeat: setRepeat, playIndex: playIndex, scan: scan, persist: persist, snapshot: snapshot, applySink: applySink, onDeviceChange: onDeviceChange }
  };
})();
