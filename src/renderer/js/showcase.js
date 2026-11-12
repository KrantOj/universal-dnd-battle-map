/* VTT.showcase — «Показ» на стороне мастера: панель картинок, чип, отправка игрокам (см. ARCHITECTURE 5b) */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;

  var PINS_TAB = { cat: 'pins', label: tr('show.pinsTab') };
  function tabs() {
    return [PINS_TAB].concat(VTT.media.getSources().map(function (s) { return { cat: s.id, label: s.label || s.id }; }));
  }

  var S = {
    items: [], missing: [],
    state: 'none',         // none | ready | scanning | error
    tab: 'pins', query: '', caption: false, pins: [],
    current: null,         // {item}
    open: false, loaded: false, io: null, queue: [], active: 0, searchTimer: null,
    errMsg: ''
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function kvGet(k) { try { return Promise.resolve(VTT.store.getKV(k)).catch(function () { return undefined; }); } catch (e) { return Promise.resolve(undefined); } }
  function kvSet(k, v) { try { return Promise.resolve(VTT.store.setKV(k, v)).catch(function () {}); } catch (e) { return Promise.resolve(); } }

  function toast(msg, ms) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2500);
  }

  function inputFocused() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }
  function modalOpen() {
    if (document.querySelector('.cu-overlay')) return true;
    var ids = ['tokenDlg', 'help', 'picker', 'settingsDlg'];
    for (var i = 0; i < ids.length; i++) { var n = $(ids[i]); if (n && !n.hidden) return true; }
    return !!document.querySelector('.vtt-ui-backdrop');
  }

  // ------------------------------------------------------------------ показ
  function payload(cur) {
    return { id: cur.item.id, title: cur.item.title, caption: !!S.caption, cat: cur.item.cat, url: VTT.media.urlOf(cur.item) };
  }

  function transmit() {
    var cur = S.current;
    if (!cur) { VTT.sync.send({ t: 'show', item: null }); return true; }
    if (!VTT.sync.isOpen()) return false;
    return VTT.sync.send({ t: 'show', item: payload(cur) });
  }

  var seq = 0;
  function show(item) {
    ++seq;
    if (!item) {
      S.current = null;
      refreshChip(); markCurrent();
      VTT.sync.send({ t: 'show', item: null });
      return;
    }
    S.current = { item: item };
    refreshChip(); markCurrent();
    if (!VTT.sync.isOpen()) { toast(tr('show.toast.openPlayer')); return; }
    transmit();
  }

  function resend() {
    if (S.current) transmit();
  }
  function isShowing() { return !!S.current; }

  function refreshChip() {
    var chip = $('showChip');
    if (!chip) return;
    chip.hidden = !S.current;
    if (S.current) chip.querySelector('.sc-t').textContent = '🖼 ' + S.current.item.title;
    var b = $('btnShow'); if (b) b.classList.toggle('active', S.open);
  }

  // ------------------------------------------------------------------ закрепления
  function savePins() { kvSet('showPins', S.pins.slice()); }
  function isPinned(id) { return S.pins.indexOf(id) >= 0; }
  function togglePin(id) {
    var i = S.pins.indexOf(id);
    if (i >= 0) S.pins.splice(i, 1); else S.pins.push(id);
    savePins();
    renderGrid();
  }

  // ------------------------------------------------------------------ источники (campaign.media)
  var campId;
  function resetForCampaign() {
    show(null);
    S.items = []; S.missing = []; S.loaded = false; S.query = ''; S.tab = 'pins'; S.pins = []; S.state = 'none';
    var q = $('sdSearch'); if (q) q.value = '';
    loadKv();
  }
  function loadKv() {
    return Promise.all([kvGet('showCaption'), kvGet('showPins'), kvGet('showTab')]).then(function (r) {
      S.caption = r[0] === true;
      S.pins = Array.isArray(r[1]) ? r[1].filter(function (x) { return typeof x === 'string'; }) : [];
      if (typeof r[2] === 'string' && (r[2] === 'pins' || VTT.media.getSources().some(function (t) { return t.id === r[2]; }))) S.tab = r[2];
      $('sdCaption').checked = S.caption;
      renderTabs();
      if (S.loaded) renderGrid();
    });
  }
  function setCampaign(c) {
    var id = c ? c.id : null;
    if (campId !== undefined && id !== campId) resetForCampaign();
    campId = id;
    var list = c && Array.isArray(c.media) ? c.media : [];
    VTT.media.setSources(list);
    if (S.tab !== 'pins' && !list.some(function (m) { return m.id === S.tab; })) S.tab = 'pins';
    if (S.current && !list.some(function (m) { return m.id === S.current.item.cat; })) show(null);
    renderTabs();
    if (S.open || S.loaded) { S.loaded = true; scan(); } else { S.state = list.length ? 'ready' : 'none'; }
  }

  async function scan(quiet) {
    if (!VTT.media.getSources().length) { S.state = 'none'; S.items = []; S.missing = []; renderGrid(); return; }
    if (!quiet) { S.state = 'scanning'; renderGrid(); }
    try {
      var r = await VTT.media.scan();
      S.items = r.items || []; S.missing = r.missing || [];
      S.state = 'ready';
    } catch (e) {
      S.state = 'error'; S.errMsg = (e && e.message) || String(e);
    }
    renderGrid();
  }

  // ------------------------------------------------------------------ отрисовка панели
  function renderTabs() {
    var box = $('sdTabs'); box.textContent = '';
    tabs().forEach(function (t) {
      var b = el('button', 'sd-tab' + (S.tab === t.cat ? ' active' : ''), t.label);
      b.onclick = function () { S.tab = t.cat; kvSet('showTab', t.cat); renderTabs(); renderGrid(); };
      box.appendChild(b);
    });
  }

  function visibleItems() {
    var list;
    if (S.tab === 'pins') {
      var byId = {};
      S.items.forEach(function (it) { byId[it.id] = it; });
      list = S.pins.map(function (id) { return byId[id]; }).filter(Boolean);
    } else {
      list = S.items.filter(function (it) { return it.cat === S.tab; });
    }
    if (S.query) list = list.filter(function (it) { return VTT.media.matches(it, S.query); });
    return list;
  }

  function openSettings() { if (VTT.settings) VTT.settings.open(); }

  function msgBlock(text, btnText, fn) {
    var d = el('div', 'sd-msg');
    d.appendChild(el('div', null, text));
    if (btnText) { var b = el('button', 'primary', btnText); b.onclick = fn; d.appendChild(b); }
    return d;
  }

  function renderGrid() {
    var body = $('sdBody');
    if (!body) return;
    if (S.io) { S.io.disconnect(); S.io = null; }
    S.queue = [];
    body.textContent = '';

    if (S.state === 'none') {
      body.appendChild(msgBlock(tr('show.noCategories'), tr('common.settings'), openSettings));
      return;
    }
    if (S.state === 'scanning') { body.appendChild(msgBlock(tr('show.scanning'))); return; }
    if (S.state === 'error') {
      body.appendChild(msgBlock(tr('show.err.read', { msg: S.errMsg }), tr('common.settings'), openSettings));
      return;
    }

    var list = visibleItems();
    if (S.missing.length && S.tab !== 'pins') {
      body.appendChild(el('div', 'sd-note', tr('show.missing', { list: S.missing.join(', ') })));
    }
    if (!list.length) {
      var txt = S.query ? tr('show.nothing') :
        (S.tab === 'pins' ? tr('show.emptyPins') : tr('show.emptyCat'));
      body.appendChild(el('div', 'sd-note', txt));
      return;
    }

    var grid = el('div', 'sd-grid');
    S.io = ('IntersectionObserver' in window) ? new IntersectionObserver(onVisible, { root: body, rootMargin: '200px' }) : null;
    list.forEach(function (it) {
      var card = el('div', 'sd-card');
      card.dataset.id = it.id;
      if (S.current && S.current.item.id === it.id) card.classList.add('cur');
      var th = el('div', 'sd-th');
      card.appendChild(th);
      card.appendChild(el('div', 'sd-title', it.title));
      card.title = it.title;
      var star = el('button', 'sd-star' + (isPinned(it.id) ? ' on' : ''), isPinned(it.id) ? '★' : '☆');
      star.title = isPinned(it.id) ? tr('show.unpin.title') : tr('show.pin.title');
      star.onclick = function (e) { e.stopPropagation(); togglePin(it.id); };
      card.appendChild(star);
      card.onclick = function () {
        if (S.current && S.current.item.id === it.id) show(null); else show(it);
      };
      card._item = it; card._th = th;
      grid.appendChild(card);
      if (S.io) S.io.observe(card); else enqueueThumb(card);
    });
    body.appendChild(grid);
  }

  function onVisible(entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { S.io.unobserve(en.target); enqueueThumb(en.target); }
    });
  }

  function enqueueThumb(card) { S.queue.push(card); pump(); }
  function pump() {
    while (S.active < 3 && S.queue.length) {
      (function (card) {
        S.active++;
        Promise.resolve().then(function () { return VTT.media.thumb(card._item); })
          .then(function (url) {
            if (url && card._th) { card._th.style.backgroundImage = 'url("' + url + '")'; card._th.classList.add('ok'); }
          })
          .catch(function () { if (card._th) card._th.classList.add('bad'); })
          .then(function () { S.active--; pump(); });
      })(S.queue.shift());
    }
  }

  function markCurrent() {
    var cards = document.querySelectorAll('#sdBody .sd-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('cur', !!(S.current && S.current.item.id === cards[i].dataset.id));
    }
  }

  // ------------------------------------------------------------------ панель
  function placeDrawer() {
    var tb = $('toolbar'), d = $('showDrawer');
    if (tb && d) d.style.top = tb.getBoundingClientRect().bottom + 'px';
  }

  function openDrawer(v) {
    S.open = !!v;
    var d = $('showDrawer');
    d.hidden = !S.open;
    if (S.open) {
      placeDrawer();
      if (!S.loaded) { S.loaded = true; scan(); }
    }
    refreshChip();
  }

  function init() {
    var host = window.host, campP = Promise.resolve();
    if (!$('showDrawer')) return;
    renderTabs();
    $('btnShow').onclick = function () { openDrawer(!S.open); };
    if ($('btnPickShow')) $('btnPickShow').onclick = function () { $('picker').hidden = true; openDrawer(true); };
    if (host && host.campaigns) {
      campP = host.campaigns.current().then(setCampaign).catch(function () {});
      host.campaigns.onChanged(setCampaign);
    }
    $('sdClose').onclick = function () { openDrawer(false); };
    $('sdRescan').onclick = function () {
      scan();
    };
    $('showChipX').onclick = function () { show(null); };
    $('sdSearch').oninput = function () {
      var v = this.value;
      clearTimeout(S.searchTimer);
      S.searchTimer = setTimeout(function () { S.query = v.trim(); renderGrid(); }, 120);
    };
    $('sdSearch').onkeydown = function (e) {
      if (e.key === 'Escape' && this.value) {
        e.preventDefault(); e.stopPropagation();
        this.value = ''; S.query = ''; renderGrid();
      }
    };
    $('sdCaption').onchange = function () {
      S.caption = this.checked;
      kvSet('showCaption', S.caption);
      if (S.current) resend();
    };
    window.addEventListener('resize', function () { if (S.open) placeDrawer(); });

    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (S.open && !modalOpen() && $('ctxMenu').hidden) openDrawer(false);
        return;
      }
      if (inputFocused() || modalOpen()) return;
      if (e.code === 'KeyB' || e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') {
        if (S.current) { e.preventDefault(); show(null); }
      }
    });

    VTT.sync.onHello(resend);

    campP.then(loadKv);
    // живое обновление каталога при изменении папок «Показа» на диске (кнопка ⟳ остаётся)
    if (host && host.watch) host.watch.onChange(function (ev) {
      if (ev && ev.kind === 'media' && (S.open || S.loaded)) { S.loaded = true; scan(true); }
    });
    refreshChip();
  }

  VTT.showcase = { init: init, show: show, resend: resend, isShowing: isShowing };
})();
