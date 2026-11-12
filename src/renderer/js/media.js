/* VTT.media — каталог картинок кампании для режима «Показ». Источники — campaign.media (root 'media:<id>'). */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;

  var IMG_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
  var THUMB_H = 220, THUMB_MAXW = 400;
  var sources = [];       // [{id, label, ...}] — текущие источники

  function titleFromName(fileName) {
    return String(fileName || '').replace(/\.[^.\\\/]+$/, '').replace(/-\d{10,}$/, '').trim();
  }

  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }

  function labelOf(cat) {
    for (var i = 0; i < sources.length; i++) if (sources[i].id === cat) return sources[i].label || '';
    return '';
  }

  function matches(item, query) {
    var q = normalize(query);
    if (!q) return true;
    var hay = normalize((item.title || '') + ' ' + labelOf(item.cat));
    var words = q.split(' ');
    for (var i = 0; i < words.length; i++) if (words[i] && hay.indexOf(words[i]) < 0) return false;
    return true;
  }

  function setSources(list) {
    sources = Array.isArray(list) ? list.filter(function (s) { return s && s.id; }) : [];
  }
  function rootOf(item) { return 'media:' + item.cat; }
  function urlOf(item) { return window.host.fs.url(rootOf(item), item.rel); }

  // сканирует все источники; недоступные (ошибка) попадают в missing
  async function scan() {
    var items = [], missing = [];
    for (var si = 0; si < sources.length; si++) {
      var src = sources[si], re = null;
      if (src.exclude) { try { re = new RegExp(src.exclude, 'i'); } catch (e) { re = null; } }
      var list;
      try {
        list = await window.host.fs.list('media:' + src.id, '', { recursive: !!src.recursive });
      } catch (e) { missing.push(src.label || src.id); continue; }
      var batch = [];
      list.forEach(function (f) {
        if (f.isDir || !IMG_RE.test(f.name)) return;
        if (re && re.test(f.name)) return;
        var rel = f.rel || f.name;
        batch.push({
          id: src.id + '/' + rel, cat: src.id, rel: rel,
          title: titleFromName(f.name), name: f.name, mtime: f.mtime || 0, size: f.size || 0
        });
      });
      batch.sort(function (a, b) { return a.title.localeCompare(b.title, VTT.i18n.lang); });
      items = items.concat(batch);
    }
    return { items: items, missing: missing };
  }

  function loadImg(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error(tr('media.err.load'))); };
      im.src = url;
    });
  }

  function hash(str) {
    var h1 = 5381, h2 = 52711;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = ((h1 * 33) ^ c) >>> 0; h2 = ((h2 * 31) ^ c) >>> 0;
    }
    return h1.toString(16) + h2.toString(16);
  }
  function thumbRel(item) { return 'thumbs/' + hash(item.id + '|' + item.mtime + '|' + item.size) + '.jpg'; }

  var memCache = new Map();
  var pending = new Map();

  // рисуем миниатюру из байтов файла (readBinary -> Blob -> bitmap: холст не «грязнится» чужим origin)
  async function makeThumb(item) {
    var buf = await window.host.fs.readBinary(rootOf(item), item.rel);
    var file = new Blob([buf]);
    var src, url = null, w, h;
    if (/\.svg$/i.test(item.name) || typeof createImageBitmap !== 'function') {
      url = URL.createObjectURL(new Blob([buf], { type: /\.svg$/i.test(item.name) ? 'image/svg+xml' : '' }));
      try { src = await loadImg(url); } catch (e) { URL.revokeObjectURL(url); throw e; }
      w = src.naturalWidth || src.width || THUMB_H; h = src.naturalHeight || src.height || THUMB_H;
    } else {
      try { src = await createImageBitmap(file); }
      catch (e) {
        url = URL.createObjectURL(file);
        try { src = await loadImg(url); } catch (e2) { URL.revokeObjectURL(url); throw e2; }
      }
      w = src.naturalWidth || src.width; h = src.naturalHeight || src.height;
    }
    try {
      var th = THUMB_H, tw = Math.round(w * th / (h || 1));
      if (tw > THUMB_MAXW) tw = THUMB_MAXW;
      if (tw < 1) tw = 1;
      var c = document.createElement('canvas');
      c.width = tw; c.height = th;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, tw, th);
      var k = Math.min(tw / w, th / h);
      var dw = w * k, dh = h * k;
      ctx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);
      return await new Promise(function (resolve, reject) {
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob')); }, 'image/jpeg', 0.8);
      });
    } finally {
      if (src && typeof src.close === 'function') { try { src.close(); } catch (e) { /* ok */ } }
      if (url) URL.revokeObjectURL(url);
    }
  }

  // -> blob: URL миниатюры (кэш: память + data/thumbs/<hash>.jpg)
  function thumb(item) {
    var rel = thumbRel(item);
    if (memCache.has(rel)) return Promise.resolve(memCache.get(rel));
    if (pending.has(rel)) return pending.get(rel);
    var p = (async function () {
      var blob = null;
      try {
        if (await window.host.fs.exists('data', rel)) blob = new Blob([await window.host.fs.readBinary('data', rel)], { type: 'image/jpeg' });
      } catch (e) { blob = null; }
      if (!blob) {
        blob = await makeThumb(item);
        try { await window.host.fs.writeBinary('data', rel, await blob.arrayBuffer()); } catch (e) { /* кэш не записался — не страшно */ }
      }
      var u = URL.createObjectURL(blob);
      memCache.set(rel, u);
      return u;
    })();
    pending.set(rel, p);
    var done = function () { pending.delete(rel); };
    p.then(done, done);
    return p;
  }

  VTT.media = {
    IMG_RE: IMG_RE,
    titleFromName: titleFromName,
    normalize: normalize,
    matches: matches,
    setSources: setSources,
    getSources: function () { return sources.slice(); },
    scan: scan,
    urlOf: urlOf,
    thumb: thumb
  };
})();
