/* VTT.combat — панель мастера: инициатива, здоровье, кубики, счётчики.
 *
 * Данные (всё хранится в сцене, старые сцены работают без миграции):
 *   scene.combat   = { active:bool, order:[tokenId], turnId:tokenId|null }
 *   scene.counters = [{ id, name, value, perRound:-1|0|1, tokenId|null }]
 *   token.init (число|undefined), token.initMod, token.hp, token.maxHp, token.ac (КД)
 * Здоровье и инициатива врагов игрокам не уходят (см. gm.pushState); у партии и союзников — только полоска HP.
 */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function G() { return VTT.gm; }
  function A() { return VTT.gm._api; }
  function toast(m, ms) { A().toast(m, ms); }

  function sc() {
    var s = G()._state.scene;
    if (!s) return null;
    if (!s.combat) s.combat = { active: false, order: [], turnId: null };
    if (!Array.isArray(s.counters)) s.counters = [];
    return s;
  }
  function hasInit(t) { return typeof t.init === 'number' && isFinite(t.init); }
  function eligible(t) { return hasInit(t) && t.status !== 'dead'; }
  function isParty(t) { return t.kind === 'pc' || t.kind === 'ally'; }

  // токены в порядке боя; новые токены дописываются в конец
  function ordered(s) {
    var byId = {}, ids = [], out = [];
    s.tokens.forEach(function (t) { byId[t.id] = t; });
    s.combat.order.forEach(function (id) { if (byId[id] && ids.indexOf(id) < 0) ids.push(id); });
    s.tokens.forEach(function (t) { if (ids.indexOf(t.id) < 0) ids.push(t.id); });
    s.combat.order = ids;
    ids.forEach(function (id) { out.push(byId[id]); });
    return out;
  }

  // ------------------------------------------------------------------ инициатива
  function sortOrder() {
    var s = sc(); if (!s) return;
    var ts = ordered(s).slice();
    ts.sort(function (a, b) {
      var ai = hasInit(a), bi = hasInit(b);
      if (ai !== bi) return ai ? -1 : 1;
      if (!ai) return 0;
      return (b.init - a.init) || ((b.initMod || 0) - (a.initMod || 0));
    });
    s.combat.order = ts.map(function (t) { return t.id; });
  }

  var dlog = [];   // журнал бросков (только в памяти)
  function rollInit(t) {
    var mod = t.initMod || 0;
    var r = VTT.dice.roll('d20' + (mod >= 0 ? '+' : '') + mod);
    t.init = r.total;
    pushLog(r, 'Инициатива: ' + t.name);
    if (!t.hidden && $('diceShow') && $('diceShow').checked) sendRoll(r, t.name);   // скрытым врагам инициативу игрокам не показываем
    return r;
  }
  function rollAll(all) {
    var s = sc(); if (!s) return;
    var n = 0;
    s.tokens.forEach(function (t) {
      if (t.status === 'dead') return;
      if (all || !hasInit(t)) { rollInit(t); n++; }
    });
    if (!n) { toast('У всех уже есть инициатива (Shift — перебросить всем)'); return; }
    sortOrder();
    A().changed();
    toast('Брошено инициатив: ' + n);
  }
  async function clearInit() {
    var s = sc(); if (!s) return;
    if (!(await VTT.ui.confirm({ title: 'Сбросить инициативу', text: 'Убрать инициативу у всех и закончить бой?', ok: 'Сбросить' }))) return;
    s.tokens.forEach(function (t) { delete t.init; });
    if (s.combat.active && VTT.blog) VTT.blog.onEnd();
    s.combat.active = false; s.combat.turnId = null;
    A().changed();
  }
  function start() {
    var s = sc(); if (!s) return;
    sortOrder();
    var first = ordered(s).filter(eligible)[0];
    if (!first) { toast('Сначала задайте инициативу (🎲 у токена или «Бросить инициативу»)', 3500); return; }
    s.combat.active = true; s.combat.turnId = first.id;
    s.round = 1;
    if (VTT.blog) VTT.blog.onStart();
    s.tokens.forEach(function (t) { t.moved = 0; });
    G()._state.undo = [];
    A().changed();
    A().selectToken(first.id, true);
    toast('Бой начался · ход: ' + first.name);
  }
  function end() {
    var s = sc(); if (!s || !s.combat.active) return;
    s.combat.active = false; s.combat.turnId = null;
    if (VTT.blog) VTT.blog.onEnd();
    A().changed();
    toast('Бой окончен');
  }
  function step(dir) {
    var s = sc(); if (!s) return;
    if (!s.combat.active) { if (dir > 0) start(); return; }
    var full = ordered(s), n = full.length, idx = -1, wrapped = false, pick = null, k, j;
    full.forEach(function (t, i) { if (t.id === s.combat.turnId) idx = i; });
    for (k = 1; k <= n; k++) {
      j = idx + dir * k;
      if (j >= n || j < 0) wrapped = true;
      var t = full[((j % n) + n) % n];
      if (eligible(t)) { pick = t; break; }
    }
    if (!pick) { toast('Нет участников с инициативой'); return; }
    s.combat.turnId = pick.id;
    if (VTT.blog) VTT.blog.onTurn(pick);
    if (wrapped && dir > 0) A().newRound();
    else if (wrapped && dir < 0 && s.round > 1) { s.round--; A().changed(); }
    else A().changed();
    A().selectToken(pick.id, true);
    toast('Ход: ' + pick.name);
  }

  // ------------------------------------------------------------------ здоровье
  function srcToken() {
    var v = $('cbSrc') ? $('cbSrc').value : 'auto', s = sc();
    if (v === 'none') return null;
    if (v === 'auto') return s && s.combat.active && s.combat.turnId ? A().getToken(s.combat.turnId) || null : null;
    return A().getToken(v) || null;
  }
  function renderSrc(s) {
    var sel = $('cbSrc'); if (!sel) return;
    var keep = sel.value;
    sel.textContent = '';
    [['auto', 'по ходу (чей ход)'], ['none', 'не указан / среда']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; sel.appendChild(op); });
    if (s) s.tokens.forEach(function (t) { var op = el('option', '', t.name); op.value = t.id; sel.appendChild(op); });
    sel.value = keep; if (sel.value !== keep) sel.value = 'auto';
  }
  function applyHp(t, txt) {
    var m = /^\s*([+\-−=]?)\s*(\d+)\s*$/.exec(String(txt));
    if (!m) { toast('Здоровье: −5 урон · +5 лечение · 20 или =20 задать'); return false; }
    var sign = m[1] === '−' ? '-' : m[1], n = parseInt(m[2], 10), prev = t.hp;
    var prevEff = prev != null ? prev : (t.maxHp > 0 ? t.maxHp : null);
    if (!(t.maxHp > 0)) {
      if (sign === '' || sign === '=') { t.maxHp = n; t.hp = n; }
      else { toast('Сначала задайте максимум HP (поле «макс»)'); return false; }
    } else if (sign === '' || sign === '=') t.hp = Math.min(t.maxHp, n);
    else if (sign === '+') t.hp = Math.min(t.maxHp, (t.hp == null ? t.maxHp : t.hp) + n);
    else t.hp = Math.max(0, (t.hp == null ? t.maxHp : t.hp) - n);
    var st = null;
    if (t.hp <= 0 && (t.status === 'ok' || t.status === 'incapacitated')) st = isParty(t) ? 'unconscious' : 'dead';
    else if (t.hp > 0 && (prev == null || prev <= 0) && (t.status === 'unconscious' || t.status === 'dead')) st = 'ok';
    if (VTT.blog) VTT.blog.onHp(t, prevEff, t.hp, sign, n, srcToken(), st);
    if (st) { if (VTT.blog) VTT.blog.mute(true); A().setStatus(t, st); if (VTT.blog) VTT.blog.mute(false); toast(t.name + ': ' + (st === 'dead' ? 'убит' : st === 'unconscious' ? 'без сознания' : 'в строю')); }
    else A().changed({ noList: true });
    return true;
  }

  // ------------------------------------------------------------------ кубики
  function pushLog(r, who) {
    dlog.unshift({ r: r, who: who || '' });
    if (dlog.length > 40) dlog.pop();
    renderLog();
  }
  function renderLog() {
    var box = $('diceLog'); if (!box) return;
    box.textContent = '';
    dlog.forEach(function (e) {
      var row = el('div', 'dl' + (e.r.d20 === 20 ? ' nat20' : e.r.d20 === 1 ? ' nat1' : ''));
      row.title = 'Клик — показать игрокам';
      row.appendChild(el('b', 'dt', e.r.total));
      var txt = el('div', 'dx');
      txt.appendChild(el('div', 'dh', (e.who ? e.who + ' · ' : '') + e.r.expr));
      txt.appendChild(el('div', 'dd', e.r.text));
      row.appendChild(txt);
      row.onclick = function () { sendRoll(e.r, e.who); toast('Показано игрокам'); };
      box.appendChild(row);
    });
  }
  function sendRoll(r, who) {
    VTT.sync.send({ t: 'roll', who: who || '', expr: r.expr, total: r.total, text: r.text, d20: r.d20, sides: r.sides });
  }
  function doRoll(expr, who) {
    var r;
    try { r = VTT.dice.roll(expr); } catch (e) { toast(e.message, 3500); return null; }
    pushLog(r, who);
    if ($('diceShow') && $('diceShow').checked) sendRoll(r, who);
    return r;
  }
  // --- сборка формулы кликами по кубикам ---
  function splitSuffix(s) {
    var m = /\s+(adv|dis)\s*$/i.exec(s);
    return m ? { base: s.slice(0, m.index), suf: ' ' + m[1].toLowerCase() } : { base: s, suf: '' };
  }
  function setExpr(base, suf) {
    $('diceExpr').value = (base + (suf || '')).replace(/^\s*\+/, '');
    $('diceAdv').classList.toggle('active', suf === ' adv');
    $('diceDis').classList.toggle('active', suf === ' dis');
  }
  function addDie(n) {
    var p = splitSuffix($('diceExpr').value.trim()), base = p.base.trim(), done = false;
    var re = new RegExp('(^|[+\\-−\\s])(\\d*)d' + n + '(?![\\d\\w])', 'i');
    base = base.replace(re, function (m, pre, cnt) { done = true; return pre + ((cnt === '' ? 1 : parseInt(cnt, 10)) + 1) + 'd' + n; });
    if (!done) base = base ? base + '+1d' + n : '1d' + n;
    setExpr(base, p.suf);
  }
  function addMod(delta) {
    var p = splitSuffix($('diceExpr').value.trim()), base = p.base.trim() || 'd20';
    var re = /([+\-−]?)\s*(\d*[dд]\d+(?:(?:kh|kl|dh|dl)\d*)?|\d+)/gi, m, last = null;
    while ((m = re.exec(base))) last = m;
    if (last && /^\d+$/.test(last[2])) {                 // последнее слагаемое — число: меняем его
      var v = (last[1] === '-' || last[1] === '−' ? -1 : 1) * parseInt(last[2], 10) + delta;
      base = base.slice(0, last.index) + (v === 0 ? '' : (v > 0 ? '+' : '−') + Math.abs(v)) + base.slice(last.index + last[0].length);
    } else base = base + (delta > 0 ? '+' : '−') + Math.abs(delta);
    setExpr(base.replace(/^\+/, '').trim(), p.suf);
  }
  function toggleAdv(kind) {
    var p = splitSuffix($('diceExpr').value.trim()), want = ' ' + kind;
    var base = p.base.trim() || 'd20';
    setExpr(base, p.suf === want ? '' : want);
  }

  // ------------------------------------------------------------------ счётчики
  function addCounter() {
    var s = sc(); if (!s) { toast('Сначала откройте карту'); return; }
    var name = $('cnName').value.trim();
    if (!name) { $('cnName').focus(); return; }
    s.counters.push({
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name, value: Math.max(0, parseInt($('cnVal').value, 10) || 0),
      perRound: parseInt($('cnTick').value, 10) || 0, tokenId: $('cnTok').value || null
    });
    $('cnName').value = '';
    A().changed({ noList: true });
    renderCounters();
  }
  function renderCounters() {
    var box = $('cnList'); if (!box) return;
    var s = sc(); box.textContent = '';
    var sel = $('cnTok'), keep = sel.value;
    sel.textContent = '';
    sel.appendChild(el('option', '', 'Ни к кому')).value = '';
    if (s) s.tokens.forEach(function (t) { var o = el('option', '', t.name); o.value = t.id; sel.appendChild(o); });
    sel.value = keep;
    if (!s) return;
    s.counters.forEach(function (c) {
      var tok = c.tokenId ? A().getToken(c.tokenId) : null;
      var row = el('div', 'cn' + (c.perRound < 0 && c.value === 0 ? ' expired' : ''));
      var l1 = el('div', 'l1');
      l1.appendChild(el('span', 'nm', c.name));
      if (tok) l1.appendChild(el('span', 'tg', tok.name));
      if (c.perRound) l1.appendChild(el('span', 'tk', (c.perRound < 0 ? '−1' : '+1') + '/раунд'));
      var x = el('button', '', '✕'); x.title = 'Удалить счётчик';
      x.onclick = function () { s.counters = s.counters.filter(function (o) { return o.id !== c.id; }); A().changed({ noList: true }); renderCounters(); };
      l1.appendChild(x);
      var l2 = el('div', 'l2');
      var minus = el('button', '', '−'), plus = el('button', '', '+');
      var val = el('input'); val.type = 'text'; val.value = c.value; val.className = 'cv';
      function set(v) { c.value = Math.max(0, v); A().changed({ noList: true }); renderCounters(); }
      minus.onclick = function () { set(c.value - 1); };
      plus.onclick = function () { set(c.value + 1); };
      val.onchange = function () { set(parseInt(val.value, 10) || 0); };
      l2.appendChild(minus); l2.appendChild(val); l2.appendChild(plus);
      row.appendChild(l1); row.appendChild(l2);
      box.appendChild(row);
    });
    if (!s.counters.length) box.appendChild(el('div', 'muted small', 'Нет счётчиков. Например: «Факел» 10, −1 за раунд.'));
  }
  function onNewRound() {
    var s = sc(); if (!s) return;
    s.counters.forEach(function (c) {
      if (!c.perRound) return;
      var was = c.value;
      c.value = Math.max(0, c.value + c.perRound);
      if (c.perRound < 0 && was > 0 && c.value === 0) toast('Счётчик «' + c.name + '» истёк', 4000);
    });
  }

  // ------------------------------------------------------------------ рендер трекера
  function paintHp(row, t) {
    var tx = row.querySelector('.hpt'), bar = row.querySelector('.hpb > i');
    if (t.maxHp > 0 && t.hp != null) {
      var f = Math.max(0, Math.min(1, t.hp / t.maxHp));
      tx.textContent = t.hp + ' / ' + t.maxHp;
      bar.style.width = (f * 100) + '%';
      bar.style.background = f > 0.5 ? '#3fb950' : f > 0.25 ? '#d29922' : '#f85149';
    } else { tx.textContent = '— HP'; bar.style.width = '0'; }
    row.querySelector('.cx').value = t.maxHp > 0 ? t.maxHp : '';
  }

  function buildRow(t, s) {
    var row = el('div', 'cb k-' + t.kind +
      (s.combat.active && s.combat.turnId === t.id ? ' turn' : '') +
      (t.status === 'dead' ? ' dead' : '') + (hasInit(t) ? '' : ' noinit') + (t.hidden ? ' hid' : ''));
    var l1 = el('div', 'l1');
    l1.appendChild(el('span', 'mk', '▶'));
    var ini = el('input', 'ci'); ini.type = 'text'; ini.value = hasInit(t) ? t.init : ''; ini.placeholder = '—';
    ini.title = 'Инициатива (число)';
    ini.onchange = function () {
      var v = parseFloat(String(ini.value).replace(',', '.'));
      if (isFinite(v)) t.init = v; else delete t.init;
      row.classList.toggle('noinit', !hasInit(t));
      A().changed({ noList: true });
    };
    var dice = el('button', 'cd', '🎲'); dice.title = 'Бросить инициативу d20 + модификатор';
    dice.onclick = function () {
      var r = rollInit(t); ini.value = t.init;
      row.classList.remove('noinit');
      A().changed({ noList: true });
      toast(t.name + ': ' + r.text);
    };
    var nm = el('span', 'nm', t.name); nm.title = t.name;
    nm.onclick = function () { A().selectToken(t.id, true); };
    l1.appendChild(ini); l1.appendChild(dice); l1.appendChild(nm);
    var l2 = el('div', 'l2');
    var hp = el('div', 'hp');
    hp.appendChild(el('span', 'hpt'));
    var hb = el('div', 'hpb'); hb.appendChild(document.createElement('i')); hp.appendChild(hb);
    var dmg = el('input', 'cd2'); dmg.type = 'text'; dmg.placeholder = '−5 / +5'; dmg.title = 'Урон −5, лечение +5, значение 20 или =20';
    dmg.onchange = function () { var v = dmg.value; dmg.value = ''; if (v.trim()) { applyHp(t, v); paintHp(row, t); } };
    var mx = el('input', 'cx'); mx.type = 'text'; mx.placeholder = 'макс'; mx.title = 'Максимум HP';
    mx.onchange = function () {
      var v = parseInt(mx.value, 10);
      if (v > 0) { var had = t.maxHp > 0; t.maxHp = v; t.hp = had && t.hp != null ? Math.min(t.hp, v) : v; }
      else { delete t.maxHp; delete t.hp; }
      paintHp(row, t); A().changed({ noList: true });
    };
    var md = el('input', 'cm'); md.type = 'text'; md.placeholder = 'мод'; md.title = 'Модификатор инициативы';
    md.value = t.initMod ? t.initMod : '';
    md.onchange = function () { t.initMod = parseInt(md.value, 10) || 0; A().changed({ noList: true }); };
    var ac = el('input', 'ca'); ac.type = 'text'; ac.placeholder = 'КД'; ac.title = 'Класс доспеха (КД)';
    ac.value = t.ac > 0 ? t.ac : '';
    ac.onchange = function () { var v = parseInt(ac.value, 10); if (v > 0) t.ac = v; else delete t.ac; A().changed({ noList: true }); };
    var tm = el('select', 'ct'); tm.title = 'Команда (по умолчанию: партия — 1, остальные — 2)';
    var curTeam = VTT.blog ? VTT.blog.teamOf(t) : (t.team > 0 ? t.team : (t.kind === 'pc' ? 1 : 2));
    [1, 2, 3, 4].forEach(function (n) { var o = el('option', '', 'К' + n); o.value = n; tm.appendChild(o); });
    tm.value = curTeam;
    tm.onchange = function () { t.team = parseInt(tm.value, 10); A().changed({ noList: true }); if (VTT.blog) VTT.blog.onTeam(t); };
    l2.appendChild(hp); l2.appendChild(dmg); l2.appendChild(mx); l2.appendChild(ac); l2.appendChild(tm); l2.appendChild(md);
    row.appendChild(l1); row.appendChild(l2);
    paintHp(row, t);
    row.oncontextmenu = function (e) { e.preventDefault(); };
    return row;
  }

  function render() {
    var box = $('cbTracker'); if (!box) return;
    var s = sc();
    box.textContent = '';
    renderCounters(); renderSrc(s);
    if (!s) { $('cbState').textContent = ''; return; }
    $('cbState').textContent = s.combat.active ? '· раунд ' + s.round : '· не начат';
    $('cbQueue').checked = !!(s.settings && s.settings.showQueue);
    $('cbStart').hidden = s.combat.active;
    $('cbNext').hidden = !s.combat.active; $('cbPrev').hidden = !s.combat.active; $('cbEnd').hidden = !s.combat.active;
    var ts = ordered(s);
    ts.forEach(function (t) { box.appendChild(buildRow(t, s)); });
    if (!ts.length) box.appendChild(el('div', 'muted small', 'Поставьте токены — они появятся здесь.'));
  }

  function bind() {
    $('cbRoll').onclick = function (e) { rollAll(e.shiftKey); };
    $('cbSort').onclick = function () { sortOrder(); A().changed(); };
    $('cbClear').onclick = clearInit;
    $('cbStart').onclick = start;
    $('cbNext').onclick = function () { step(1); };
    $('cbPrev').onclick = function () { step(-1); };
    $('cbEnd').onclick = end;

    var db = $('diceBtns');
    [4, 6, 8, 10, 12, 20, 100].forEach(function (n) {
      var b = document.createElement('button');
      b.className = 'die'; b.title = 'd' + n + ' — добавить в формулу';
      b.innerHTML = VTT.dice.svg(n, { size: 30 }) + '<span>d' + n + '</span>';
      b.onclick = function () { addDie(n); };
      db.appendChild(b);
    });
    $('diceAdv').onclick = function () { toggleAdv('adv'); };
    $('diceDis').onclick = function () { toggleAdv('dis'); };
    $('dicePlus').onclick = function () { addMod(1); };
    $('diceMinus').onclick = function () { addMod(-1); };
    $('diceReset').onclick = function () { setExpr('', ''); $('diceExpr').focus(); };
    function formula() {
      var v = $('diceExpr').value.trim();
      if (!v) { toast('Выберите кубики или введите формулу'); return; }
      doRoll(v);
    }
    $('diceGo').onclick = formula;
    $('diceExpr').onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') formula(); };
    $('diceExpr').oninput = function () {
      var p = splitSuffix($('diceExpr').value);
      $('diceAdv').classList.toggle('active', p.suf === ' adv');
      $('diceDis').classList.toggle('active', p.suf === ' dis');
    };
    $('cbQueue').onchange = function () {
      var s = sc(); if (!s) return;
      s.settings.showQueue = $('cbQueue').checked;
      A().changed({ noList: true });
    };
    $('diceClear').onclick = function () { dlog = []; renderLog(); };
    $('cnAdd').onclick = addCounter;
    $('cnName').onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') addCounter(); };
  }

  VTT.combat = {
    init: function () { bind(); render(); renderLog(); },
    render: render,
    next: function () { step(1); },
    prev: function () { step(-1); },
    onNewRound: onNewRound,
    applyHp: applyHp,
    sortOrder: sortOrder,
    // очередь для экрана игроков: только участники, которых игроки видят (visIds — id токенов, ушедших в state)
    queueFor: function (visIds) {
      var s = sc();
      if (!s || !s.combat.active || !(s.settings && s.settings.showQueue)) return null;
      return ordered(s).filter(function (t) { return eligible(t) && visIds[t.id]; }).map(function (t) {
        return { id: t.id, name: t.name, label: t.label, color: t.color, kind: t.kind, hasImage: !!t.image, turn: t.id === s.combat.turnId };
      });
    }
  };
})();
