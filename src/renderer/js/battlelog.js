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

  var B = null;            // текущий бой
  var KV = 'pendingBattle';
  var muted = false;
  var camp = null;         // текущая кампания (обновляется через setCampaign)
  function off() { return !!(camp && camp.battlelog && camp.battlelog.enabled === false); }

  function A() { return VTT.gm._api; }
  function S() { return VTT.gm._state; }
  function toast(m, ms) { try { A().toast(m, ms); } catch (e) { /* ignore */ } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mapName() { var m = S().map; return m ? (m.title || m.name || 'Карта') : 'Карта'; }
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
      if (B && B.ended && hasData()) await promptSave('Предыдущий бой не сохранён. Сохранить его перед началом нового?');
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
  var STATUS = { ok: 'в строю', dead: 'убит', unconscious: 'без сознания', incapacitated: 'недееспособен' };
  function stats(b) {
    var st = {};
    Object.keys(b.parts).forEach(function (id) { st[id] = { dmgIn: 0, dmgOut: 0, heal: 0, kills: [] }; });
    b.entries.forEach(function (e) {
      if (e.k === 'dmg') {
        if (st[e.tid]) st[e.tid].dmgIn += e.amt;
        if (e.sid && st[e.sid]) st[e.sid].dmgOut += e.amt;
      } else if (e.k === 'heal') { if (st[e.tid]) st[e.tid].heal += e.amt; }
      else if (e.k === 'kill' && e.sid && st[e.sid]) st[e.sid].kills.push(e.tn + (e.how === 'unconscious' ? ' (без сознания)' : ''));
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
    ids.sort(function (x, y) { return (tn(x) - tn(y)) || String(b.parts[x].name).localeCompare(b.parts[y].name, 'ru'); });
    var byTeam = {};
    ids.forEach(function (i) { (byTeam[tn(i)] = byTeam[tn(i)] || []).push(i); });
    var teamLine = Object.keys(byTeam).map(function (k) { return 'команда ' + k + ': ' + byTeam[k].length; }).join(', ');
    var L = [];
    L.push('---');
    L.push('тип: бой');
    L.push('карта: ' + b.map);
    L.push('номер: ' + num);
    L.push('дата: ' + two(new Date(b.started)));
    L.push('раундов: ' + maxR);
    L.push('длительность_мин: ' + mins);
    L.push('завершён: ' + (b.ended ? 'да' : 'нет (сохранён во время боя)'));
    L.push('---');
    L.push('');
    L.push('# Бой: ' + b.map + ' ' + num + ' (' + two(new Date(b.started)).replace(/-(\d\d)$/, ':$1') + ')');
    L.push('');
    L.push('**Раундов:** ' + maxR + ' · **Длительность:** ~' + mins + ' мин · **Участников:** ' + ids.length + ' (' + teamLine + ')');
    L.push('');
    L.push('## Участники');
    L.push('');
    L.push('| Участник | Команда | КД | Макс. HP | Получил урона | Нанёс урона | Исцелён | Убил | Исход |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    ids.forEach(function (id) {
      var p = b.parts[id], s = st[id];
      L.push('| ' + esc(p.name) + ' | ' + (p.team || 2) + ' | ' + (p.ac || '—') + ' | ' + (p.maxHp || '—') + ' | ' +
        s.dmgIn + ' | ' + s.dmgOut + ' | ' + s.heal + ' | ' + s.kills.length + ' | ' + (p.removed && p.status === 'ok' ? 'убран со сцены' : (STATUS[p.status] || p.status)) + ' |');
    });
    L.push('');
    L.push('## Кто кого убил');
    L.push('');
    var kills = b.entries.filter(function (e) { return e.k === 'kill'; });
    if (!kills.length) L.push('Никто не погиб и не потерял сознание.');
    kills.forEach(function (e) {
      var kt = e.sid && b.parts[e.sid] ? b.parts[e.sid].team : null, vt = b.parts[e.tid] ? b.parts[e.tid].team : null;
      L.push('- Раунд ' + e.r + ': ' + (e.sn ? '**' + e.sn + '**' + (kt ? ' (К' + kt + ')' : '') : '_источник не указан_') + ' → **' + e.tn + '**' + (vt ? ' (К' + vt + ')' : '') + ' — ' + (e.how === 'unconscious' ? 'без сознания' : 'убит') + (kt && vt && kt === vt ? ' ⚠ своя команда' : ''));
    });
    L.push('');
    L.push('## Урон по участникам');
    L.push('');
    var any = false;
    ids.forEach(function (id) {
      var s = st[id];
      if (!s.dmgIn) return;
      any = true;
      var bySrc = {};
      b.entries.forEach(function (e) { if (e.k === 'dmg' && e.tid === id) { var k = e.sn || 'источник не указан'; bySrc[k] = (bySrc[k] || 0) + e.amt; } });
      L.push('- **' + b.parts[id].name + '** (К' + (b.parts[id].team || 2) + ') — получил ' + s.dmgIn + (b.parts[id].maxHp ? ' из ' + b.parts[id].maxHp + ' HP' : '') + ': ' +
        Object.keys(bySrc).map(function (k) { return k + ' ' + bySrc[k]; }).join(', '));
    });
    if (!any) L.push('Урон не фиксировался.');
    L.push('');
    L.push('## Хронология');
    L.push('');
    b.entries.forEach(function (e) {
      var pre = '- [' + clock(e.t) + ' · Р' + e.r + '] ', tx = null;
      if (e.k === 'start') tx = 'Бой начался';
      else if (e.k === 'end') tx = 'Бой окончен';
      else if (e.k === 'round') tx = 'Начался раунд ' + e.n;
      else if (e.k === 'turn') tx = 'Ход: ' + e.tn;
      else if (e.k === 'dmg') tx = (e.sn || 'Источник не указан') + ' → ' + e.tn + ': урон ' + e.amt + (e.to != null ? ' (HP ' + e.from + ' → ' + e.to + ')' : '');
      else if (e.k === 'heal') tx = (e.sn ? e.sn + ' → ' : '') + e.tn + ': лечение ' + e.amt + ' (HP ' + e.from + ' → ' + e.to + ')';
      else if (e.k === 'kill') tx = '☠ ' + e.tn + ' — ' + (e.how === 'unconscious' ? 'без сознания' : 'убит') + (e.sn ? ' (' + e.sn + ')' : '');
      else if (e.k === 'team') tx = e.tn + ' переведён в команду ' + e.team;
      else if (e.k === 'status') tx = e.tn + ': статус «' + (STATUS[e.st] || e.st) + '»';
      else if (e.k === 'removed') tx = e.tn + ' убран со сцены';
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
      title: 'Папка журнала не задана',
      text: 'Куда сохранять записи боёв? Выберите папку (запомнится в настройках) или сохраните этот файл вручную.',
      ok: 'Выбрать папку', cancel: 'Сохранить как…'
    });
    if (!pickIt) return null;
    var dir = await window.host.dialog.pickFolder({ title: 'Папка журнала боя' });
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
    var p = await window.host.dialog.saveFile({ title: 'Сохранить бой', defaultName: fn2, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!p) return { saved: false };
    await window.host.fs.writeAbs(p, bom(buildNote(b, 1)));
    return { saved: true, name: p.split(/[\\/]/).pop(), where: 'выбранный файл' };
  }

  // сохранить текущий бой; true — записан
  async function save() {
    if (!hasData()) { toast('Журнал боя пуст — сохранять нечего'); return false; }
    var b = B;
    try {
      var r = await writeNote(b);
      if (!r.saved) return false;
      toast('Бой сохранён: ' + r.name + ' → ' + r.where, 6000);
      B = null; persist();
      return true;
    } catch (e) {
      console.warn('save battle', e);
      VTT.ui.alert({ title: 'Бой не сохранён', text: 'Не удалось записать заметку: ' + (e && e.message || e) + '. Журнал боя остался в памяти — попробуйте ещё раз.' });
      return false;
    }
  }
  // спросить «сохранить / не сохранять»; после ответа журнал очищается (кроме неудачной записи)
  async function promptSave(text) {
    if (!hasData()) { B = null; persist(); return; }
    var yes = await VTT.ui.confirm({ title: 'Сохранить бой?', text: text || 'Есть несохранённый бой.', ok: 'Сохранить', cancel: 'Не сохранять' });
    if (yes) { await save(); }
    else { B = null; persist(); }
  }

  // ------------------------------------------------------------------ интерфейс
  function paintBtn() {
    var b = document.getElementById('cbSave'); if (!b) return;
    b.hidden = off();
    var n = B ? B.entries.length : 0;
    b.textContent = '💾 Сохранить бой' + (n ? ' (' + n + ')' : '');
    b.classList.toggle('primary', !!n);
  }
  function setCampaign(c) {
    camp = c || null;
    if (off()) B = null;
    paintBtn();
  }
  function init() {
    var b = document.getElementById('cbSave');
    if (b) b.onclick = function () { save(); };
    var campP = window.host.campaigns.current().then(setCampaign).catch(function () {});
    window.host.campaigns.onChanged(setCampaign);
    // незакрытый бой с прошлого запуска
    campP.then(function () {
      if (off()) return;
      return Promise.resolve(VTT.store.getKV(KV)).then(function (old) {
        if (!old || !old.entries || !old.entries.length) return;
        B = old; paintBtn();
        return promptSave('С прошлого запуска остался несохранённый бой («' + old.map + '», записей: ' + old.entries.length + '). Сохранить его в заметку?');
      });
    }).catch(function () { /* ignore */ });
    paintBtn();
  }

  VTT.blog = {
    mute: function (v) { muted = !!v; }, init: init, save: save, promptSave: promptSave, hasData: hasData,
    onStart: onStart, onEnd: onEnd, onTurn: onTurn, onRound: onRound, onHp: onHp, onStatus: onStatus, onRemoved: onRemoved, onTeam: onTeam, teamOf: teamOf
  };
})();
