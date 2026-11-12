/* VTT.reportUi — «Сообщить о проблеме» (Справка): описание -> zip-отчёт (логи + описание + версии) / страница Issues */
(function () {
  'use strict';
  var VTT = (window.VTT = window.VTT || {});
  var tr = VTT.i18n.t;
  var el = function (tag, cls, text) { return VTT.cfg.el(tag, cls, text); };
  var open = false;

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function show() {
    if (open) return;
    open = true;
    var m = VTT.campaignsUi._modal(tr('report.title'), { onClose: function () { open = false; } });
    m.body.appendChild(el('div', 'cfg-note', tr('report.lead')));
    var lbl = el('div', 'cfg-lbl', tr('report.what'));
    var ta = el('textarea', 'cu-text'); ta.id = 'reportText'; ta.rows = 6; ta.maxLength = 5000; ta.placeholder = tr('report.placeholder');
    m.body.appendChild(lbl); m.body.appendChild(ta);
    m.body.appendChild(el('div', 'cfg-note', tr('report.privacy')));
    var msg = el('div', 'cfg-note cu-msg'); m.body.appendChild(msg);

    var issues = el('button', null, tr('report.issues')); issues.type = 'button';
    issues.onclick = function () { window.host.report.openIssues().catch(function (e) { msg.classList.add('err'); msg.textContent = String(e && e.message || e); }); };
    var spacer = el('span', 'wz-spacer');
    var close = el('button', null, tr('common.close')); close.type = 'button'; close.onclick = function () { m.close(); };
    var go = el('button', 'primary', tr('report.collect')); go.type = 'button'; go.id = 'reportCollect';
    go.onclick = async function () {
      var dest = await window.host.dialog.saveFile({ title: tr('report.saveTitle'), defaultName: 'udbm-report-' + stamp() + '.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] });
      if (!dest) return;
      go.disabled = true; msg.classList.remove('err'); msg.textContent = tr('report.working');
      try {
        var p = await window.host.report.collect(dest, ta.value);
        msg.textContent = tr('report.done', { path: p });
      } catch (e) { msg.classList.add('err'); msg.textContent = tr('report.err', { msg: e && e.message || e }); }
      go.disabled = false;
    };
    [issues, spacer, close, go].forEach(function (x) { m.actions.appendChild(x); });
    ta.focus();
  }

  VTT.reportUi = { open: show };
})();
