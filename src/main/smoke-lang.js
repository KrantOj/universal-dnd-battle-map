'use strict';
// Smoke языка (`electron . --smoke-only=lang`): на русском строим сцену (токены, бой, окно игроков), переключаем интерфейс на English
// без перезапуска, снимаем GM (панель, бой, музыка), «Настройки», редактор и мастер первого запуска, проверяем меню/окно игроков/
// переполнение строк и возвращаем русский. Скриншоты — <tmp>/shots/NN-<шаг>-<окно>.png.
const must = (c, m) => { if (!c) throw new Error(m); };

// ищем элементы, чей текст не помещается (обрезан) — только предупреждения для разбора по скриншотам
const OVERFLOW_JS = `(function(){
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('button,label,h2,h3,span,div,option,select,input'), function (e) {
    if (e.offsetParent === null && e.tagName !== 'BODY') return;
    var cs = getComputedStyle(e);
    if (e.children.length > 0 && e.tagName !== 'BUTTON') return;
    if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && (cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis' || e.tagName === 'BUTTON')) {
      out.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + ' «' + (e.textContent || e.value || '').trim().slice(0, 40) + '» ' + e.scrollWidth + '>' + e.clientWidth);
    }
  });
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('PAGE horizontal scroll ' + document.documentElement.scrollWidth + '>' + window.innerWidth);
  return out.slice(0, 40);
})()`;

module.exports = async function langSmoke(k) {
  const { windows, ex, waitFor, step, sleep, report } = k;
  const { Menu } = require('electron');
  const gmLang = () => ex('document.documentElement.lang');
  const edWc = () => windows.getEditorWindow().webContents;
  const exe = (js) => edWc().executeJavaScript(js, true);
  const waitEd = async (js, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 10000)) { try { if (await exe(js)) return true; } catch (_) { /* грузится */ } await sleep(150); }
    throw new Error('timeout (editor) waiting for: ' + js);
  };
  const overflow = async (name, run) => {
    try { const l = await run(); if (l && l.length) (report.warnings = report.warnings || []).push({ overflow: name, items: l }); } catch (_) { /* окно мог закрыться */ }
  };
  // после смены языка посреди боя вопроса «сохранить оставшийся бой?» быть не должно: бой тихо восстанавливается
  const dismissPrompt = async () => {
    await sleep(1200);
    must(!(await ex("!!document.querySelector('.vtt-ui-dialog')")), 'после смены языка показан диалог «оставшийся бой»');
    must(await ex('VTT.blog.hasData()'), 'бой не восстановился после смены языка');
  };
  const gmReady = '!!(window.VTT && VTT.gm && VTT.gm._state.map && VTT.gm._state.scene)';

  await step('ru-setup', async () => {
    await waitFor("!!(window.VTT && VTT.gm && document.querySelectorAll('#mapList button').length)", 15000);
    must((await gmLang()) === 'ru', 'ожидали ru по умолчанию smoke');
    await ex("document.querySelector('#mapList button').click()");
    await waitFor(gmReady, 10000);
    await ex("(function(){var a=VTT.gm._api;" +
      "a.startPlacement({name:'Hero',label:'H',color:'#3b82f6',size:1,kind:'pc',maxHp:30,ac:16,speed:30});a.placeToken(3,3);" +
      "a.startPlacement({name:'Goblin Warlord of the Northern Hills',label:'G',color:'#da3633',size:1,kind:'enemy',maxHp:40,ac:15,speed:30});a.placeToken(5,3);" +
      "a.startPlacement({name:'Dragon',label:'D',color:'#a371f7',size:4,kind:'enemy',maxHp:200,ac:19,speed:40});a.placeToken(8,6);})()");
    await ex("document.getElementById('cbRoll').click()");
    await ex("document.getElementById('cbStart').click()");
    await ex('window.host.windows.openPlayer()');
    await waitFor('!!(VTT.sync && VTT.sync.isOpen())', 8000);
    await waitFor("!!document.querySelector('canvas')", 8000, 'player');
    await ex('VTT.gm.flush()');
  }, 1200);

  await step('switch-to-en', async () => {
    await ex("VTT.cfg.setLanguage('en')");
    await waitFor("document.documentElement.lang === 'en' && " + gmReady, 20000);
    await waitFor("document.documentElement.lang === 'en' && !!document.querySelector('canvas')", 20000, 'player');
    await dismissPrompt();
    must((await ex('VTT.gm._state.scene.tokens.length')) === 3, 'токены пропали после смены языка');
    must((await ex("document.querySelector('[data-i18n=\"toolbar.player\"]').textContent")) === '🖥 Player window', 'тулбар не на английском');
    const file = Menu.getApplicationMenu().items[0].label;
    must(file === 'File', 'меню не пересобралось: ' + file);
    must(windows.getPlayerWindow().getTitle().indexOf('players') >= 0, 'заголовок окна игроков: ' + windows.getPlayerWindow().getTitle());
  }, 1500);
  await overflow('gm-en', () => ex(OVERFLOW_JS));

  await step('en-settings', async () => {
    await ex('VTT.settings.open()');
    await waitFor("!document.getElementById('settingsDlg').hidden", 4000);
  }, 700);
  await overflow('settings-en', () => ex(OVERFLOW_JS));
  await step('en-settings-closed', async () => { await ex('VTT.settings.close()'); });

  await step('en-dice', async () => {
    await ex("document.getElementById('diceExpr').value='2d20kh1+5';document.getElementById('diceGo').click()");
    await sleep(400);
  }, 600);

  await step('en-showcase', async () => {
    await ex("document.getElementById('btnShow').click()");
    await sleep(900);
  }, 600);
  await overflow('showcase-en', () => ex(OVERFLOW_JS));
  await ex("document.getElementById('sdClose') && document.getElementById('sdClose').click()");

  await step('en-editor', async () => {
    windows.openEditor({ mapRel: 'demo.map.json' });
    await waitEd('!!(window.VTT && VTT.editor && VTT.editor._state.model)', 15000);
    must((await exe('document.documentElement.lang')) === 'en', 'редактор не на английском');
  }, 1200);
  await overflow('editor-en', () => exe(OVERFLOW_JS));

  await step('en-wizard', async () => {
    windows.getEditorWindow().destroy();
    await windows.showWizard();
    await waitFor("!!document.getElementById('wzNext') && document.documentElement.lang === 'en'", 10000);
    await waitFor("document.getElementById('wzTitle').textContent === 'Language'", 3000);
  }, 700);
  await step('en-wizard-folders', async () => { for (let i = 0; i < 3; i++) await ex("document.getElementById('wzNext').click()"); }, 600);
  await overflow('wizard-en', () => ex(OVERFLOW_JS));
  await step('en-wizard-log', async () => { await ex("document.getElementById('wzNext').click()"); await ex("document.getElementById('wzNext').click()"); }, 600);
  await step('en-wizard-last', async () => { for (let i = 0; i < 3; i++) await ex("document.getElementById('wzNext').click()"); }, 600);
  await overflow('wizard-last-en', () => ex(OVERFLOW_JS));

  await step('back-to-gm-ru', async () => {
    await ex("document.getElementById('wzCancel').click()");
    await waitFor(gmReady, 15000);
    await ex("VTT.cfg.setLanguage('ru')");
    await waitFor("document.documentElement.lang === 'ru' && " + gmReady, 20000);
    await dismissPrompt();
    must(Menu.getApplicationMenu().items[0].label === 'Файл', 'меню не вернулось на русский');
    must((await ex('VTT.gm._state.scene.tokens.length')) === 3, 'токены пропали после возврата языка');
  }, 1200);
};
