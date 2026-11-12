/*
 * VTT.ui - модальные диалоги confirm / alert / prompt (промисы).
 * Без модулей и зависимостей. Требует подключённый css/ui.css.
 */
(function () {
  var VTT = window.VTT = window.VTT || {};
  var tr = VTT.i18n.t;

  var queue = [];      // ожидающие запросы
  var busy = false;    // открыт ли сейчас диалог
  var idCounter = 0;

  function normalize(opts, defaults) {
    if (typeof opts === 'string') opts = { text: opts };
    opts = opts || {};
    var o = {}, k;
    for (k in defaults) if (Object.prototype.hasOwnProperty.call(defaults, k)) o[k] = defaults[k];
    for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k) && opts[k] !== undefined) o[k] = opts[k];
    return o;
  }

  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function enqueue(kind, opts, resolve) {
    queue.push({ kind: kind, opts: opts, resolve: resolve });
    next();
  }

  function next() {
    if (busy || !queue.length) return;
    busy = true;
    open(queue.shift());
  }

  function open(req) {
    var kind = req.kind;
    var o = req.opts;
    var prevFocus = document.activeElement;
    var settled = false;

    var overlay = make('div', 'vtt-ui-backdrop');
    var dialog = make('div', 'vtt-ui-dialog');
    dialog.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    if (o.title) {
      var titleEl = make('div', 'vtt-ui-title', o.title);
      titleEl.id = 'vtt-ui-title-' + (++idCounter);
      dialog.setAttribute('aria-labelledby', titleEl.id);
      dialog.appendChild(titleEl);
    }
    if (o.text !== undefined && o.text !== null && o.text !== '') {
      dialog.appendChild(make('div', 'vtt-ui-text', o.text));
    }

    var input = null;
    if (kind === 'prompt') {
      input = make('input', 'vtt-ui-input');
      input.type = 'text';
      input.value = (o.value === undefined || o.value === null) ? '' : String(o.value);
      dialog.appendChild(input);
    }

    var actions = make('div', 'vtt-ui-actions');
    var cancelBtn = null;
    if (kind !== 'alert') {
      cancelBtn = make('button', 'vtt-ui-btn vtt-ui-btn-cancel', o.cancel);
      cancelBtn.type = 'button';
      actions.appendChild(cancelBtn);
    }
    var okBtn = make('button', 'vtt-ui-btn vtt-ui-btn-ok' + (o.danger ? ' vtt-ui-danger' : ''), o.ok);
    okBtn.type = 'button';
    actions.appendChild(okBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    function finish(result) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (prevFocus && typeof prevFocus.focus === 'function' && document.body.contains(prevFocus)) {
        try { prevFocus.focus(); } catch (e) { /* ignore */ }
      }
      busy = false;
      req.resolve(result);
      next();
    }

    // значения результата по типу диалога
    function onOk() {
      if (kind === 'confirm') finish(true);
      else if (kind === 'prompt') finish(input.value);
      else finish(undefined);
    }
    function onCancel() {
      if (kind === 'confirm') finish(false);
      else if (kind === 'prompt') finish(null);
      else finish(undefined); // alert: закрытие = ok
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        // Enter на кнопке «Отмена» оставляем нативному поведению (клик по ней)
        if (cancelBtn && document.activeElement === cancelBtn) return;
        e.preventDefault();
        e.stopPropagation();
        onOk();
      } else if (e.key === 'Tab') {
        // удерживаем фокус внутри диалога
        var focusables = [];
        if (input) focusables.push(input);
        if (cancelBtn) focusables.push(cancelBtn);
        focusables.push(okBtn);
        var idx = focusables.indexOf(document.activeElement);
        var target;
        if (e.shiftKey) {
          target = (idx <= 0) ? focusables[focusables.length - 1] : focusables[idx - 1];
        } else {
          target = (idx === -1 || idx === focusables.length - 1) ? focusables[0] : focusables[idx + 1];
        }
        e.preventDefault();
        target.focus();
      }
    }

    okBtn.addEventListener('click', onOk);
    if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) onCancel();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    if (input) {
      input.focus();
      input.select();
    } else {
      okBtn.focus();
    }
  }

  VTT.ui = {
    confirm: function (opts) {
      return new Promise(function (resolve) {
        enqueue('confirm', normalize(opts, {
          title: '', text: '', ok: tr('common.ok'), cancel: tr('common.cancel'), danger: false
        }), resolve);
      });
    },
    alert: function (opts) {
      return new Promise(function (resolve) {
        enqueue('alert', normalize(opts, {
          title: '', text: '', ok: tr('common.ok')
        }), resolve);
      });
    },
    prompt: function (opts) {
      return new Promise(function (resolve) {
        enqueue('prompt', normalize(opts, {
          title: '', text: '', value: '', ok: tr('common.ok'), cancel: tr('common.cancel')
        }), resolve);
      });
    }
  };
})();
