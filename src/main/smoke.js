'use strict';
// End-to-end smoke harness: `npm run smoke` -> `electron . --smoke` (`npm run smoke:wizard` = no-campaign path).
// Uses a temp userData, runs a scripted GM session, saves screenshots + report to <tmp>/udbm-smoke-<ts>/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const i18n = require('./i18n');

const argv = process.argv;
const onlyArg = argv.find((a) => a.indexOf('--smoke-only=') === 0);
const only = onlyArg ? onlyArg.slice('--smoke-only='.length) : null;   // --smoke-only=editor: только сценарий редактора карт
const enabled = argv.includes('--smoke') || argv.includes('--smoke-wizard') || !!only;
const wizardOnly = argv.includes('--smoke-wizard');
let tmp = null;

/** Must run BEFORE app ready. */
function early() {
  if (!enabled) return;
  tmp = path.join(os.tmpdir(), `udbm-smoke-${Date.now()}`);
  fs.mkdirSync(path.join(tmp, 'shots'), { recursive: true });
  app.setPath('userData', path.join(tmp, 'userData'));
  // язык smoke фиксируем (иначе зависит от локали ОС): ru, если не задан --smoke-lang=en
  const lg = argv.find((a) => a.indexOf('--smoke-lang=') === 0);
  fs.mkdirSync(path.join(tmp, 'userData'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'userData', 'settings.json'), JSON.stringify({ lang: lg ? lg.slice('--smoke-lang='.length) : 'ru' }));
  console.log('SMOKE_DIR=' + tmp);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { mode: wizardOnly ? 'wizard' : 'full', steps: [], errors: [], consoleErrors: [] };

async function run(windows, campaigns) {
  const appPath = app.getAppPath();
  const finish = (code) => {
    report.ok = code === 0;
    try { fs.writeFileSync(path.join(tmp, 'smoke-report.json'), JSON.stringify(report, null, 2)); } catch (_) {}
    console.log('SMOKE_RESULT ' + (code === 0 ? 'OK' : 'FAIL') + ' errors=' + (report.errors.length + report.consoleErrors.length));
    app.exit(code);
  };
  const watchdog = setTimeout(() => { report.errors.push('watchdog timeout'); finish(1); }, only === 'lang' ? 150000 : 90000);

  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (...a) => {
      const d = (a[0] && typeof a[0] === 'object' && 'level' in a[0]) ? a[0] : { level: a[1], message: a[2], lineNumber: a[3], sourceId: a[4] };
      const lv = d.level;
      if (String(d.message).indexOf('SMOKE_EXPECTED') >= 0) return;   // ошибки, которые smoke вызывает нарочно (проверка лога)
      if (lv === 'error' || lv === 'warning' || lv === 3 || lv === 2) {
        report.consoleErrors.push({ level: lv, message: d.message, at: `${d.sourceId}:${d.lineNumber}` });
      }
    });
    wc.on('did-fail-load', (_ev, code, desc, url) => report.errors.push(`did-fail-load ${code} ${desc} ${url}`));
    wc.on('render-process-gone', (_ev, det) => report.errors.push('render-process-gone ' + JSON.stringify(det)));
  });

  let shot = 0;
  const snap = async (name) => {
    shot++;
    const nn = String(shot).padStart(2, '0');
    for (const [who, w] of [['gm', windows.getGmWindow()], ['player', windows.getPlayerWindow()], ['editor', windows.getEditorWindow && windows.getEditorWindow()]]) {
      if (!w || w.isDestroyed()) continue;
      try {
        const img = await w.webContents.capturePage();
        fs.writeFileSync(path.join(tmp, 'shots', `${nn}-${name}-${who}.png`), img.toPNG());
      } catch (e) { (report.warnings = report.warnings || []).push(`capture ${name}/${who}: ${e.message}`); }   // скриншот — не проверка: экран может быть погашен
    }
  };
  const gm = () => windows.getGmWindow().webContents;
  const ex = (js) => gm().executeJavaScript(js, true);
  const waitFor = async (js, ms, who) => {
    const wc = who === 'player' ? windows.getPlayerWindow().webContents : gm();
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 10000)) {
      try { if (await wc.executeJavaScript(js, true)) return true; } catch (_) {}
      await sleep(150);
    }
    throw new Error('timeout waiting for: ' + js);
  };
  const step = async (name, fn, settle) => {
    const t0 = Date.now();
    try { await fn(); report.steps.push({ name, ok: true, ms: Date.now() - t0 }); }
    catch (e) { report.steps.push({ name, ok: false, error: e.message }); report.errors.push(`${name}: ${e.message}`); }
    await sleep(settle || 600);
    await snap(name);
  };

  try {
    if (wizardOnly) {
      await windows.createGmWindow();
      await sleep(1500);
      await step('wizard', async () => {
        await waitFor("!!document.getElementById('wzNext')");
        const t = await ex("document.getElementById('wzTitle').textContent");
        if (!t) throw new Error('wizard title empty');
        for (let i = 0; i < 8; i++) { await ex("document.getElementById('wzNext').click()"); await sleep(250); }
        const nextTxt = await ex("document.getElementById('wzNext').textContent");
        if (nextTxt !== i18n.t('wizard.btn.create')) throw new Error('did not reach last wizard step: ' + nextTxt);
      });
      clearTimeout(watchdog);
      return finish(report.errors.length || report.consoleErrors.length ? 1 : 0);
    }

    // ---- campaign ----
    const fixtures = path.join(appPath, 'tests', 'fixtures');
    const mapsDir = path.join(tmp, 'maps'); fs.cpSync(fixtures, mapsDir, { recursive: true });
    const mediaDir = path.join(tmp, 'media'); fs.mkdirSync(mediaDir, { recursive: true });
    fs.copyFileSync(path.join(appPath, 'build', 'icon.png'), path.join(mediaDir, 'Herb.png'));
    campaigns.create({
      name: only === 'shots' ? 'Demo campaign' : 'Smoke',
      folders: { data: path.join(tmp, 'data'), maps: mapsDir, battlelog: path.join(tmp, 'log'), music: only === 'shots' ? require('./smoke-shots').prepareMusic(tmp) : require('./smoke-music').prepare(tmp) },
      media: [{ id: 'm1', label: 'Картинки', path: mediaDir }],
      playerWindow: { auto: false },
    });
    await windows.createGmWindow();

    if (only === 'music') {
      await step('init', async () => { await waitFor("!!(window.VTT && VTT.gm && VTT.music && document.querySelectorAll('#mapList button').length)", 15000); });
      await require('./smoke-music')({ windows, campaigns, tmp, ex, waitFor, step, sleep });
      clearTimeout(watchdog);
      return finish(report.errors.length || report.consoleErrors.length ? 1 : 0);
    }

    if (only === 'about') {
      await require('./smoke-about')({ windows, appPath, ex, waitFor, step, sleep });
      clearTimeout(watchdog);
      return finish(report.errors.length || report.consoleErrors.length ? 1 : 0);
    }

    if (only === 'shots') {
      await require('./smoke-shots')({ windows, appPath, ex, waitFor, step, sleep });
      clearTimeout(watchdog);
      return finish(report.errors.length || report.consoleErrors.length ? 1 : 0);
    }

    if (only === 'lang') {
      await require('./smoke-lang')({ windows, campaigns, tmp, ex, waitFor, step, sleep, report });
      clearTimeout(watchdog);
      return finish(report.errors.length || report.consoleErrors.length ? 1 : 0);
    }

    if (only === 'editor') {
      await step('init', async () => { await waitFor("!!(window.VTT && VTT.gm && document.querySelectorAll('#mapList button').length)", 15000); });
      await require('./smoke-editor')({ windows, campaigns, tmp, appPath, ex, waitFor, step, sleep, smoke: module.exports });
      clearTimeout(watchdog);
      return finish(report.errors.length || report.consoleErrors.length ? 1 : 0);
    }

    await step('init', async () => {
      await waitFor("!!(window.VTT && VTT.gm && document.querySelectorAll('#mapList button').length)", 15000);
    });
    await step('open-map', async () => {
      await ex("document.querySelector('#mapList button').click()");
      await waitFor("!!(VTT.gm._state.map && VTT.gm._state.scene)", 10000);
    }, 900);
    await step('place-token', async () => {
      await ex("(function(){var a=VTT.gm._api;a.startPlacement({name:'Hero',label:'H',color:'#3b82f6',size:1,kind:'pc',maxHp:20,speed:30});a.placeToken(3,3);})()");
      const n = await ex('VTT.gm._state.scene.tokens.length');
      if (n !== 1) throw new Error('token count ' + n);
    });
    await step('open-player', async () => {
      await ex('window.host.windows.openPlayer()');
      await waitFor("!!(VTT.sync && VTT.sync.isOpen())", 8000);
      await waitFor("!!document.querySelector('canvas')", 8000, 'player');
      await sleep(2500);
    }, 1500);
    await step('reveal-and-move', async () => {
      await ex("(function(){var S=VTT.gm._state;var t=S.scene.tokens[0];var C=S.map.cols,a=S.scene.fog.split('');" +
        "for(var y=0;y<S.map.rows;y++)for(var x=0;x<C;x++){if(Math.abs(x-7)<=5&&Math.abs(y-5)<=4)a[y*C+x]='0';}" +
        "S.scene.fog=a.join('');t.x=6;t.y=5;VTT.gm._api.changed();})()");
    }, 1200);
    await step('toggle-door', async () => {
      await ex("(function(){var S=VTT.gm._state;if(S.scene.doors.length){S.scene.doors[0]=!S.scene.doors[0];S.segs=null;VTT.gm._api.changed();}})()");
    });
    await step('combat', async () => {
      await ex("document.getElementById('cbStart').click()");
    });
    await step('dice', async () => {
      await ex("document.getElementById('diceShow').checked=true;document.getElementById('diceExpr').value='2d6+3';document.getElementById('diceGo').click()");
      await sleep(1200);
    }, 600);
    await step('showcase', async () => {
      await ex("document.getElementById('btnShow').click()");
      await ex("(function(){var t=document.querySelectorAll('.sd-tab');if(t[1])t[1].click();})()");
      await waitFor("document.querySelectorAll('#sdBody .sd-card').length>0", 8000);
      await ex("document.querySelector('#sdBody .sd-card').click()");
      await sleep(1800);
      const shown = await windows.getPlayerWindow().webContents.executeJavaScript("document.documentElement.innerHTML.indexOf('userfile://')>=0", true);
      if (!shown) report.errors.push('showcase: no userfile:// image found in player DOM');
    }, 800);
    await step('end', async () => { await ex("document.getElementById('cbEnd') && document.getElementById('cbEnd').click()"); });
    await require('./smoke-stage2')({ campaigns, tmp, ex, waitFor, step, sleep });
  } catch (e) {
    report.errors.push('fatal: ' + (e && e.stack || e));
  }
  clearTimeout(watchdog);
  finish(report.errors.length || report.consoleErrors.length ? 1 : 0);
}

const fileQueue = [];   // ответы для host.dialog.pickFiles в smoke
const pickQueue = [];   // ответы для host.dialog.pickFolder в smoke
module.exports = { enabled, wizardOnly, only, early, run, pickQueue, fileQueue };
