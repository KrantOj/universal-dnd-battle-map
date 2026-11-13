'use strict';
// Скриншоты для README (`electron . --smoke-only=shots --smoke-lang=en`): демо-карта из tests/fixtures, вымышленные токены,
// без контента кампании. Пишет PNG в docs/img/: gm-view, player-view, editor, music-panel.
const fs = require('fs');
const path = require('path');

function prepareMusic(tmp) {
  const wav = require('./smoke-music').wav;
  const dir = path.join(tmp, 'music');
  wav(path.join(dir, 'Tavern', 'Fireside Tale.wav'), 20);
  wav(path.join(dir, 'Tavern', 'Barroom Brawl.wav'), 20);
  wav(path.join(dir, 'Battle', 'Clash of Steel.wav'), 20);
  wav(path.join(dir, 'Dungeon', 'Dripping Dark.wav'), 20);
  return dir;
}

module.exports = async function shots(k) {
  const { windows, appPath, ex, waitFor, step, sleep } = k;
  const out = path.join(appPath, 'docs', 'img');
  fs.mkdirSync(out, { recursive: true });
  const save = async (wc, name, rect) => {
    const img = await (rect ? wc.capturePage(rect) : wc.capturePage());
    fs.writeFileSync(path.join(out, name), img.toPNG());
  };
  const gm = () => windows.getGmWindow();
  gm().setBounds({ x: 40, y: 30, width: 1360, height: 840 });

  const place = (name, label, color, size, kind, hp, ac, speed, x, y) =>
    `a.startPlacement({name:'${name}',label:'${label}',color:'${color}',size:${size},kind:'${kind}',maxHp:${hp},ac:${ac},speed:${speed}});a.placeToken(${x},${y});`;

  await step('shots-setup', async () => {
    await waitFor("!!(window.VTT && VTT.gm && VTT.music && document.querySelectorAll('#mapList button').length)", 15000);
    await ex("document.querySelector('#mapList button').click()");
    await waitFor('!!(VTT.gm._state.map && VTT.gm._state.scene)', 10000);
    await ex('(function(){var a=VTT.gm._api;' +
      place('Aria', 'A', '#3b82f6', 1, 'pc', 32, 16, 30, 4, 4) +
      place('Borin', 'B', '#3fb950', 1, 'pc', 41, 18, 25, 5, 5) +
      place('Goblin', 'G', '#da3633', 1, 'enemy', 12, 13, 30, 8, 5) +
      place('Goblin', 'G', '#da3633', 1, 'enemy', 12, 13, 30, 9, 7) +
      place('Ogre', 'O', '#a371f7', 2, 'enemy', 59, 11, 40, 11, 4) + '})()');
    await ex('(function(){var S=VTT.gm._state;var C=S.map.cols,a=S.scene.fog.split("");' +
      'for(var y=0;y<S.map.rows;y++)for(var x=0;x<C;x++){if(Math.abs(x-7)<=7&&Math.abs(y-5)<=6)a[y*C+x]="0";}' +
      'S.scene.fog=a.join("");VTT.gm._api.changed();})()');
    await ex("document.getElementById('cbRoll').click()");
    await ex("document.getElementById('cbStart').click()");
    await ex('window.host.windows.openPlayer()');
    await waitFor('!!(VTT.sync && VTT.sync.isOpen())', 8000);
    await waitFor("!!document.querySelector('canvas')", 8000, 'player');
    await sleep(2500);
  }, 800);

  await step('shots-gm-player', async () => {
    await save(gm().webContents, 'gm-view.png');
    await save(windows.getPlayerWindow().webContents, 'player-view.png');
  });

  await step('shots-music', async () => {
    await waitFor('VTT.music._state.lists.length >= 3', 8000);
    await ex("(function(){var s=document.getElementById('muList');s.value='Tavern';s.dispatchEvent(new Event('change'));})()");
    await ex("document.getElementById('muPlay').click()");
    await waitFor('VTT.music._state.playing', 8000);
    await sleep(1200);
    await ex("document.getElementById('muMain').scrollIntoView({block:'center'})");
    await sleep(300);
    const r = await ex("(function(){var e=document.getElementById('panel').getBoundingClientRect();return {x:Math.round(e.x),y:Math.round(e.y),width:Math.round(e.width),height:Math.round(e.height)};})()");
    await save(gm().webContents, 'music-panel.png', r);
    await ex("document.getElementById('muPlay').click()");
  });

  await step('shots-editor', async () => {
    windows.openEditor({ mapRel: 'demo.map.json' });
    const ed = () => windows.getEditorWindow().webContents;
    const t0 = Date.now();
    for (;;) {
      try { if (await ed().executeJavaScript('!!(window.VTT && VTT.editor && VTT.editor._state.model && VTT.editor._state.img)', true)) break; } catch (_) { /* грузится */ }
      if (Date.now() - t0 > 15000) throw new Error('editor did not open');
      await sleep(200);
    }
    windows.getEditorWindow().setBounds({ x: 60, y: 40, width: 1360, height: 840 });
    await sleep(1200);
    await save(ed(), 'editor.png');
  }, 600);
};
module.exports.prepareMusic = prepareMusic;
