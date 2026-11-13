'use strict';
// Smoke «О программе» (`electron . --smoke-only=about`): окно открывается, показывает версию из package.json, версии Electron/Chromium,
// текст лицензии MIT и ссылку на GitHub; внешние ссылки вне списка отклоняются; ручная проверка обновлений в режиме разработки сообщает «недоступно».
const fs = require('fs');
const path = require('path');
const must = (c, m) => { if (!c) throw new Error(m); };

module.exports = async function aboutSmoke(k) {
  const { windows, appPath, ex, waitFor, step, sleep } = k;
  const version = JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8')).version;
  await step('init', async () => { await waitFor("!!(window.VTT && VTT.gm && document.querySelectorAll('#mapList button').length)", 15000); });
  let wc;
  const exa = (js) => wc.executeJavaScript(js, true);
  const waitA = async (js, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) { try { if (await exa(js)) return true; } catch (_) { /* грузится */ } await sleep(150); }
    throw new Error('timeout (about) waiting for: ' + js);
  };

  await step('about-open', async () => {
    await ex('window.host.app.openAbout()');
    await sleep(300);
    const w = windows.getAboutWindow();
    must(w, 'окно «О программе» не открылось');
    wc = w.webContents;
    await waitA("!!document.getElementById('abVer') && document.getElementById('abVer').textContent.indexOf('" + version + "') >= 0");
    must((await exa("document.getElementById('abEng').textContent")).indexOf('Electron') >= 0, 'нет версии Electron');
    await waitA("document.getElementById('abLic').textContent.indexOf('MIT License') >= 0");
    must((await exa("document.querySelector('#abRepo').textContent.length")) > 0, 'нет ссылки на GitHub');
  }, 700);

  await step('about-links-and-check', async () => {
    const tryOpen = (u) => ex("window.host.app.openExternal('" + u + "').then(function(){return 'opened';},function(e){return e.message;})");
    const bad = await tryOpen('https://evil.example.com/');
    must(bad === 'URL_NOT_ALLOWED', 'внешняя ссылка вне списка не отклонена: ' + bad);
    const bad2 = await tryOpen('https://github.com/KrantOj/universal-dnd-battle-map-evil');
    must(bad2 === 'URL_NOT_ALLOWED', 'похожий адрес не отклонён: ' + bad2);
    await exa("document.getElementById('abCheck').click()");
    await waitA("document.getElementById('abMsg').textContent.length > 0");
    must((await ex('window.host.update.state().then(function(s){return s.mode;})')) === 'dev', 'в smoke режим обновлений должен быть dev');
  }, 500);

  await step('about-close', async () => {
    await exa("document.getElementById('abClose').click()");
    await sleep(500);
    must(!windows.getAboutWindow(), 'окно не закрылось');
  });
};
