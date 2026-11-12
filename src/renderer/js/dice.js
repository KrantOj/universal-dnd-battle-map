/* VTT.dice — ЧИСТЫЙ модуль: разбор и бросок формул кубиков (без DOM).
 *
 * Формат: слагаемые через + и −:  2d6+3   d20+5   4d6dl1   2d20kh1+4   d100   1d8+1d4+2
 *   NdM       N кубиков с M гранями (N по умолчанию 1)
 *   khK / klK оставить K старших / младших;  dhK / dlK отбросить K старших / младших
 *   «д» (русская) = d.  Суффикс  adv / dis  (или «преим» / «помеха») к первому d20 даёт 2d20kh1 / 2d20kl1.
 * roll(expr, rng) → { expr, total, text, parts:[{sign,label,rolls,kept:[bool],sum}], d20: null|number }
 *   rng — функция () → [0,1); по умолчанию crypto.getRandomValues / Math.random.
 */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var MAX_COUNT = 100, MAX_SIDES = 1000;

  function defaultRng() {
    try {
      if (window.crypto && crypto.getRandomValues) {
        var a = new Uint32Array(1);
        crypto.getRandomValues(a);
        return a[0] / 4294967296;
      }
    } catch (e) { /* падаем на Math.random */ }
    return Math.random();
  }

  function norm(expr) {
    var s = String(expr == null ? '' : expr).toLowerCase().replace(/ё/g, 'е');
    s = s.replace(/[−–—]/g, '-').replace(/д/g, 'd').replace(/к/g, 'k');
    var mode = null;
    s = s.replace(/\s*(adv|преим\w*)\s*$/, function () { mode = 'kh'; return ''; })
         .replace(/\s*(dis|помех\w*)\s*$/, function () { mode = 'kl'; return ''; });
    s = s.replace(/\s+/g, '');
    return { s: s, adv: mode };
  }

  function parse(expr) {
    var n = norm(expr), s = n.s;
    if (!s) throw new Error('Пустая формула');
    var terms = [], re = /([+-]?)(?:(\d*)d(\d+)(?:(kh|kl|dh|dl)(\d*))?|(\d+))/y, pos = 0, m, first = true, advDone = false;
    while (pos < s.length) {
      re.lastIndex = pos;
      m = re.exec(s);
      if (!m || m.index !== pos || (!first && !m[1])) throw new Error('Не понял формулу рядом с «' + s.slice(pos, pos + 6) + '»');
      first = false;
      pos = re.lastIndex;
      var sign = m[1] === '-' ? -1 : 1;
      if (m[6] !== undefined) { terms.push({ sign: sign, kind: 'num', value: parseInt(m[6], 10) }); continue; }
      var cnt = m[2] === '' ? 1 : parseInt(m[2], 10), sides = parseInt(m[3], 10), keep = null;
      if (m[4]) keep = { op: m[4], k: m[5] === '' ? 1 : parseInt(m[5], 10) };
      if (n.adv && !advDone && sides === 20 && cnt === 1 && !keep) {
        cnt = 2; keep = { op: n.adv, k: 1 }; advDone = true;
      }
      if (cnt < 1 || cnt > MAX_COUNT) throw new Error('Кубиков за раз: от 1 до ' + MAX_COUNT);
      if (sides < 2 || sides > MAX_SIDES) throw new Error('Граней: от 2 до ' + MAX_SIDES);
      if (keep && (keep.k < 0 || keep.k > cnt)) throw new Error('Нельзя оставить/отбросить ' + keep.k + ' из ' + cnt);
      terms.push({ sign: sign, kind: 'dice', n: cnt, s: sides, keep: keep });
    }
    if (n.adv && !advDone) throw new Error('adv/dis работает с одиночным d20');
    return { terms: terms };
  }

  function label(t) {
    if (t.kind === 'num') return String(t.value);
    return t.n + 'd' + t.s + (t.keep ? t.keep.op + t.keep.k : '');
  }

  function roll(expr, rng) {
    rng = rng || defaultRng;
    var p = parse(expr), total = 0, parts = [], d20 = null;
    p.terms.forEach(function (t) {
      if (t.kind === 'num') {
        parts.push({ sign: t.sign, label: label(t), rolls: [t.value], kept: [true], sum: t.value });
        total += t.sign * t.value;
        return;
      }
      var rolls = [], i;
      for (i = 0; i < t.n; i++) rolls.push(1 + Math.floor(rng() * t.s));
      var kept = rolls.map(function () { return true; });
      if (t.keep) {
        // порядок индексов по значению (стабильно)
        var idx = rolls.map(function (v, j) { return j; }).sort(function (a, b) { return rolls[a] - rolls[b] || a - b; });
        var drop = [];
        if (t.keep.op === 'kh') drop = idx.slice(0, t.n - t.keep.k);
        else if (t.keep.op === 'kl') drop = idx.slice(t.keep.k);
        else if (t.keep.op === 'dh') drop = idx.slice(t.n - t.keep.k);
        else drop = idx.slice(0, t.keep.k);
        drop.forEach(function (j) { kept[j] = false; });
      }
      var sum = 0;
      rolls.forEach(function (v, j) { if (kept[j]) sum += v; });
      parts.push({ sign: t.sign, label: label(t), rolls: rolls, kept: kept, sum: sum });
      total += t.sign * sum;
      if (t.s === 20 && d20 === null) {
        var kv = rolls.filter(function (v, j) { return kept[j]; });
        if (kv.length === 1) d20 = kv[0];
      }
    });
    var text = parts.map(function (pt, k) {
      var body;
      if (pt.label.indexOf('d') < 0 && pt.rolls.length === 1 && /^\d+$/.test(pt.label)) body = String(pt.sum);
      else body = '[' + pt.rolls.map(function (v, j) { return pt.kept[j] ? String(v) : '(' + v + ')'; }).join(', ') + ']';
      return (k === 0 ? (pt.sign < 0 ? '−' : '') : (pt.sign < 0 ? ' − ' : ' + ')) + body;
    }).join('');
    // «главный» кубик для анимации: самый крупный из брошенных (константы не в счёт)
    var sides = 0;
    p.terms.forEach(function (t) { if (t.kind === 'dice' && t.s > sides) sides = t.s; });
    return { expr: String(expr).trim(), total: total, text: text + ' = ' + total, parts: parts, d20: d20, sides: sides || 20 };
  }

  // ---- контурные значки кубиков (одна форма на количество граней; для кнопок и анимации) ----
  var SHAPES = {
    4:   { pts: '12,3 22,20 2,20', y: 16 },
    6:   { rect: true, y: 15 },
    8:   { pts: '12,2 21.5,12 12,22 2.5,12', mid: 'M2.5 12h19', y: 14.5 },
    10:  { pts: '12,2 21.5,9.5 12,22 2.5,9.5', y: 14 },
    12:  { pts: '12,2 22,9.3 18.2,21 5.8,21 2,9.3', y: 15 },
    20:  { pts: '12,2 21,7 21,17 12,22 3,17 3,7', inner: '12,7 16.8,15.5 7.2,15.5', y: 0 },
    100: { circle: true, y: 15 }
  };
  // svg(sides, {size, label}) -> строка <svg>; label: подпись внутри (по умолч. число граней, кроме d20; '' — без подписи)
  function svg(sides, o) {
    o = o || {};
    var key = SHAPES[sides] ? sides : (sides <= 4 ? 4 : sides <= 6 ? 6 : sides <= 8 ? 8 : sides <= 10 ? 10 : sides <= 12 ? 12 : sides <= 20 ? 20 : 100);
    var d = SHAPES[key], body;
    if (d.rect) body = '<rect x="4" y="4" width="16" height="16" rx="3"/>';
    else if (d.circle) body = '<circle cx="12" cy="12" r="9.5"/>';
    else body = '<polygon points="' + d.pts + '"/>' + (d.mid ? '<path d="' + d.mid + '"/>' : '') + (d.inner ? '<polygon points="' + d.inner + '"/>' : '');
    var lbl = o.label !== undefined ? o.label : (key === 20 ? '' : key === 100 ? '%' : String(key));
    var txt = lbl ? '<text x="12" y="' + d.y + '" text-anchor="middle" class="dn">' + lbl + '</text>' : '';
    var sz = o.size ? ' width="' + o.size + '" height="' + o.size + '"' : '';
    return '<svg viewBox="0 0 24 24"' + sz + ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' + body + txt + '</svg>';
  }

  VTT.dice = { parse: parse, roll: roll, svg: svg, MAX_COUNT: MAX_COUNT, MAX_SIDES: MAX_SIDES };
})();
