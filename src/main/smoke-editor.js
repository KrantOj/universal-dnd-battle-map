'use strict';
// Smoke редактора карт (`electron . --smoke-only=editor`): новая карта из картинки, сетка, стена + дверь, вода, высота,
// сохранение, «Проверить в бою», проверка в окне мастера, что путь через стену/закрытую дверь закрыт.
const fs = require('fs');
const path = require('path');

module.exports = async function editorSmoke(k) {
  const { windows, tmp, appPath, ex, waitFor, step, sleep, smoke } = k;
  const must = (c, m) => { if (!c) throw new Error(m); };
  const edWc = () => windows.getEditorWindow().webContents;
  const exe = (js) => edWc().executeJavaScript(js, true);
  const waitEd = async (js, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 10000)) { try { if (await exe(js)) return true; } catch (_) { /* окно ещё грузится */ } await sleep(150); }
    throw new Error('timeout (editor) waiting for: ' + js);
  };
  // указатель: клетка (дробная) -> события на canvas редактора
  const ptr = (type, fx, fy, extra) => exe(`(function(){var p=VTT.editor._api.cellToClient(${fx},${fy});var cv=document.getElementById('edCanvas');
    cv.dispatchEvent(new PointerEvent('${type}',Object.assign({clientX:p.x,clientY:p.y,button:0,pointerId:1,bubbles:true},${JSON.stringify(extra || {})})));})()`);
  const click = async (fx, fy) => { await ptr('pointerdown', fx, fy); await ptr('pointerup', fx, fy); };
  const setField = (id, v) => exe(`(function(){var e=document.getElementById('${id}');e.value='${v}';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));})()`);
  const key = (k2) => exe(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${k2}',bubbles:true}))`);

  const name = 'Smoke Editor';
  const srcDir = path.join(tmp, 'src-img'); fs.mkdirSync(srcDir, { recursive: true });
  const srcImg = path.join(srcDir, 'smokemap.png');
  fs.copyFileSync(path.join(appPath, 'tests', 'fixtures', 'demo (VTT).png'), srcImg);
  const mapsDir = require('./campaigns').current().folders.maps;
  const jsonPath = path.join(mapsDir, name, name + '.map.json');

  await step('editor-open-new', async () => {
    smoke.fileQueue.push(srcImg);
    windows.openEditor({ newFromImage: true });
    await waitEd("!!document.querySelector('.vtt-ui-input')", 15000);
    await exe(`(function(){var i=document.querySelector('.vtt-ui-input');i.value='${name}';document.querySelector('.vtt-ui-btn-ok').click();})()`);
    await waitEd('!!(VTT.editor._state.model && VTT.editor._state.img)', 10000);
    must((await exe('VTT.editor._state.model.imgW')) === 1218, 'размер картинки');
    must(!fs.existsSync(path.join(mapsDir, name)), 'до первого сохранения в maps/ не должно быть папки новой карты');
  }, 900);

  await step('editor-grid', async () => {
    await setField('gOffX', 49); await setField('gOffY', 140);
    must((await exe('VTT.editor._state.model.cols')) === 16, 'авто-колонки: ' + await exe('VTT.editor._state.model.cols'));
    await setField('gRows', 12);
    const g = await exe('(function(){var m=VTT.editor._state.model;return [m.ppg,m.offX,m.offY,m.cols,m.rows];})()');
    must(JSON.stringify(g) === '[70,49,140,16,12]', 'сетка ' + JSON.stringify(g));
    await exe('VTT.editor._api.commit()');
  }, 700);

  await step('editor-wall-door', async () => {
    await exe("VTT.editor._api.setTool('wall')");
    await click(8, 0); await click(8, 12); await key('Enter');
    must((await exe('VTT.editor._state.model.walls.length')) === 1, 'стена не создана');
    await exe("VTT.editor._api.setTool('door')");
    await click(8.02, 5.5);
    must((await exe('VTT.editor._state.model.doors.length')) === 1, 'дверь не создана');
  }, 700);

  await step('editor-water-elevation', async () => {
    await exe("VTT.editor._api.setTool('terrain'); VTT.editor._state.kind='water'; VTT.editor._state.shape='brush'; VTT.editor._state.size=1;");
    await click(3.5, 3.5);
    must((await exe("VTT.editorModel.kindOf(VTT.editor._state.model,3,3)")) === 'water', 'вода не нарисована');
    await exe("VTT.editor._api.setTool('elev'); VTT.editor._state.shape='rect'; document.getElementById('eVal').value='20';");
    await ptr('pointerdown', 10.5, 2.5); await ptr('pointerup', 11.5, 3.5);
    const e = await exe('(function(){var L=VTT.editor._state.model.layers.elevation_ft;return [L[2][10],L[3][11],L[4][12]];})()');
    must(JSON.stringify(e) === '[20,20,0]', 'высоты ' + JSON.stringify(e));
    await exe("VTT.editor._api.setTool('select')");
  }, 700);

  await step('editor-undo-redo', async () => {
    await exe('VTT.editor._api.undoRedo(false)');
    must((await exe('VTT.editor._state.model.layers.elevation_ft[2][10]')) === 0, 'undo не снял высоту');
    await exe('VTT.editor._api.undoRedo(true)');
    must((await exe('VTT.editor._state.model.layers.elevation_ft[2][10]')) === 20, 'redo не вернул высоту');
  }, 500);

  await step('editor-save', async () => {
    await exe("document.getElementById('edSave').click()");
    await sleep(500);
    // диалоги по очереди: «Рамка карты» — без рамки (иначе image_grid сдвигается); замечания (если есть) — сохранить всё равно
    for (let i = 0; i < 3; i++) {
      await exe("(function(){var b=document.querySelector('.vtt-ui-backdrop');if(!b)return;var fr=/рамк|frame/i.test(b.textContent);var x=b.querySelector(fr?'.vtt-ui-btn-cancel':'.vtt-ui-btn-ok');if(x)x.click();})()");
      await sleep(500);
    }
    await waitEd('!VTT.editor._state.isNew', 8000);
    must(fs.existsSync(jsonPath), 'map.json не записан: ' + jsonPath);
    const m = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    must(m.format === 'vestfalia-battlemap/1', 'format');
    must(JSON.stringify(m.image_grid) === JSON.stringify({ x: 49, y: 140, width: 1218, height: 1144 }), 'image_grid ' + JSON.stringify(m.image_grid));
    must(m.resolution.map_size.x === 16 && m.resolution.map_size.y === 12, 'map_size');
    must(m.line_of_sight.length === 2, 'стена должна быть разрезана дверью: ' + JSON.stringify(m.line_of_sight));
    must(m.portals.length === 1 && m.portals[0].dir === 'v' && m.portals[0].position.x === 8 && m.portals[0].position.y === 5, 'portals ' + JSON.stringify(m.portals));
    must(m.layers.terrain[3][3] === 'water' && m.layers.walkable[3][3] === 0, 'вода в слоях');
    must(m.layers.elevation_ft[2][10] === 20, 'высота в слоях');
    must(fs.existsSync(path.join(mapsDir, name, m.image)), 'картинка не скопирована в папку карты');
    must(!fs.existsSync(path.join(require('./campaigns').current().folders.data, 'editor-draft.json')), 'черновик не удалён после сохранения');
  }, 900);

  await step('editor-battle-check', async () => {
    await exe("document.getElementById('edBattle').click()");
    await waitFor(`!!(VTT.gm._state.map && VTT.gm._state.curEntry && VTT.gm._state.curEntry.rel === ${JSON.stringify(name + "/" + name + ".map.json")})`, 12000);
    const r = await ex(`(function(){var S=VTT.gm._state,M=VTT.movement,G=VTT.geometry;
      var segs=G.blockingSegments(S.map.geo,S.scene.doors);
      var across=M.findPath(S.map,segs,{x:3,y:5},{x:12,y:5},{size:1});
      var open=S.scene.doors.slice();open[0]=true;
      var viaDoor=M.findPath(S.map,G.blockingSegments(S.map.geo,open),{x:7,y:5},{x:9,y:5},{size:1});
      var water=M.cellRule(S.map,3,3);
      return {acrossOk:across.ok,viaDoorOk:viaDoor.ok,viaDoorFeet:viaDoor.feet,water:water.reason,mult:water.mult,elev:S.map.meta.layers.elevation_ft[2][10]};})()`);
    must(r.acrossOk === false, 'путь через стену/закрытую дверь должен быть закрыт: ' + JSON.stringify(r));
    must(r.viaDoorOk === true && r.viaDoorFeet === 10, 'через открытую дверь должно быть 10 фт: ' + JSON.stringify(r));
    must(r.water === 'water' && r.mult === 2 && r.elev === 20, 'вода/высота в бою: ' + JSON.stringify(r));
  }, 1200);

  await step('editor-reopen-existing', async () => {
    await exe(`VTT.editor._api.openEntry(${JSON.stringify(name + '/' + name + '.map.json')})`);
    await waitEd(`VTT.editor._state.model && VTT.editor._state.model.doors.length === 1 && !VTT.editor._state.isNew`, 8000);
    const out = await exe("JSON.stringify(VTT.editorModel.toMeta(VTT.editor._state.model))");
    const disk = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    must(JSON.stringify(JSON.parse(out)) === JSON.stringify(disk), 'повторное чтение и запись меняют файл');
  }, 700);

  await step('editor-multicell-door', async () => {
    await exe("VTT.editor._api.setTool('wall')");
    await click(2, 2); await click(8, 2); await key('Enter');
    await exe("VTT.editor._api.setTool('door')");
    await ptr('pointerdown', 3.5, 2.02); await ptr('pointermove', 5.5, 2.02); await ptr('pointerup', 5.5, 2.02);
    const d = await exe('JSON.stringify(VTT.editor._state.model.doors.filter(function(x){return x.dir==="h";}))');
    must(JSON.stringify(JSON.parse(d)) === JSON.stringify([{ position: { x: 3, y: 2 }, size: [3, 1], dir: 'h', open: false }]), 'дверь 3 клетки: ' + d);
    const cut = await exe('JSON.stringify(VTT.editorModel.toMeta(VTT.editor._state.model).line_of_sight)');
    must(cut.indexOf('"x":3,"y":2') >= 0 && cut.indexOf('"x":6,"y":2') >= 0, 'разрыв стены под дверью: ' + cut);
  }, 600);

  await step('editor-panel-narrow', async () => {
    const win = windows.getEditorWindow();
    win.setSize(900, 700); await sleep(400);
    await exe("VTT.editor._api.setTool('grid')");
    await sleep(300);
    const r = await exe('(function(){var s=document.getElementById("edSide");return [s.scrollWidth,s.clientWidth];})()');
    must(r[0] <= r[1], 'панель обрезана по ширине: ' + JSON.stringify(r));
    const bad = await exe('(function(){var s=document.getElementById("edSide"),b=s.getBoundingClientRect(),o=[];s.querySelectorAll("input,button,label").forEach(function(e){if(e.offsetParent&&e.getBoundingClientRect().right>b.right+1)o.push(e.id||e.textContent);});return o;})()');
    must(!bad.length, 'элементы выходят за панель: ' + JSON.stringify(bad));
    const img = await edWc().capturePage();
    fs.writeFileSync(path.join(tmp, 'editor-panel-narrow.png'), img.toPNG());
    console.log('[smoke] editor panel screenshot: ' + path.join(tmp, 'editor-panel-narrow.png'));
  }, 600);
};
