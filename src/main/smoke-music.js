'use strict';
// Smoke музыки (`electron . --smoke-only=music`): короткие тихие WAV во временной папке music, выбор плейлиста,
// воспроизведение, перемотка, следующий трек (кроссфейд), громкость, сохранение состояния в kv, восстановление после перезагрузки панели.
const fs = require('fs');
const path = require('path');

function wav(file, seconds) {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n, 0x80);   // 8 бит, моно, тишина
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

/** Создаёт <tmp>/music с двумя плейлистами и файлом в корне; возвращает путь. */
function prepare(tmp) {
  const dir = path.join(tmp, 'music');
  wav(path.join(dir, 'Таверна', '01 Первая.wav'), 8);
  wav(path.join(dir, 'Таверна', '02 Вторая.wav'), 8);
  wav(path.join(dir, 'Бой', 'Атака.wav'), 6);
  wav(path.join(dir, 'Корень.wav'), 4);
  fs.writeFileSync(path.join(dir, 'Таверна', 'заметка.txt'), 'не аудио');
  return dir;
}

async function musicSmoke(k) {
  const { campaigns, ex, waitFor, step, sleep } = k;
  const must = (c, m) => { if (!c) throw new Error(m); };
  const dir = campaigns.current().folders.music;
  const M = 'VTT.music';

  await step('music-playlists', async () => {
    await waitFor(`${M}._state.lists.length === 3`, 8000);
    const ids = await ex(`${M}._state.lists.map(function(l){return l.id;}).join("|")`);
    must(ids === '.|Бой|Таверна', 'плейлисты: ' + ids);
    must((await ex("document.getElementById('muMain').hidden")) === false, 'панель управления скрыта');
    must((await ex(`${M}._state.lists[2].tracks.length`)) === 2, 'txt не должен считаться треком');
    const n = await ex("navigator.mediaDevices.enumerateDevices().then(function(d){return d.filter(function(x){return x.kind==='audiooutput';}).length;})");
    must(typeof n === 'number', 'enumerateDevices не работает');
  }, 700);

  await step('music-play', async () => {
    await ex("(function(){var s=document.getElementById('muList');s.value='Таверна';s.dispatchEvent(new Event('change'));})()");
    await ex("document.getElementById('muXf').value='1';document.getElementById('muXf').dispatchEvent(new Event('input'))");
    await ex("document.getElementById('muPlay').click()");
    await waitFor(`${M}._state.playing && ${M}._audio[${M}._cur()].currentTime > 0.3`, 8000);
    const t = await ex(`${M}._api.snapshot().track`);
    must(t === 'Таверна/01 Первая.wav', 'играет не первый трек: ' + t);
    const src = await ex(`${M}._audio[${M}._cur()].src`);
    must(/^userfile:\/\/r\/music\//.test(src), 'трек не через userfile://: ' + src);
  }, 800);

  await step('music-seek', async () => {
    await ex("(function(){var s=document.getElementById('muSeek');s.value='3';s.dispatchEvent(new Event('input'));s.dispatchEvent(new Event('change'));})()");
    await waitFor(`${M}._audio[${M}._cur()].currentTime >= 2.9`, 4000);   // Range-запросы userfile:// работают
  }, 500);

  await step('music-next-crossfade', async () => {
    await ex("document.getElementById('muNext').click()");
    await waitFor(`${M}._api.snapshot().track === 'Таверна/02 Вторая.wav'`, 5000);
    await sleep(1800);                                   // переход (1 с) завершён: старый <audio> на паузе
    const st = await ex(`(function(){var A=${M}._audio,c=${M}._cur();return {cur:!A[c].paused,old:A[1-c].paused};})()`);
    must(st.cur && st.old, 'после кроссфейда должен играть один элемент: ' + JSON.stringify(st));
  }, 600);

  await step('music-volume-persist', async () => {
    await ex("(function(){var v=document.getElementById('muVol');v.value='35';v.dispatchEvent(new Event('input'));})()");
    await ex("document.getElementById('muShuffle').click();document.getElementById('muRepeat').click()");
    await ex(`${M}._api.persist()`);
    await sleep(300);
    const kv = await ex("window.host.kv.get('music')");
    must(kv && kv.volume === 0.35 && kv.playlist === 'Таверна' && kv.track === 'Таверна/02 Вторая.wav', 'kv music: ' + JSON.stringify(kv));
    must(kv.shuffle === true && kv.repeat === 'playlist' && kv.crossfade === 1 && kv.pos >= 0, 'kv music (режимы): ' + JSON.stringify(kv));
    const vol = await ex(`${M}._audio[${M}._cur()].volume`);
    must(Math.abs(vol - 0.35) < 0.01, 'громкость элемента ' + vol);
  }, 800);

  await step('music-pause-restore', async () => {
    await ex("document.getElementById('muPlay').click()");
    must((await ex(`${M}._state.playing`)) === false, 'пауза не сработала');
    await ex(`${M}._api.persist()`);
    // «перезапуск»: смена папки музыки перечитывает состояние из kv (как при открытии окна)
    await ex('window.host.campaigns.current().then(function(c){return window.host.campaigns.update(c.id,{folders:{music:c.folders.music+"/"}});})');
    await sleep(500);
    await waitFor(`${M}._state.ready && ${M}._state.lists.length === 3`, 6000);
    const s = await ex(`(function(){var m=${M}._state;return {l:m.listId,v:m.volume,sh:m.shuffle,r:m.repeat,x:m.xfade,t:${M}._api.snapshot().track,p:m.playing};})()`);
    must(s.l === 'Таверна' && s.v === 0.35 && s.sh === true && s.r === 'playlist' && s.x === 1 && s.t === 'Таверна/02 Вторая.wav' && s.p === false, 'состояние не восстановилось: ' + JSON.stringify(s));
  }, 800);

  await step('music-watch-new-file', async () => {
    fs.copyFileSync(path.join(dir, 'Корень.wav'), path.join(dir, 'Бой', 'Вторая атака.wav'));
    await waitFor(`${M}._state.lists.filter(function(l){return l.id==='Бой';})[0].tracks.length === 2`, 6000);
  }, 600);

  await step('music-hotkey', async () => {
    // Ctrl+Space = пауза/пуск, но не в поле ввода
    const press = (target) => ex(`(function(){var t=${target};t.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',ctrlKey:true,bubbles:true}));})()`);
    await press('document.body');
    await waitFor(`${M}._state.playing`, 4000);
    await ex("(function(){var i=document.getElementById('libSearch');i.focus();})()");
    await press("document.getElementById('libSearch')");
    await sleep(200);
    must((await ex(`${M}._state.playing`)) === true, 'хоткей сработал в поле ввода');
    await ex('document.activeElement.blur()');
    await press('document.body');
    await waitFor(`!${M}._state.playing`, 3000);
  }, 800);
}

module.exports = musicSmoke;
module.exports.prepare = prepare;
