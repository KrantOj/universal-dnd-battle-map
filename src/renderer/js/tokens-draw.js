/* VTT.tokensDraw — рисование токена со статусами и кэш картинок */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});

  var KIND_COLOR = { pc: '#3fb950', ally: '#58a6ff', enemy: '#f85149', neutral: '#d29922' };
  var cache = {}; // id -> {key, img, ready}

  function imgKey(t) {
    var s = t.image;
    if (!s) return '';
    return s.length + ':' + s.slice(-24);
  }

  function getImage(t) {
    if (!t.image) return null;
    var key = imgKey(t);
    var c = cache[t.id];
    if (!c || c.key !== key) {
      var im = new Image();
      c = cache[t.id] = { key: key, img: im, ready: false };
      im.onload = function () {
        c.ready = true;
        if (td.onload) td.onload();
      };
      im.src = t.image;
    }
    return c.ready ? c.img : null;
  }

  function badge(ctx, x, y, r, bg, text, font) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = font || ('bold ' + Math.round(r * 1.25) + 'px system-ui, "Segoe UI Emoji", sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + r * 0.06);
    ctx.restore();
  }

  function drawToken(ctx, t, px, sx, sy, opts) {
    opts = opts || {};
    var size = t.size || 1;
    var w = size * px;
    var cx = sx + w / 2, cy = sy + w / 2;
    var r = w * 0.9 / 2;
    var status = t.status || 'ok';
    var kindColor = KIND_COLOR[t.kind] || KIND_COLOR.neutral;
    var lw = 3;
    var now = performance.now();

    ctx.save();
    var alpha = 1;
    if (t.hidden && opts.gm) alpha = 0.45;
    if (opts.dragging) alpha *= 0.4;
    ctx.globalAlpha = alpha;

    var filter = 'none';
    if (status === 'unconscious') filter = 'grayscale(1)';
    else if (status === 'incapacitated') filter = 'grayscale(0.6)';
    else if (status === 'dead') filter = 'grayscale(1) brightness(0.45)';

    // тело (круглое при любом статусе)
    ctx.save();
    ctx.translate(cx, cy);
    if (filter !== 'none') ctx.filter = filter;

    if (opts.selected) {
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = Math.max(8, px * 0.25);
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = t.color || '#555';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    var img = getImage(t);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
      ctx.restore();
    } else if (t.label) {
      ctx.font = 'bold ' + Math.round(r * (t.label.length > 2 ? 0.8 : 1.05)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, r * 0.18);
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(t.label, 0, r * 0.05);
      ctx.fillStyle = '#fff';
      ctx.fillText(t.label, 0, r * 0.05);
    }

    // обводка
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = status === 'dead' ? '#6e4040' : kindColor;
    ctx.stroke();

    if (status === 'unconscious') {
      ctx.beginPath();
      ctx.arc(0, 0, r + lw + 1, 0, Math.PI * 2);
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#58a6ff';
      ctx.stroke();
    } else if (status === 'incapacitated') {
      var pulse = 0.5 + 0.5 * Math.sin(now / 260);
      ctx.beginPath();
      ctx.arc(0, 0, r + lw + 2 + pulse * px * 0.06, 0, Math.PI * 2);
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -now / 60;
      ctx.lineWidth = 2.5 + pulse * 1.5;
      ctx.strokeStyle = 'rgba(255,152,0,' + (0.55 + pulse * 0.45).toFixed(2) + ')';
      ctx.stroke();
    } else if (status === 'dead') {
      ctx.filter = 'none';
      ctx.setLineDash([]);
      var k = r * 0.72;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(4, r * 0.16);
      ctx.strokeStyle = '#d6322b';
      ctx.beginPath();
      ctx.moveTo(-k, -k); ctx.lineTo(k, k);
      ctx.moveTo(k, -k); ctx.lineTo(-k, k);
      ctx.stroke();
    }
    ctx.restore(); // тело

    // кольцо текущего хода
    if (opts.turn && status !== 'dead') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + lw + 3, 0, Math.PI * 2);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#f2cc60';
      ctx.shadowColor = '#f2cc60';
      ctx.shadowBlur = Math.max(6, px * 0.2);
      ctx.stroke();
      ctx.restore();
    }

    // полоска здоровья (у мастера — у всех с max HP; у игроков приходит только для pc/ally)
    if (t.maxHp > 0 && t.hp != null && status !== 'dead') {
      var frac = Math.max(0, Math.min(1, t.hp / t.maxHp));
      var bw = r * 1.5, bh = Math.max(3, Math.min(7, px * 0.08));
      var bx0 = cx - bw / 2, by0 = cy + r * 0.62;
      ctx.fillStyle = 'rgba(0,0,0,.75)';
      ctx.fillRect(bx0 - 1, by0 - 1, bw + 2, bh + 2);
      ctx.fillStyle = frac > 0.5 ? '#3fb950' : frac > 0.25 ? '#d29922' : '#f85149';
      ctx.fillRect(bx0, by0, bw * frac, bh);
    }

    // значки (без деформации)
    var br = Math.max(7, Math.min(w * 0.17, 16));
    var bx = sx + w - br * 0.9, by = sy + br * 0.9;
    if (status === 'unconscious') badge(ctx, bx, by, br, '#1f3b6e', '💤', Math.round(br * 1.2) + 'px "Segoe UI Emoji", system-ui, sans-serif');
    else if (status === 'incapacitated') badge(ctx, bx, by, br, '#e07b00', '!');
    else if (status === 'dead') badge(ctx, bx, by, br, '#3a1414', '💀', Math.round(br * 1.2) + 'px "Segoe UI Emoji", system-ui, sans-serif');

    if (t.hidden && opts.gm) {
      var hx = sx + br * 0.9, hy = sy + br * 0.9;
      badge(ctx, hx, hy, br, '#30363d', '👁', Math.round(br * 1.1) + 'px "Segoe UI Emoji", system-ui, sans-serif');
      ctx.strokeStyle = '#f85149';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - br * 0.7, hy + br * 0.7);
      ctx.lineTo(hx + br * 0.7, hy - br * 0.7);
      ctx.stroke();
    }

    // имя (только мастер)
    if (opts.gm && t.name && px >= 18) {
      ctx.globalAlpha = Math.max(alpha, 0.6);
      ctx.font = '600 ' + Math.max(10, Math.min(13, px * 0.2)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      var ny = sy + w - 2;
      ctx.strokeText(t.name, cx, ny);
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(t.name, cx, ny);
    }
    ctx.restore();
  }

  var td = {
    drawToken: drawToken,
    imgKey: imgKey,
    KIND_COLOR: KIND_COLOR,
    onload: null,
    forget: function (id) { delete cache[id]; }
  };
  VTT.tokensDraw = td;
})();
