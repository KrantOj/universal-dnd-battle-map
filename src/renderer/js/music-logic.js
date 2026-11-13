/* VTT.musicLogic — чистая логика музыкального плеера (без DOM и Audio): плейлисты, порядок, перемешивание,
 * переходы вперёд/назад с режимами повтора, расчёт кроссфейда, горячие клавиши. Тестируется в tests/music-logic.test.js. */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var EXTS = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus'];
  var ROOT_ID = '.';              // плейлист «Без папки» (файлы прямо в корне папки музыки)
  var MAX_XFADE = 10;

  function extOf(name) { var m = /\.([^.\\/]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function isAudio(name) { return EXTS.indexOf(extOf(name)) >= 0; }
  function baseName(rel) { var p = String(rel).split('/'); return p[p.length - 1]; }
  function titleOf(rel) { return baseName(rel).replace(/\.[^.]+$/, ''); }
  function natCmp(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }

  /** Список файлов корня music (результат host.fs.list(..., {recursive:true})) -> плейлисты.
   *  Плейлист = подпапка первого уровня (вместе со вложенными); файлы в корне = плейлист ROOT_ID. Пустые не создаются. */
  function buildPlaylists(entries) {
    var by = {};
    (entries || []).forEach(function (e) {
      if (!e || e.isDir || !isAudio(e.rel)) return;
      var rel = String(e.rel).replace(/^\/+/, '');
      var i = rel.indexOf('/');
      var id = i < 0 ? ROOT_ID : rel.slice(0, i);
      (by[id] = by[id] || []).push({ rel: rel, title: titleOf(rel) });
    });
    var ids = Object.keys(by).sort(function (a, b) {
      if (a === ROOT_ID) return -1; if (b === ROOT_ID) return 1; return natCmp(a, b);
    });
    return ids.map(function (id) {
      var tracks = by[id].sort(function (a, b) { return natCmp(a.rel, b.rel); });
      return { id: id, name: id === ROOT_ID ? '' : id, tracks: tracks };
    });
  }

  /** Порядок воспроизведения: массив индексов треков. Без перемешивания — 0..n-1.
   *  С перемешиванием — случайная перестановка (без повторов), трек `first` (если задан) идёт первым. */
  function makeOrder(n, shuffle, rng, first) {
    var a = [], i;
    for (i = 0; i < n; i++) a.push(i);
    if (!shuffle || n < 2) return a;
    rng = rng || Math.random;
    if (first >= 0 && first < n) a.splice(first, 1);
    for (i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    if (first >= 0 && first < n) a.unshift(first);
    return a;
  }

  /** Новая перестановка для следующего круга: первый трек не совпадает с последним сыгранным (если треков > 1). */
  function reshuffle(n, rng, last) {
    var a = makeOrder(n, true, rng, -1);
    if (n > 1 && a[0] === last) { var t = a[0]; a[0] = a[1]; a[1] = t; }
    return a;
  }

  /** Следующая позиция в порядке.
   *  o: {len, pos, dir:+1|-1, repeat:'off'|'track'|'playlist', auto:bool (трек доиграл сам)}
   *  -> {pos, wrapped}; pos -1 = остановиться. */
  function step(o) {
    var len = o.len | 0, pos = o.pos | 0, dir = o.dir < 0 ? -1 : 1;
    if (len <= 0) return { pos: -1, wrapped: false };
    if (dir > 0) {
      if (o.auto && o.repeat === 'track') return { pos: pos < 0 ? 0 : pos, wrapped: false };
      if (pos + 1 < len) return { pos: pos + 1, wrapped: false };
      if (o.repeat === 'playlist' || (o.repeat === 'track' && !o.auto)) return { pos: 0, wrapped: true };
      return { pos: -1, wrapped: false };
    }
    if (pos > 0) return { pos: pos - 1, wrapped: false };
    if (o.repeat === 'playlist' || o.repeat === 'track') return { pos: len - 1, wrapped: true };
    return { pos: 0, wrapped: false };
  }

  function nextRepeat(r) { return r === 'off' ? 'playlist' : r === 'playlist' ? 'track' : 'off'; }

  // ---------------------------------------------------------------- кроссфейд
  function clampXfade(v) { v = Number(v); if (!isFinite(v)) return 0; return Math.max(0, Math.min(MAX_XFADE, Math.round(v * 2) / 2)); }
  /** Фактическая длина перехода: не больше половины длительности трека (чтобы короткие треки не «съедались»). */
  function effectiveXfade(xf, duration) {
    xf = clampXfade(xf);
    if (!(duration > 0) || !isFinite(duration)) return xf;
    return Math.min(xf, duration / 2);
  }
  /** Расписание автоперехода: {xf, startAt} — с какой секунды трека начать переход. */
  function schedule(duration, xf) {
    var e = effectiveXfade(xf, duration);
    return { xf: e, startAt: e > 0 && duration > 0 ? duration - e : duration };
  }
  /** Пора ли запускать автопереход (при xf = 0 переход по событию ended, а не по времени). */
  function shouldStartFade(current, duration, xf) {
    var s = schedule(duration, xf);
    return s.xf > 0 && isFinite(duration) && duration > 0 && current >= s.startAt;
  }
  /** Громкости при переходе, p = 0..1 (равная мощность: out² + in² = 1). */
  function fadeGains(p) {
    p = Math.max(0, Math.min(1, p));
    return { out: Math.cos(p * Math.PI / 2), in: Math.sin(p * Math.PI / 2) };
  }

  function fmtTime(s) {
    if (!(s >= 0) || !isFinite(s)) return '0:00';
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var rr = (r < 10 ? '0' : '') + r;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + rr : m + ':' + rr;
  }

  // ---------------------------------------------------------------- горячие клавиши
  // Спецификация: 'Ctrl+Alt+Shift+Meta+<e.code>', например 'Ctrl+Space', 'Ctrl+ArrowRight'. По коду клавиши — не зависит от раскладки.
  var DEFAULT_KEYS = { playPause: 'Ctrl+Space', next: 'Ctrl+ArrowRight', prev: 'Ctrl+ArrowLeft', volUp: 'Ctrl+ArrowUp', volDown: 'Ctrl+ArrowDown' };
  var KEY_ACTIONS = ['playPause', 'next', 'prev', 'volUp', 'volDown'];
  var MOD_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

  function specFromEvent(e) {
    if (!e || !e.code || MOD_CODES.test(e.code)) return '';
    var p = [];
    if (e.ctrlKey) p.push('Ctrl'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift'); if (e.metaKey) p.push('Meta');
    p.push(e.code);
    return p.join('+');
  }
  /** Допустимо ли назначить: нужен Ctrl/Alt/Meta (чтобы не перекрывать V, R, H, D, N, B, 0–9, стрелки и т.д.) либо F-клавиша / медиаклавиша. */
  function validHotkey(spec) {
    if (!spec) return false;
    var parts = spec.split('+'), code = parts[parts.length - 1];
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code) && code !== 'F1') return true;    // F1 — справка
    if (/^Media/.test(code) || /^Audio/.test(code)) return true;
    if (code === 'Escape' || code === 'Tab' || code === 'Enter') return false;
    return parts.indexOf('Ctrl') >= 0 || parts.indexOf('Alt') >= 0 || parts.indexOf('Meta') >= 0;
  }
  function labelOfCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    var m = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']',
      Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`' };
    return m[code] || code;
  }
  function labelOfSpec(spec) {
    if (!spec) return '';
    var parts = spec.split('+');
    return parts.slice(0, -1).concat(labelOfCode(parts[parts.length - 1])).join('+');
  }
  /** Слить сохранённые клавиши с умолчаниями (пустая строка = «не назначено»). */
  function mergeKeys(saved) {
    var out = {};
    KEY_ACTIONS.forEach(function (a) { out[a] = saved && typeof saved[a] === 'string' ? saved[a] : DEFAULT_KEYS[a]; });
    return out;
  }
  /** Действие по событию клавиши или null. */
  function actionFor(e, keys) {
    var s = specFromEvent(e);
    if (!s) return null;
    for (var i = 0; i < KEY_ACTIONS.length; i++) if (keys[KEY_ACTIONS[i]] === s) return KEY_ACTIONS[i];
    return null;
  }

  /** Привести сохранённое состояние к допустимому виду. */
  function normalizeState(s) {
    s = s && typeof s === 'object' ? s : {};
    var v = Number(s.volume);
    return {
      playlist: typeof s.playlist === 'string' ? s.playlist : null,
      track: typeof s.track === 'string' ? s.track : null,
      pos: s.pos > 0 && isFinite(s.pos) ? Number(s.pos) : 0,
      volume: isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8,
      shuffle: !!s.shuffle,
      repeat: s.repeat === 'track' || s.repeat === 'playlist' ? s.repeat : 'off',
      crossfade: s.crossfade === undefined || s.crossfade === null ? 2 : clampXfade(s.crossfade),
      collapsed: !!s.collapsed
    };
  }

  VTT.musicLogic = {
    EXTS: EXTS, ROOT_ID: ROOT_ID, MAX_XFADE: MAX_XFADE, DEFAULT_KEYS: DEFAULT_KEYS, KEY_ACTIONS: KEY_ACTIONS,
    isAudio: isAudio, titleOf: titleOf, natCmp: natCmp, buildPlaylists: buildPlaylists,
    makeOrder: makeOrder, reshuffle: reshuffle, step: step, nextRepeat: nextRepeat,
    clampXfade: clampXfade, effectiveXfade: effectiveXfade, schedule: schedule, shouldStartFade: shouldStartFade, fadeGains: fadeGains,
    fmtTime: fmtTime, specFromEvent: specFromEvent, validHotkey: validHotkey, labelOfSpec: labelOfSpec, mergeKeys: mergeKeys, actionFor: actionFor,
    normalizeState: normalizeState
  };
})();
