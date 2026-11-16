/* VTT.diceSkin — скины 3D-кубиков: описание, проверка, встроенные скины, загрузка пользовательских.
 *
 * Скин — это ДАННЫЕ (никакого кода): skin.json + необязательные картинки (PNG/JPG/WebP) в папке
 * <данные приложения>/dice-skins/<имя>/ . Формат и инструкция по Blender: docs/DICE-SKINS.ru.md
 *
 *   normalize(raw)  → чистый скин: любые ошибки в skin.json заменяются значениями по умолчанию
 *   ensure(id)      → Promise<скин с загруженными текстурами>; при любой беде — скин «Классика»
 *   list()          → Promise<[{ id, name, user }]>
 *   current()/setCurrent(id) — выбранный скин (хранится в настройках приложения, см. settings.js)
 */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var FORMAT = 'udbm-dice-skin/1';
  var DEFAULT_ID = 'classic';

  var DEFAULTS = {
    body: { color: '#2b3a56', metalness: 0.45, roughness: 0.38, map: '', normalMap: '', roughnessMap: '', mapScale: 1, normalScale: 1 },
    edges: { color: '#b89f5a', opacity: 0.85 },
    numbers: { color: '#f6e7b8', outline: '#000000', font: 'Georgia, "Times New Roman", serif', glow: '', size: 1 }
  };

  // встроенные скины (то же, что мог бы написать пользователь в skin.json)
  var BUILTIN = {
    classic: { name: { ru: 'Классика', en: 'Classic' } },
    bone: {
      name: { ru: 'Кость', en: 'Bone' },
      body: { color: '#e6dcc2', metalness: 0.05, roughness: 0.55 },
      edges: { color: '#8a7a55', opacity: 0.6 },
      numbers: { color: '#2e1f12', outline: '#f2e9d2' }
    },
    obsidian: {
      name: { ru: 'Обсидиан', en: 'Obsidian' },
      body: { color: '#14171c', metalness: 0.85, roughness: 0.14 },
      edges: { color: '#5a6272', opacity: 0.7 },
      numbers: { color: '#ff8a3d', outline: '#000000', glow: '#ff5a14' }
    },
    emerald: {
      name: { ru: 'Изумруд', en: 'Emerald' },
      body: { color: '#0f6a46', metalness: 0.35, roughness: 0.22 },
      edges: { color: '#d9c070', opacity: 0.85 },
      numbers: { color: '#fff1c2', outline: '#04281a' }
    },
    arcane: {
      name: { ru: 'Тайная магия', en: 'Arcane' },
      body: { color: '#1b2468', metalness: 0.5, roughness: 0.3 },
      edges: { color: '#7fb4ff', opacity: 0.8 },
      numbers: { color: '#aee8ff', outline: '#050a30', glow: '#4aa8ff' }
    }
  };

  var HEX = /^#[0-9a-fA-F]{6}$/;
  function color(v, dflt, allowEmpty) {
    if (allowEmpty && (v === '' || v == null)) return '';
    return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : dflt;
  }
  function num(v, dflt, lo, hi) {
    v = typeof v === 'number' && isFinite(v) ? v : dflt;
    return Math.min(hi, Math.max(lo, v));
  }
  // имя файла внутри папки скина: без путей наверх, только допустимые расширения (ещё раз проверяет главный процесс)
  function fileName(v) {
    if (typeof v !== 'string' || !v || v.length > 80) return '';
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(v) || v.indexOf('..') >= 0) return '';
    return /\.(png|jpe?g|webp)$/i.test(v) ? v : '';
  }
  function text(v, dflt, max) {
    return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : dflt;
  }

  /** Любой JSON → гарантированно корректный скин. */
  function normalize(raw, id) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var b = raw.body && typeof raw.body === 'object' ? raw.body : {};
    var e = raw.edges && typeof raw.edges === 'object' ? raw.edges : {};
    var n = raw.numbers && typeof raw.numbers === 'object' ? raw.numbers : {};
    var name = raw.name;
    if (typeof name === 'string') name = { ru: name, en: name };
    else if (!name || typeof name !== 'object') name = {};
    return {
      format: FORMAT,
      id: id || DEFAULT_ID,
      name: { ru: text(name.ru, text(name.en, id || '—', 40), 40), en: text(name.en, text(name.ru, id || '—', 40), 40) },
      body: {
        color: color(b.color, fileName(b.map) ? '#ffffff' : DEFAULTS.body.color),   // с текстурой цвет по умолчанию белый: он лишь оттенок
        metalness: num(b.metalness, DEFAULTS.body.metalness, 0, 1),
        roughness: num(b.roughness, DEFAULTS.body.roughness, 0.05, 1),
        map: fileName(b.map), normalMap: fileName(b.normalMap), roughnessMap: fileName(b.roughnessMap),
        mapScale: num(b.mapScale, 1, 0.1, 10),
        normalScale: num(b.normalScale, 1, -5, 5)             // минус — перевернуть рельеф (карты формата DirectX)
      },
      edges: { color: color(e.color, DEFAULTS.edges.color), opacity: num(e.opacity, DEFAULTS.edges.opacity, 0, 1) },
      numbers: {
        color: color(n.color, DEFAULTS.numbers.color),
        outline: color(n.outline, DEFAULTS.numbers.outline),
        font: text(n.font, DEFAULTS.numbers.font, 60).replace(/[;{}<>]/g, ''),
        glow: color(n.glow, '', true),
        size: num(n.size, 1, 0.6, 1.3)
      }
    };
  }

  function builtin(id) { return Object.prototype.hasOwnProperty.call(BUILTIN, id) ? normalize(BUILTIN[id], id) : null; }
  function localName(skin) { var l = (VTT.i18n && VTT.i18n.lang) || 'ru'; return skin.name[l] || skin.name.ru; }

  // ------------------------------------------------------------ выбор и загрузка
  var currentId = DEFAULT_ID, cache = {}, listCache = null;
  function current() { return currentId; }
  function setCurrent(id) { currentId = typeof id === 'string' && id ? id : DEFAULT_ID; }

  function loadTexture(dataUrl, srgb) {
    return new Promise(function (resolve) {
      var T = window.THREE;
      if (!T || !dataUrl) return resolve(null);
      new T.TextureLoader().load(dataUrl, function (tex) {
        tex.wrapS = tex.wrapT = T.RepeatWrapping;
        tex.anisotropy = 4;
        if (srgb && T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
        resolve(tex);
      }, undefined, function () { resolve(null); });
    });
  }

  function attachTextures(skin, files) {
    skin.textures = { map: null, normalMap: null, roughnessMap: null };
    var jobs = [['map', true], ['normalMap', false], ['roughnessMap', false]].map(function (k) {
      var f = skin.body[k[0]];
      if (!f || !files || !files[f]) return null;
      return loadTexture(files[f], k[1]).then(function (t) { skin.textures[k[0]] = t; });
    });
    return Promise.all(jobs).then(function () { return skin; });
  }

  /** Готовый скин по id: 'classic' и др. встроенные, 'user:<папка>' — из папки пользователя. Не отклоняется: при ошибке — «Классика». */
  function ensure(id) {
    id = id || currentId || DEFAULT_ID;
    if (cache[id]) return cache[id];
    var p;
    var b = builtin(id);
    if (b) p = attachTextures(b, null);
    else if (/^user:/.test(id) && window.host && window.host.diceSkins) {
      p = window.host.diceSkins.get(id).then(function (r) {
        if (!r || !r.skin) throw new Error('no skin');
        return attachTextures(normalize(r.skin, id), r.files || {});
      });
    } else p = Promise.reject(new Error('unknown skin'));
    cache[id] = p.catch(function (e) {
      if (id !== DEFAULT_ID) { try { console.warn('dice skin "' + id + '" не загрузился, берём «Классику»:', e && e.message); } catch (_) { /* ignore */ } }
      return id === DEFAULT_ID ? attachTextures(builtin(DEFAULT_ID), null) : ensure(DEFAULT_ID);
    });
    return cache[id];
  }
  function forget() { cache = {}; listCache = null; }     // после «Обновить список» (пользователь мог положить новый скин)

  function list(refresh) {
    if (listCache && !refresh) return listCache;
    var out = Object.keys(BUILTIN).map(function (k) { return { id: k, name: localName(builtin(k)), user: false }; });
    var userP = window.host && window.host.diceSkins ? window.host.diceSkins.list().catch(function () { return []; }) : Promise.resolve([]);
    listCache = userP.then(function (u) { return out.concat((u || []).map(function (s) { return { id: s.id, name: s.name, user: true }; })); });
    return listCache;
  }

  VTT.diceSkin = {
    FORMAT: FORMAT, DEFAULT_ID: DEFAULT_ID, DEFAULTS: DEFAULTS, BUILTIN_IDS: Object.keys(BUILTIN),
    normalize: normalize, builtin: builtin, localName: localName,
    current: current, setCurrent: setCurrent, ensure: ensure, list: list, forget: forget
  };
})();
