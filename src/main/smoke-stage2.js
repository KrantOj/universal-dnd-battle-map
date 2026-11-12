'use strict';
// Smoke этапа 2: кампании (две, переключение), экспорт -> импорт, слежение за папками, ошибки в лог, отчёт.
// Вызывается из smoke.run после основного сценария; k = {campaigns, tmp, ex, waitFor, step, sleep}.
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function stage2(k) {
  const { campaigns, tmp, ex, waitFor, step, sleep } = k;
  const transfer = require('./transfer');
  const archive = require('./archive');
  const reportMod = require('./report');
  const logger = require('./log');
  const { unzipSync, strFromU8 } = require('fflate');
  const must = (cond, msg) => { if (!cond) throw new Error(msg); };
  const first = campaigns.current();
  const campName = (n) => `!!(VTT.gm._state.camp && VTT.gm._state.camp.name === ${JSON.stringify(n)})`;
  const closeOverlays = "(function(){var o=document.querySelectorAll('.cu-overlay'); for (var i=0;i<o.length;i++) o[i].remove();})()";

  // --- вторая кампания: независимость данных, переключение туда и обратно
  await step('2-flush-before-switch', async () => { await ex('VTT.gm.flush()'); });
  const data2 = path.join(tmp, 'data2'), maps2 = path.join(tmp, 'maps2');
  fs.mkdirSync(maps2, { recursive: true });
  await step('2-create-second-campaign', async () => {
    campaigns.create({ name: 'Second', folders: { data: data2, maps: maps2 }, playerWindow: { auto: false } });
    await waitFor(campName('Second'), 8000);
    await waitFor('!VTT.gm._state.map && !VTT.gm._state.scene', 3000);
    await waitFor("document.getElementById('mapList').textContent.length > 0 && document.querySelectorAll('#mapList button').length === 0", 5000);
    const sc = await ex('window.host.scenes.list()');
    must(sc.length === 0, 'у второй кампании не должно быть сцен первой: ' + JSON.stringify(sc));
    must((await ex('VTT.gm._state.lib.length')) === 0, 'библиотека второй кампании должна быть пустой');
  }, 800);
  await step('2-chooser-dialog', async () => {
    await ex("(function(){ window.__chooser = window.host.campaigns.list().then(function(l){ return window.host.campaigns.current().then(function(c){ return VTT.campaignsUi.chooser(l, c.id); }); }); })()");
    await waitFor("!!document.querySelector('.cu-card .cu-item')", 4000);
  }, 700);
  await step('2-chooser-pick-first', async () => {
    await ex("document.querySelector('.cu-card .cu-item').click()");   // первая в списке = «Smoke»
    await ex("document.querySelector('.cu-card .primary').click()");
    const id = await ex('window.__chooser');
    must(id === first.id, 'chooser вернул не первую кампанию: ' + id);
  });
  await step('2-manager-dialog', async () => {
    await ex('VTT.campaignsUi.openManager()');
    await waitFor("document.querySelectorAll('.cu-row').length === 2", 4000);
  }, 700);
  await step('2-switch-back', async () => {
    await ex('VTT.campaignsUi.switchTo(' + JSON.stringify(first.id) + ')');
    await sleep(300);
    await ex(closeOverlays);
    await waitFor(campName('Smoke'), 8000);
    await waitFor('!!(VTT.gm._state.map && VTT.gm._state.scene)', 10000);   // последняя карта открылась сама
    const n = await ex('VTT.gm._state.scene.tokens.length');
    must(n === 1, 'сцена первой кампании не сохранилась при переключении: токенов ' + n);
  }, 900);

  // --- экспорт -> импорт как новая
  await step('2-library-for-export', async () => {
    await ex("VTT.store.saveLibrary([{lid:'l-orc',name:'Orc',label:'O',color:'#da3633',kind:'enemy',size:1,speed:30,vision:60,updated:1}])");
    await ex('VTT.gm.flush()');
  });
  await step('2-export-dialog', async () => {
    await ex('VTT.campaignsUi.openExport()');
    await waitFor("document.querySelectorAll('.cu-card .cfg-chk input').length === 3", 4000);
    await ex("document.querySelectorAll('.cu-card .cfg-chk input')[0].click()");   // включить карты — размер пересчитается
    await waitFor("/файлов/.test(document.querySelector('.cu-size').textContent)", 4000);
    await waitFor("/не отвечать/.test(document.querySelector('.cu-warn').textContent) && /Примерное время: (меньше минуты|≈)/.test(document.querySelector('.cu-warn').textContent)", 4000);
    await waitFor("/Примерное время/.test(document.querySelector('.cu-size').textContent)", 4000);
  }, 700);
  const udbm = path.join(tmp, 'export', 'Smoke.udbm');
  await step('2-export-file', async () => {
    await ex(closeOverlays);
    const cur = require('./campaigns').current();
    fs.writeFileSync(path.join(cur.folders.data, 'foreign-note.md'), 'чужой файл в папке данных');
    const r = transfer.exportCurrent(udbm, { maps: true, media: true, battlelog: false });
    must(r.bytes > 0 && fs.existsSync(udbm), 'файл .udbm не создан');
    const zn = Object.keys(unzipSync(fs.readFileSync(udbm)));
    must(!zn.some((n) => /^maps\//.test(n) && !/\.map\.json$|\.png$|\.vtt\.json$/i.test(n)), 'в maps/ лишние файлы: ' + zn.join(','));
    must(!zn.some((n) => /foreign-note/.test(n)), 'чужой файл из папки данных попал в архив');
    fs.unlinkSync(path.join(cur.folders.data, 'foreign-note.md'));
    const m = archive.readManifest(udbm);
    must(m.format === 'udbm/1', 'формат manifest');
    must(!JSON.stringify(m).toLowerCase().includes(path.basename(tmp).toLowerCase()), 'в manifest остались абсолютные пути');
  });
  const imported = path.join(tmp, 'imported');
  await step('2-import-as-new', async () => {
    const c = transfer.importFile(udbm, { mode: 'new', dataDir: imported, name: 'Smoke (импорт)' });
    must(c.folders.data === imported, 'папка данных импортированной кампании');
    await waitFor(campName('Smoke (импорт)'), 8000);
    await waitFor('VTT.gm._state.lib.length === 1 && VTT.gm._state.entries.length > 0', 8000);
    const sc = await ex('window.host.scenes.list()');
    must(sc.length === 1, 'сцена не восстановлена: ' + JSON.stringify(sc));
    must(fs.existsSync(path.join(imported, 'library.tokens.json')), 'library.tokens.json не восстановлен');
    must(fs.readdirSync(path.join(imported, 'maps')).some((n) => /\.map\.json$/.test(n)), 'карты не восстановлены');
    must(fs.existsSync(path.join(imported, 'media', 'm1', 'Herb.png')), 'картинки «Показа» не восстановлены');
    must(!Object.keys(unzipSync(fs.readFileSync(udbm))).some((n) => /thumbs/.test(n)), 'thumbs не должны экспортироваться');
    await waitFor('!!(VTT.gm._state.map && VTT.gm._state.scene)', 10000);
    must((await ex('VTT.gm._state.scene.tokens.length')) === 1, 'токен сцены не восстановлен');
  }, 900);


  // --- настройки: смена папки данных через реальный диалог (подпапка -> перенос), как делает пользователь
  const smokeMod = require('./smoke');
  const crypto = require('crypto');
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  const clickBtn = (sel, txt) => `(function(){var b=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)})).filter(function(x){return ${JSON.stringify(txt)}===''||x.textContent.indexOf(${JSON.stringify(txt)})>=0;})[0]; if(!b) return false; b.click(); return true;})()`;
  const reloc = {};
  await step('2-relocate-prepare', async () => {
    const cur = campaigns.current();
    reloc.id = cur.id; reloc.old = cur.folders.data;
    reloc.target = path.join(tmp, 'extras'); reloc.sub = path.join(reloc.target, 'Universal DnD Battle map');
    fs.mkdirSync(reloc.target, { recursive: true });
    fs.writeFileSync(path.join(reloc.target, 'big.json'), '{"x":1}');
    fs.writeFileSync(path.join(reloc.old, 'чужая заметка.md'), 'не трогать');
    fs.mkdirSync(path.join(reloc.old, 'thumbs'), { recursive: true });
    fs.writeFileSync(path.join(reloc.old, 'thumbs', 'abc.jpg'), 'jpgdata');
    await ex('VTT.gm.flush()');
    reloc.files = datafilesList(reloc.old);
    must(reloc.files.includes('library.tokens.json') && reloc.files.some((n) => /^scenes\//.test(n)), 'в старой папке нет файлов приложения: ' + reloc.files);
    reloc.hash = {}; for (const n of reloc.files) reloc.hash[n] = sha(path.join(reloc.old, n));
    reloc.lib = await ex('VTT.gm._state.lib.length');
  });
  function datafilesList(d) { return require('./datafiles').ownedFiles(d).map((f) => f.rel).sort(); }
  const dlgTitle = (t) => `!!([].slice.call(document.querySelectorAll('.vtt-ui-title')).some(function(x){return x.textContent.indexOf(${JSON.stringify(t)})>=0;}))`;
  const startPick = async () => {
    smokeMod.pickQueue.push(reloc.target);
    await ex('VTT.settings.open()');
    await waitFor("document.querySelectorAll('#setBody .cfg-line button').length > 0", 4000);
    await ex("document.querySelector('#setBody .cfg-line button').click()");       // «Выбрать…» папку данных
    await waitFor(dlgTitle('чужие файлы'), 4000);                                    // предупреждение о чужих файлах
    await ex(clickBtn('.vtt-ui-dialog .vtt-ui-btn-ok', ''));                       // «Создать подпапку»
    await waitFor(dlgTitle('Перенести данные'), 4000);                               // предложение перенести
  };
  await step('2-relocate-cancel', async () => {
    await startPick();
    await ex(clickBtn('.vtt-ui-dialog .vtt-ui-btn', 'Отмена'));
    await sleep(500);
    must(path.resolve(campaigns.get(reloc.id).folders.data) === path.resolve(reloc.old), 'отмена переноса изменила папку данных');
    must(!fs.existsSync(reloc.sub), 'отмена переноса создала новую папку');
    must(datafilesList(reloc.old).length === reloc.files.length, 'отмена переноса тронула старую папку');
    await ex('VTT.settings.close()');
  });
  await step('2-relocate-via-settings', async () => {
    await startPick();
    must(!fs.existsSync(reloc.sub) || !datafilesList(reloc.sub).length, 'в новую папку записано до подтверждения переноса');
    await ex(clickBtn('.vtt-ui-dialog .vtt-ui-btn-ok', ''));
    await waitFor("/перенесены/.test(document.getElementById('setMsg').textContent)", 8000);
    await sleep(800);
    const c = campaigns.get(reloc.id);
    must(path.resolve(c.folders.data) === path.resolve(reloc.sub), 'кампания не сохранила новую папку: ' + c.folders.data);
    const now = datafilesList(reloc.sub);
    must(JSON.stringify(now.filter((n) => !/^thumbs\//.test(n))) === JSON.stringify(reloc.files.filter((n) => !/^thumbs\//.test(n))), 'состав файлов в новой папке: ' + now);
    for (const n of reloc.files) must(sha(path.join(reloc.sub, n)) === reloc.hash[n], 'содержимое изменилось: ' + n);
    must(datafilesList(reloc.old).length === 0, 'в старой папке остались файлы приложения: ' + datafilesList(reloc.old));
    must(fs.readFileSync(path.join(reloc.old, 'чужая заметка.md'), 'utf8') === 'не трогать', 'чужой файл пострадал');
    must(fs.existsSync(path.join(reloc.target, 'big.json')), 'чужой файл в целевой папке пострадал');
    must((await ex("window.host.campaigns.current().then(function(c){return c.folders.data;})")) === c.folders.data, 'renderer видит другую папку');
    const lib = await ex("window.host.fs.readText('data','library.tokens.json').then(function(t){return JSON.parse(t).tokens ? JSON.parse(t).tokens.length : JSON.parse(t).length;})");
    must(lib === reloc.lib, 'библиотека в новой папке отличается: ' + lib + ' vs ' + reloc.lib);
    const sc = await ex('window.host.scenes.list()');
    must(sc.length === 1, 'сцены не читаются из новой папки: ' + JSON.stringify(sc));
    await ex('VTT.settings.close()');
  }, 700);

  // --- слежение за папками
  await step('2-watch-map-file', async () => {
    await ex('window.__watch = []; window.host.watch.onChange(function(e){ window.__watch.push(e); }); 0');
    const mapsDir = campaigns.current().folders.maps;
    const jf = fs.readdirSync(mapsDir).find((n) => /\.map\.json$/.test(n));
    const p = path.join(mapsDir, jf);
    fs.writeFileSync(p, fs.readFileSync(p));      // «touch»: тот же текст, новая mtime
    await waitFor("window.__watch.some(function(e){return e.kind==='maps' && e.rels.some(function(r){return /[.]map[.]json$/.test(r);});})", 6000);
    await waitFor("!document.getElementById('reloadBar').hidden", 4000);
  }, 700);
  await step('2-watch-reload', async () => {
    await ex("document.getElementById('btnReload').click()");
    await waitFor("document.getElementById('reloadBar').hidden", 4000);
    await sleep(500);
    must((await ex('VTT.gm._state.scene.tokens.length')) === 1, 'после перезагрузки карты токен потерян');
  });
  await step('2-watch-new-map', async () => {
    const mapsDir = campaigns.current().folders.maps;
    await ex("document.getElementById('picker').hidden = false");
    const before = await ex("document.querySelectorAll('#mapList button').length");
    const jf = fs.readdirSync(mapsDir).find((n) => /\.map\.json$/.test(n));
    const meta = fs.readFileSync(path.join(mapsDir, jf), 'utf8');
    fs.writeFileSync(path.join(mapsDir, 'Новая карта.map.json'), meta);
    await waitFor("document.querySelectorAll('#mapList button').length === " + (before + 1), 6000);
    await ex("document.getElementById('picker').hidden = true");
  });
  await step('2-watch-media', async () => {
    const dir = campaigns.current().media[0].path;
    await ex('window.__watch.length = 0');
    fs.copyFileSync(path.join(dir, 'Herb.png'), path.join(dir, 'Herb2.png'));
    await waitFor("window.__watch.some(function(e){return e.kind==='media';})", 6000);
  });

  // --- лог: ошибки окна попадают в main.log
  await step('2-renderer-error-in-log', async () => {
    await ex("setTimeout(function(){ throw new Error('SMOKE_EXPECTED_RENDERER_ERROR'); }, 0); console.error('SMOKE_EXPECTED_CONSOLE_ERROR'); Promise.reject(new Error('SMOKE_EXPECTED_REJECTION')); 0");
    await sleep(1200);
    const text = fs.readFileSync(logger.logPath(), 'utf8');
    must(/==== Universal DnD Battle map .*Electron \d+/.test(text), 'в логе нет заголовка с версиями');
    for (const key of ['SMOKE_EXPECTED_RENDERER_ERROR', 'SMOKE_EXPECTED_CONSOLE_ERROR', 'SMOKE_EXPECTED_REJECTION']) must(text.includes(key), 'в логе нет ' + key);
    must(!/ENOENT/.test(text), 'в логе есть ENOENT (отсутствие library.tokens.json должно обрабатываться тихо)');
  });

  // --- отчёт о проблеме
  await step('2-report-dialog', async () => {
    await ex('VTT.reportUi.open()');
    await ex("(function(){var t=document.getElementById('reportText'); t.value='Тест: токен пропал после смены кампании'; })()");
    await waitFor("!!document.getElementById('reportCollect')", 3000);
  }, 700);
  await step('2-report-zip', async () => {
    await ex(closeOverlays);
    const home = os.homedir();
    const z = unzipSync(reportMod.build({ logDir: logger.logDir(), description: 'smoke ' + home, info: { app: 'smoke', home } }));
    const names = Object.keys(z);
    must(names.includes('logs/main.log') && names.includes('description.txt') && names.includes('versions.json'), 'состав отчёта: ' + names);
    must(!names.some((n) => /scene|\.png|\.jpg/.test(n)), 'в отчёт попали сцены/картинки');
    const esc = home.split(/[\\/]+/).filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]+');
    const homeRe = new RegExp(esc, 'i');
    for (const n of names) must(!homeRe.test(strFromU8(z[n])), 'путь пользователя остался в ' + n);
  });
};
