/* VTT.store — слой данных поверх window.host: сцены, библиотека, kv, загрузка/импорт карт */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;
  var H = function () { return window.host; };

  var LIB_FILE = 'library.tokens.json';          // в корне data
  var LEGACY_LIB_FILE = 'Библиотека токенов.vtt.json';   // в корне maps (совместимость)
  var LIB_FORMAT = 'vestfalia-tokens/1';

  function readAsDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error(tr('store.err.mapImage'))); };
      im.src = src;
    });
  }
  function readText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  function baseName(fileName) {
    return fileName.replace(/\.map\.json$/i, '').replace(/\.json$/i, '');
  }
  function fileOf(p) { return String(p).split(/[\\/]/).pop(); }
  function dirOf(p) {
    var i = Math.max(String(p).lastIndexOf('/'), String(p).lastIndexOf('\\'));
    return i < 0 ? '' : String(p).slice(0, i);
  }
  function sepOf(p) { return String(p).indexOf('\\') >= 0 ? '\\' : '/'; }
  function isRootUnset(e) { return !!(e && /ROOT_NOT_SET/.test(e.message || '')); }

  function parseMeta(text) {
    var meta = JSON.parse(text);
    if (!meta || !meta.resolution || !meta.resolution.map_size) throw new Error(tr('store.err.notMapFile'));
    return meta;
  }

  // meta + url картинки -> карта в памяти
  function buildMap(name, meta, imageUrl, warn) {
    var res = meta.resolution || {};
    var size = res.map_size || {};
    return loadImage(imageUrl).then(function (im) {
      var geo = VTT.geometry.segmentsFromMap(meta);
      var ppg = res.pixels_per_grid || 70;
      var ig = meta.image_grid;
      var imageGrid = ig && ig.width && ig.height
        ? { x: ig.x || 0, y: ig.y || 0, width: ig.width, height: ig.height }
        : { x: 0, y: 0, width: size.x * ppg, height: size.y * ppg };
      var warning = warn || '';
      if (!warning && (im.naturalWidth !== imageGrid.width || im.naturalHeight !== imageGrid.height)) {
        warning = tr('store.warn.imageMismatch', { image: meta.image || '… (VTT).png' });
      }
      var map = {
        name: name, title: meta.name || name,
        cols: size.x, rows: size.y, ppg: ppg, feet: meta.feet_per_cell || 5,
        meta: meta, image: im, imageURL: imageUrl, imageGrid: imageGrid,
        labels: meta.labels || [], geo: geo, walls: geo.walls
      };
      if (warning) map.warning = warning;
      return map;
    });
  }

  function mergeLibs(a, b) {
    var by = {}, out = [];
    (a || []).concat(b || []).forEach(function (t) {
      if (!t || !t.lid) return;
      var o = by[t.lid];
      if (!o) { by[t.lid] = t; out.push(t); return; }
      if ((t.updated || 0) > (o.updated || 0)) { out[out.indexOf(o)] = t; by[t.lid] = t; }
    });
    return out;
  }

  function libFromJson(txt) {
    var d = JSON.parse(txt);
    var arr = Array.isArray(d) ? d : d && d.tokens;
    if (!Array.isArray(arr)) throw new Error(tr('store.err.notLibrary'));
    return arr;
  }
  function libJson(tokens) { return JSON.stringify({ format: LIB_FORMAT, tokens: tokens }, null, 1); }

  async function saveToFile(defaultName, text) {
    var p = await H().dialog.saveFile({ title: tr('common.save'), defaultName: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return false;
    await H().fs.writeAbs(p, text);
    return true;
  }

  var store = {
    saveScene: function (scene) { return H().scenes.save(scene); },
    loadScene: function (name) { return H().scenes.load(name).then(function (s) { return s || null; }); },

    // библиотека: data/library.tokens.json + (совместимость) «Библиотека токенов.vtt.json» в папке карт; новее по lid побеждает
    getLibrary: async function () {
      var own = [], legacy = [];
      try { own = libFromJson(await H().fs.readText('data', LIB_FILE)); } catch (e) { own = []; }
      try {
        if (await H().fs.exists('maps', LEGACY_LIB_FILE)) legacy = libFromJson(await H().fs.readText('maps', LEGACY_LIB_FILE));
      } catch (e) { legacy = []; }
      return legacy.length ? mergeLibs(own, legacy) : own;
    },
    saveLibrary: function (arr) { return H().fs.writeText('data', LIB_FILE, libJson(arr)); },

    getKV: function (k) { return H().kv.get(k); },
    setKV: function (k, v) { return H().kv.set(k, v); },

    // карты: все *.map.json в корне maps (рекурсивно). Корень не задан -> ошибка ROOT_NOT_SET (см. isRootUnset)
    listMaps: async function () {
      var items = await H().fs.list('maps', '', { recursive: true });
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.isDir || !/\.map\.json$/i.test(it.rel || it.name)) continue;
        var rel = it.rel || it.name, imageName = '';
        try { imageName = JSON.parse(await H().fs.readText('maps', rel)).image || ''; } catch (e) { /* битый json */ }
        out.push({ name: baseName(rel), rel: rel, dir: dirOf(rel), imageName: imageName });
      }
      out.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
      return out;
    },

    loadMapFromEntry: async function (entry) {
      var meta = parseMeta(await H().fs.readText('maps', entry.rel));
      var imgName = meta.image || entry.imageName;
      var dir = entry.dir ? entry.dir + '/' : '';
      var rel = imgName ? dir + imgName : '', warn = '';
      if (!rel || !(await H().fs.exists('maps', rel))) {
        var sibs = (await H().fs.list('maps', entry.dir || '', { recursive: false })).filter(function (x) { return !x.isDir && /\.(png|jpe?g|webp)$/i.test(x.name); });
        if (!sibs.length) throw new Error(tr('store.err.imageNotFound', { name: imgName }));
        rel = sibs[0].rel || (dir + sibs[0].name);
        warn = tr('store.warn.imageSubstituted', { name: imgName, used: sibs[0].name });
      }
      return buildMap(entry.name, meta, H().fs.url('maps', rel), warn);
    },

    // Импорт: пути выбранных/перетащенных файлов -> копия в maps. askImages(имя) -> Promise<absPath[]> если картинку не нашли
    importMapFiles: async function (paths, askImages) {
      var json = paths.filter(function (p) { return /\.map\.json$/i.test(p); })[0] || paths.filter(function (p) { return /\.json$/i.test(p); })[0];
      if (!json) throw new Error(tr('store.err.noMapFile'));
      var rels = await H().fs.importFiles([json], 'maps', '');
      var jsonRel = rels[0];
      var meta = parseMeta(await H().fs.readText('maps', jsonRel));
      var imgName = meta.image || '';
      var imgs = paths.filter(function (p) { return p !== json; });
      var imgPath = imgs.filter(function (p) { return fileOf(p) === imgName; })[0] || null;
      var imported = false;
      if (!imgPath && imgName) imgPath = dirOf(json) + sepOf(json) + imgName;   // рядом с json
      if (imgPath) {
        try { await H().fs.importFiles([imgPath], 'maps', ''); imported = true; } catch (e) { imported = false; }
      }
      if (!imported && askImages) {
        var picked = await askImages(imgName);
        if (picked && picked.length) { await H().fs.importFiles([picked[0]], 'maps', ''); imported = true; }
      }
      if (!imported && imgs.length) {   // выбрана картинка с другим именем — копируем как есть
        try { await H().fs.importFiles([imgs[0]], 'maps', ''); } catch (e) { /* ignore */ }
      }
      return { name: baseName(jsonRel), rel: jsonRel, dir: dirOf(jsonRel), imageName: imgName };
    },

    exportScene: function (scene) { return saveToFile(scene.map + '.scene.json', JSON.stringify(scene)); },
    importScene: function (file) {
      return readText(file).then(function (txt) {
        var s = JSON.parse(txt);
        if (!s || !Array.isArray(s.tokens) || typeof s.fog !== 'string' || !s.map) throw new Error(tr('store.err.notScene'));
        return s;
      });
    },

    mergeLibs: mergeLibs,
    LIB_FILE: LIB_FILE,
    exportLibrary: function (tokens) { return saveToFile('library.tokens.json', libJson(tokens)); },
    importLibraryFile: function (file) { return readText(file).then(libFromJson); },

    isRootUnset: isRootUnset,
    fileOf: fileOf,
    _readAsDataURL: readAsDataURL,
    _loadImage: loadImage
  };

  VTT.store = store;
})();
