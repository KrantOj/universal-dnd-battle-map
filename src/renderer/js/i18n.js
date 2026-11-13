/* VTT.i18n — локализация. Классический скрипт: подключать ПЕРВЫМ после locales/<lang>.js.
 *
 * Словарь: src/renderer/locales/ru.json (источник истины, плоские ключи «область.подобласть.имя»).
 * В окно он попадает как locales/ru.js (VTT.locales.ru = {...}); файл генерирует `npm run build:locales`.
 *
 * Подстановки:   t('gm.toast.created', { name: 'Орк' })   — значение «Создан «{name}»»; неизвестный {x} остаётся как есть.
 * Множественное: plural(n, key[, params]) — значение хранит формы через «|»: «{n} запись|{n} записи|{n} записей»
 *                формы выбираются по языку: ru — 3 (1 / 2–4 / 5+), en — 2 (one|other); {n} подставляется само.
 * DOM:           apply(root) — data-i18n (textContent), data-i18n-html (innerHTML, только доверенный словарь),
 *                data-i18n-title, data-i18n-placeholder, data-i18n-aria (aria-label).
 * Язык берётся из <html lang>, который главный процесс подставляет по настройке settings.lang (см. main/protocol.js);
 * при смене языка окна перезагружаются. Доступные словари: locales/ru.js, locales/en.js.
 * Нет ключа в текущем языке -> берётся ru, иначе возвращается сам ключ (и один раз пишется предупреждение).
 * Синтаксис ввода (напр. «д», «преим», «помеха» в формулах кубиков) — не UI, в словарь не выносится.
 */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var locales = (VTT.locales = VTT.locales || {});
  var FALLBACK = 'ru';

  function pickLang() {
    var de = typeof document !== 'undefined' ? document.documentElement : null;
    var l = (de && de.lang || '').toLowerCase().slice(0, 2);
    return locales[l] ? l : FALLBACK;
  }
  var lang = pickLang();
  var warned = {};

  function raw(key) {
    var d = locales[lang], v = d && d[key];
    if (v === undefined) { d = locales[FALLBACK]; v = d && d[key]; }
    if (v === undefined) {
      if (!warned[key]) { warned[key] = 1; try { console.warn('[i18n] нет ключа: ' + key); } catch (e) { /* ignore */ } }
      return null;
    }
    return v;
  }
  function fill(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] !== undefined && params[k] !== null ? String(params[k]) : m; });
  }
  function t(key, params) {
    var v = raw(key);
    return v === null ? key : fill(v, params);
  }
  // число форм множественного числа по языку (тест сверяет с количеством «|» в словаре)
  var FORMS = { ru: 3, en: 2 };
  function formCount(l) { return FORMS[l] || 2; }
  function formIndex(n) {
    n = Math.abs(n);
    if (lang === 'ru') {
      var m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return 0;
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
      return 2;
    }
    return n === 1 ? 0 : 1;
  }
  function plural(n, key, params) {
    var v = raw(key);
    if (v === null) return key;
    var forms = v.split('|');
    var f = forms[Math.min(formIndex(n), forms.length - 1)];
    return fill(f, Object.assign({ n: n }, params || {}));
  }

  function apply(root) {
    root = root || document;
    function each(sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
    each('[data-i18n]', function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
    each('[data-i18n-html]', function (e) { e.innerHTML = t(e.getAttribute('data-i18n-html')); });
    each('[data-i18n-title]', function (e) { e.setAttribute('title', t(e.getAttribute('data-i18n-title'))); });
    each('[data-i18n-placeholder]', function (e) { e.setAttribute('placeholder', t(e.getAttribute('data-i18n-placeholder'))); });
    each('[data-i18n-aria]', function (e) { e.setAttribute('aria-label', t(e.getAttribute('data-i18n-aria'))); });
  }

  VTT.i18n = { t: t, plural: plural, apply: apply, lang: lang, formCount: formCount };
})();
