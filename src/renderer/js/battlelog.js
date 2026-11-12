/* VTT.blog — журнал боя и сохранение боя в .md-заметку.
 *
 * Журнал ведётся автоматически: начало/конец боя, ходы, раунды, урон и лечение (с источником), убийства,
 * смена статусов, удаление токенов. Хранится в памяти и зеркалится в host.kv (ключ 'pendingBattle'),
 * поэтому при закрытии окна не теряется: при следующем запуске приложение предложит сохранить бой.
 * Сохранение: корень 'battlelog' / <карта> <№> <дата время>.md; если папка не задана — выбрать папку или «Сохранить как…».
 * Если campaign.battlelog.enabled === false — журнал не ведётся и кнопки нет.
 */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;

  var B = null;            // текущий бой
  var KV = 'pendingBattle';
  var muted = false;
  var camp = null;         // текущая кампания (обновляется через setCampaign)
  function off() { return !!(camp && camp.battlelog && camp.battlelog.enabled === false); }

  function A() { return VTT.gm._api; }
  function S() { return VTT.gm._state; }
  function toast(m, ms) { try { A().toast(m, ms); } catch (e) { /* ignore */ } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mapName() { var m = S().map; return m ? (m.title || m.name || tr('blog.defaultMap')) : tr('blog.defaultMap'); }
  function round() { var s = S().scene; return s ? s.round : 1; }
  function isParty(kind) { return kind === 'pc' || kind === 'ally'; }
  // команда 1–4: задана на токене, иначе партия (pc) — 1, остальные — 2
  function teamOf(t) { return t && t.team > 0 && t.team <= 4 ? t.team : (t && t.kind === 'pc' ? 1 : 2); }

  // ------------------------------------------------------------------ состояние
  function persist() {
    try { VTT.store.setKV(KV, B ? JSON.parse(JSON.stringify(B)) : null); } catch (e) { /* ignore */ }
    paintBtn();
  }
  function reg(t) {
    if (!B || !t || !t.id) return null;
    var p = B.parts[t.id];
    if (!p) p = B.parts[t.id] = { id: t.id, name: t.name, kind: t.kind, maxHp: 0, ac: 0, status: 'ok', removed: false, team: teamOf(t) };
    p.name = t.name; p.kind = t.kind; p.team = teamOf(t);
    if (t.maxHp > 0) p.maxHp = t.maxHp;
    if (t.ac > 0) p.ac = t.ac;
    if (t.status) p.status = t.status;
    return p;
  }
  function ensure() {
    if (B) return B;
    if (off()) return null;
    B = { map: mapName(), started: Date.now(), ended: null, entries: [], parts: {} };
    var s = S().scene;
    if (s) s.tokens.forEach(reg);
    return B;
  }
  function push(e) {
    if (off() || !ensure()) return;
    e.t = Date.now(); e.r = round();
    B.entries.push(e);
    persist();
  }
  function hasData() { return !off() && !!(B && B.entries.length); }

  // ------------------------------------------------------------------ события (вызываются из combat.js / gm.js)
  function onStart() {
    return (async function () {
      if (off()) return;
      if (B && B.ended && hasData()) await promptSave(tr('blog.prompt.prevUnsaved'));
      ensure(); B.ended = null;
      var s = S().scene;
      if (s) s.tokens.forEach(reg);
      push({ k: 'start' });
    })();
  }
  function onEnd() { if (!B) return; B.ended = Date.now(); push({ k: 'end' }); }
  function onTurn(t) { if (!t) return; reg(t); push({ k: 'turn', tid: t.id, tn: t.name }); }
  function onRound(n) { push({ k: 'round', n: n }); }
  // t — цель, prev/next — HP до/после, op — '-', '+', '=' ; n — введённое число; src — токен-источник или null
  function onHp(t, prev, next, op, n, src, newStatus) {
    if (off() || !ensure()) return; reg(t); if (src) reg(src);
    var base = { tid: t.id, tn: t.name, sid: src ? src.id : null, sn: src ? src.name : null, from: prev, to: next };
    if (prev != null && next < prev) {
      push(Object.assign({ k: 'dmg', amt: op === '-' ? n : prev - next }, base));
    } else if (prev != null && next > prev) {
      push(Object.assign({ k: 'heal', amt: next - prev }, base));
    }
    if (newStatus === 'dead' || newStatus === 'unconscious') {
      var p = reg(t); if (p) p.status = newStatus;
      push({ k: 'kill', tid: t.id, tn: t.name, sid: src ? src.id : null, sn: src ? src.name : null, how: newStatus });
    } else if (newStatus === 'ok') {
      var q = reg(t); if (q) q.status = 'ok';
      push({ k: 'status', tid: t.id, tn: t.name, st: 'ok' });
    }
  }
  function onStatus(t, st) {
    if (muted || off()) return;
    if (!hasData() && !(S().scene && S().scene.combat && S().scene.combat.active)) return;
    if (!ensure()) return;
    var p = reg(t); if (p) p.status = st;
    if (st === 'dead' || st === 'unconscious') push({ k: 'kill', tid: t.id, tn: t.name, sid: null, sn: null, how: st });
    else push({ k: 'status', tid: t.id, tn: t.name, st: st });
  }
  function onTeam(t) { if (B && B.parts[t.id]) { reg(t); push({ k: 'team', tid: t.id, tn: t.name, team: teamOf(t) }); } }
  function onRemoved(t) {
    if (!B) return;
    var p = reg(t); if (p) p.removed = true;
    push({ k: 'removed', tid: t.id, tn: t.name });
  }

  // ------------------------------------------------------------------ расчёт и текст заметки
  var STATUS_KEYS = ['ok', 'dead', 'unconscious', 'incapacitated'];
  function statusName(s) { return STATUS_KEYS.indexOf(s) >= 0 ? tr('token.statusShort.' + s) : s; }
  function stats(b) {
    var st = {};
    Object.keys(b.parts).forEach(function (id) { st[id] = { dmgIn: 0, dmgOut: 0, heal: 0, kills: [] }; });
    b.entries.forEach(function (e) {
      if (e.k === 'dmg') {
        if (st[e.tid]) st[e.tid].dmgIn += e.amt;
        if (e.sid && st[e.sid]) st[e.sid].dmgOut += e.amt;
      } else if (e.k === 'heal') { if (st[e.tid]) st[e.tid].heal += e.amt; }
      else if (e.k === 'kill' && e.sid && st[e.sid]) st[e.sid].kills.push(e.tn + (e.how === 'unconscious' ? ' (' + tr('token.statusShort.unconscious') + ')' : ''));
    });
    return st;
  }
  function two(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + '-' + pad(d.getMinutes()); }
  function clock(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function esc(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|'); }

  function buildNote(b, num) {
    var st = stats(b), ids = Object.keys(b.parts);
    var end = b.ended || Date.now(), maxR = 1;
    b.entries.forEach(function (e) { if (e.r > maxR) maxR = e.r; });
    var mins = Math.max(0, Math.round((end - b.started) / 60000));
    var tn = function (i) { return b.parts[i].team || 2; };
    ids.sort(function (x, y) { return (tn(x) - tn(y)) || String(b.parts[x].name).localeCompare(b.parts[y].name, VTT.i18n.lang); });
    var byTeam = {};
    ids.forEach(function (i) { (byTeam[tn(i)] = byTeam[tn(i)] || []).push(i); });
    var teamLine = Object.keys(byTeam).map(function (k) { return tr('blog.teamCount', { team: k, n: byTeam[k].length }); }).join(', ');
    var L = [];
    L.push('---');
    L.push(tr('blog.fm.type'));
    L.push(tr('blog.fm.map', { map: b.map }));
    L.push(tr('blog.fm.num', { num: num }));
    L.push(tr('blog.fm.date', { date: two(new Date(b.started)) }));
    L.push(tr('blog.fm.rounds', { n: maxR }));
    L.push(tr('blog.fm.minutes', { n: mins }));
    L.push(tr('blog.fm.finished', { v: b.ended ? tr('blog.fm.yes') : tr('blog.fm.noSaved') }));
    L.push('---');
    L.push('');
    L.push(tr('blog.title', { map: b.map, num: num, date: two(new Date(b.started)).replace(/-(\d\d)$/, ':$1') }));
    L.push('');
    L.push(tr('blog.summary', { rounds: maxR, mins: mins, count: ids.length, teams: teamLine }));
    L.push('');
    L.push(tr('blog.h.participants'));
    L.push('');
    L.push(tr('blog.table.header'));
    L.push('|---|---|---|---|---|---|---|---|---|');
    ids.forEach(function (id) {
      var p = b.parts[id], s = st[id];
      L.push('| ' + esc(p.name) + ' | ' + (p.team || 2) + ' | ' + (p.ac || '—') + ' | ' + (p.maxHp || '—') + ' | ' +
        s.dmgIn + ' | ' + s.dmgOut + ' | ' + s.heal + ' | ' + s.kills.length + ' | ' + (p.removed && p.status === 'ok' ? tr('blog.outcome.removed') : statusName(p.status)) + ' |');
    });
    L.push('');
    L.push(tr('blog.h.kills'));
    L.push('');
    var kills = b.entries.filter(function (e) { return e.k === 'kill'; });
    if (!kills.length) L.push(tr('blog.kills.none'));
    kills.forEach(function (e) {
      var kt = e.sid && b.parts[e.sid] ? b.parts[e.sid].team : null, vt = b.parts[e.tid] ? b.parts[e.tid].team : null;
      L.push(tr('blog.kills.line', {
        r: e.r,
        src: e.sn ? '**' + e.sn + '**' + (kt ? tr('blog.teamTag', { n: kt }) : '') : tr('blog.noSource.md'),
        victim: '**' + e.tn + '**' + (vt ? tr('blog.teamTag', { n: vt }) : ''),
        how: tr('token.statusShort.' + (e.how === 'unconscious' ? 'unconscious' : 'dead')),
        friendly: kt && vt && kt === vt ? tr('blog.friendlyFire') : ''
      }));
    });
    L.push('');
    L.push(tr('blog.h.damage'));
    L.push('');
    var any = false;
    ids.forEach(function (id) {
      var s = st[id];
      if (!s.dmgIn) return;
      any = true;
      var bySrc = {};
      b.entries.forEach(function (e) { if (e.k === 'dmg' && e.tid === id) { var k = e.sn || tr('blog.noSource'); bySrc[k] = (bySrc[k] || 0) + e.amt; } });
      L.push(tr('blog.dmg.line', {
        name: b.parts[id].name, team: b.parts[id].team || 2, amt: s.dmgIn,
        of: b.parts[id].maxHp ? tr('blog.dmg.of', { max: b.parts[id].maxHp }) : '',
        list: Object.keys(bySrc).map(function (k) { return k + ' ' + bySrc[k]; }).join(', ')
      }));
    });
    if (!any) L.push(tr('blog.dmg.none'));
    L.push('');
    L.push(tr('blog.h.chronology'));
    L.push('');
    b.entries.forEach(function (e) {
      var pre = tr('blog.chron.prefix', { time: clock(e.t), r: e.r }), tx = null;
      if (e.k === 'start') tx = tr('blog.ev.start');
      else if (e.k === 'end') tx = tr('blog.ev.end');
      else if (e.k === 'round') tx = tr('blog.ev.round', { n: e.n });
      else if (e.k === 'turn') tx = tr('blog.ev.turn', { name: e.tn });
      else if (e.k === 'dmg') tx = tr('blog.ev.dmg', { src: e.sn || tr('blog.ev.noSource'), name: e.tn, amt: e.amt, hp: e.to != null ? tr('blog.ev.hpChange', { from: e.from, to: e.to }) : '' });
      else if (e.k === 'heal') tx = tr('blog.ev.heal', { src: e.sn ? e.sn + ' → ' : '', name: e.tn, amt: e.amt, from: e.from, to: e.to });
      else if (e.k === 'kill') tx = tr('blog.ev.kill', { name: e.tn, how: tr('token.statusShort.' + (e.how === 'unconscious' ? 'unconscious' : 'dead')), src: e.sn ? ' (' + e.sn + ')' : '' });
      else if (e.k === 'team') tx = tr('blog.ev.team', { name: e.tn, team: e.team });
      else if (e.k === 'status') tx = tr('blog.ev.status', { name: e.tn, status: statusName(e.st) });
      else if (e.k === 'removed') tx = tr('blog.ev.removed', { name: e.tn });
      if (tx) L.push(pre + tx);
    });
    L.push('');
    return L.join('\n');
  }

  // ------------------------------------------------------------------ запись файла
  function safe(s) { return String(s).replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim(); }
  function bom(text) { return '\uFEFF' + text; }

  // папка журнала: из кампании или (по выбору) новая; null — сохранить через «Сохранить как…»; false — отмена
  async function ensureFolder() {
    if (camp && camp.folders && camp.folders.battlelog) return true;
    var pickIt = await VTT.ui.confirm({
      title: tr('blog.folder.title'),
      text: tr('blog.folder.text'),
      ok: tr('blog.folder.pick'), cancel: tr('blog.folder.saveAs')
    });
    if (!pickIt) return null;
    var dir = await window.host.dialog.pickFolder({ title: tr('blog.folder.pickTitle') });
    if (!dir) return false;
    var c = await window.host.campaigns.update(camp.id, { folders: { battlelog: dir } });
    camp = c || camp;
    return true;
  }

  async function writeNote(b) {
    var name = safe(b.map), when = two(new Date(b.started)), num = 1;
    var mode = await ensureFolder();
    if (mode === false) return { saved: false };
    if (mode === true) {
      var re = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+) ');
      var list = [];
      try { list = await window.host.fs.list('battlelog', '', { recursive: false }); } catch (e) { list = []; }
      list.forEach(function (en) {
        var m = !en.isDir && re.exec(en.name);
        if (m) num = Math.max(num, parseInt(m[1], 10) + 1);
      });
      var fname = name + ' ' + num + ' ' + when + '.md';
      await window.host.fs.writeText('battlelog', fname, buildNote(b, num), { bom: true });
      return { saved: true, name: fname, where: camp.folders.battlelog };
    }
    var fn2 = name + ' ' + when + '.md';
    var p = await window.host.dialog.saveFile({ title: tr('blog.save.title'), defaultName: fn2, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!p) return { saved: false };
    await window.host.fs.writeAbs(p, bom(buildNote(b, 1)));
    return { saved: true, name: p.split(/[\\/]/).pop(), where: tr('blog.where.file') };
  }

  // сохранить текущий бой; true — записан
  async function save() {
    if (!hasData()) { toast(tr('blog.toast.empty')); return false; }
    var b = B;
    try {
      var r = await writeNote(b);
      if (!r.saved) return false;
      toast(tr('blog.toast.saved', { name: r.name, where: r.where }), 6000);
      B = null; persist();
      return true;
    } catch (e) {
      console.warn('save battle', e);
      VTT.ui.alert({ title: tr('blog.err.title'), text: tr('blog.err.text', { msg: e && e.message || e }) });
      return false;
    }
  }
  // спросить «сохранить / не сохранять»; после ответа журнал очищается (кроме неудачной записи)
  async function promptSave(text) {
    if (!hasData()) { B = null; persist(); return; }
    var yes = await VTT.ui.confirm({ title: tr('blog.prompt.title'), text: text || tr('blog.prompt.default'), ok: tr('common.save'), cancel: tr('blog.prompt.dontSave') });
    if (yes) { await save(); }
    else { B = null; persist(); }
  }

  // ------------------------------------------------------------------ интерфейс
  function paintBtn() {
    var b = document.getElementById('cbSave'); if (!b) return;
    b.hidden = off();
    var n = B ? B.entries.length : 0;
    b.textContent = tr('combat.cbSave') + (n ? ' (' + n + ')' : '');
    b.classList.toggle('primary', !!n);
  }
  var campId;   // id кампании, для которой ведётся B (undefined — ещё не знаем)
  function setCampaign(c) {
    camp = c || null;
    var id = camp ? camp.id : null;
    var switched = campId !== undefined && id !== campId;
    campId = id;
    if (off() || switched) B = null;     // при смене кампании бой остаётся в kv прежней кампании и не «переезжает»
    paintBtn();
    if (switched) checkLeftover().catch(function () { /* ignore */ });
  }
  // незакрытый бой с прошлого запуска
  function checkLeftover() {
    if (off()) return Promise.resolve();
    return Promise.resolve(VTT.store.getKV(KV)).then(function (old) {
      if (!old || !old.entries || !old.entries.length) return;
      B = old; paintBtn();
      return promptSave(tr('blog.prompt.leftover', { map: old.map, entries: VTT.i18n.plural(old.entries.length, 'blog.entries') }));
    });
  }
  function init() {
    var b = document.getElementById('cbSave');
    if (b) b.onclick = function () { save(); };
    var campP = window.host.campaigns.current().then(setCampaign).catch(function () {});
    window.host.campaigns.onChanged(setCampaign);
    campP.then(checkLeftover).catch(function () { /* ignore */ });
    paintBtn();
  }

  VTT.blog = {
    mute: function (v) { muted = !!v; }, init: init, save: save, promptSave: promptSave, hasData: hasData,
    onStart: onStart, onEnd: onEnd, onTurn: onTurn, onRound: onRound, onHp: onHp, onStatus: onStatus, onRemoved: onRemoved, onTeam: onTeam, teamOf: teamOf
  };
})();
