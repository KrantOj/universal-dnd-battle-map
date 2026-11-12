/* Единое правило «какие файлы источника попадают в каталог Показа». Браузер: VTT.mediaFilter; main (архив .udbm): require. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VTT = root.VTT || {}; root.VTT.mediaFilter = api; }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var IMG_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
  /** src: {recursive, exclude} -> (name, rel) => bool; rel — путь от корня источника через '/'. */
  function make(src) {
    var re = null;
    if (src && src.exclude) { try { re = new RegExp(src.exclude, 'i'); } catch (e) { re = null; } }
    var recursive = !!(src && src.recursive);
    return function (name, rel) {
      if (!IMG_RE.test(name)) return false;
      if (re && re.test(name)) return false;
      return recursive || String(rel == null ? name : rel).indexOf('/') < 0;
    };
  }
  return { IMG_RE: IMG_RE, make: make };
});
