'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/load');

const L = load(['music-logic.js']).musicLogic;
const plain = (x) => JSON.parse(JSON.stringify(x));
const D = (a, b) => assert.deepStrictEqual(plain(a), plain(b));
const ND = (a, b) => assert.notDeepStrictEqual(plain(a), plain(b));
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

test('плейлисты: подпапки + «Без папки», натуральный порядок, только аудио', () => {
  const e = (rel, isDir) => ({ rel, isDir: !!isDir });
  const pl = L.buildPlaylists([
    e('Бой', true), e('Бой/10 финал.mp3'), e('Бой/2 атака.mp3'), e('Бой/readme.txt'), e('Бой/вложено/x.OGG'),
    e('Таверна/a.flac'), e('Пустая', true), e('Пустая/n.txt'), e('solo.wav'), e('cover.jpg'), e('z.opus'), e('t.m4a'), e('t2.aac')
  ]);
  D(pl.map((p) => p.id), ['.', 'Бой', 'Таверна']);
  D(pl[0].tracks.map((t) => t.rel), ['solo.wav', 't.m4a', 't2.aac', 'z.opus']);
  D(pl[1].tracks.map((t) => t.rel), ['Бой/2 атака.mp3', 'Бой/10 финал.mp3', 'Бой/вложено/x.OGG']);
  assert.strictEqual(pl[1].tracks[0].title, '2 атака');
  D(L.buildPlaylists([]), []);
  for (const x of ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus']) assert.ok(L.isAudio('a.' + x.toUpperCase()), x);
  assert.ok(!L.isAudio('a.mid') && !L.isAudio('noext'));
});

test('перемешивание: перестановка без повторов, текущий первым, разные seed — разный порядок', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const o = L.makeOrder(12, true, rng(seed), 5);
    assert.strictEqual(o[0], 5);
    D([...o].sort((a, b) => a - b), [...Array(12).keys()]);
  }
  D(L.makeOrder(4, false, rng(1), 2), [0, 1, 2, 3]);
  D(L.makeOrder(1, true, rng(1), 0), [0]);
  D(L.makeOrder(0, true, rng(1), -1), []);
  ND(L.makeOrder(10, true, rng(1), -1), L.makeOrder(10, true, rng(2), -1));
  // новый круг не начинается с только что сыгранного
  for (let seed = 1; seed <= 50; seed++) {
    const o = L.reshuffle(5, rng(seed), 3);
    assert.notStrictEqual(o[0], 3);
    D([...o].sort(), [0, 1, 2, 3, 4]);
  }
  D(L.reshuffle(1, rng(1), 0), [0]);
});

test('step: вперёд/назад при повторах off / playlist / track', () => {
  const s = (o) => L.step(Object.assign({ len: 3, pos: 0, dir: 1, repeat: 'off', auto: false }, o));
  D(s({}), { pos: 1, wrapped: false });
  D(s({ pos: 2 }), { pos: -1, wrapped: false });                          // конец, повтор выкл. — стоп
  D(s({ pos: 2, repeat: 'playlist' }), { pos: 0, wrapped: true });
  D(s({ pos: 1, repeat: 'track', auto: true }), { pos: 1, wrapped: false });   // сам доиграл — тот же
  D(s({ pos: 1, repeat: 'track', auto: false }), { pos: 2, wrapped: false });  // кнопка «вперёд» идёт дальше
  D(s({ pos: 2, repeat: 'track', auto: false }), { pos: 0, wrapped: true });
  D(s({ pos: 1, dir: -1 }), { pos: 0, wrapped: false });
  D(s({ pos: 0, dir: -1 }), { pos: 0, wrapped: false });                  // назад с первого — он же
  D(s({ pos: 0, dir: -1, repeat: 'playlist' }), { pos: 2, wrapped: true });
  D(s({ len: 0 }), { pos: -1, wrapped: false });
  D(s({ len: 1, pos: 0, repeat: 'playlist', auto: true }), { pos: 0, wrapped: true });
  D(['off', 'playlist', 'track'].map(L.nextRepeat), ['playlist', 'track', 'off']);
});

test('полный круг с перемешиванием: каждый трек ровно раз, затем новый круг', () => {
  const n = 6, r = rng(7);
  let order = L.makeOrder(n, true, r, -1), pos = 0;
  const seen = [order[0]];
  for (let k = 0; k < n - 1; k++) { const p = L.step({ len: n, pos, dir: 1, repeat: 'playlist', auto: true }); pos = p.pos; seen.push(order[pos]); }
  D([...seen].sort(), [0, 1, 2, 3, 4, 5]);
  const p = L.step({ len: n, pos, dir: 1, repeat: 'playlist', auto: true });
  assert.ok(p.wrapped && p.pos === 0);
  order = L.reshuffle(n, r, order[pos]);
  assert.notStrictEqual(order[0], seen[n - 1]);
});

test('кроссфейд: расписание, ограничение коротких треков, равная мощность', () => {
  D(L.schedule(180, 4), { xf: 4, startAt: 176 });
  D(L.schedule(6, 10), { xf: 3, startAt: 3 });                 // не больше половины трека
  D(L.schedule(100, 0), { xf: 0, startAt: 100 });
  assert.strictEqual(L.clampXfade(99), 10); assert.strictEqual(L.clampXfade(-3), 0); assert.strictEqual(L.clampXfade('x'), 0);
  assert.strictEqual(L.clampXfade(2.26), 2.5);
  assert.ok(!L.shouldStartFade(170, 180, 4)); assert.ok(L.shouldStartFade(176, 180, 4)); assert.ok(L.shouldStartFade(179, 180, 4));
  assert.ok(!L.shouldStartFade(179, 180, 0));                                        // xf = 0: ждём ended
  assert.ok(!L.shouldStartFade(5, NaN, 3) && !L.shouldStartFade(5, Infinity, 3));
  D(L.fadeGains(0), { out: 1, in: 0 });
  const g1 = L.fadeGains(1); assert.ok(Math.abs(g1.out) < 1e-12 && g1.in === 1);
  for (let p = 0; p <= 1; p += 0.1) { const g = L.fadeGains(p); assert.ok(Math.abs(g.out * g.out + g.in * g.in - 1) < 1e-9); }
  D(L.fadeGains(5), L.fadeGains(1));
});

test('время и состояние', () => {
  assert.strictEqual(L.fmtTime(0), '0:00'); assert.strictEqual(L.fmtTime(65.9), '1:05'); assert.strictEqual(L.fmtTime(3600 + 61), '1:01:01');
  assert.strictEqual(L.fmtTime(NaN), '0:00'); assert.strictEqual(L.fmtTime(-1), '0:00');
  const d = L.normalizeState(null);
  D(d, { playlist: null, track: null, pos: 0, volume: 0.8, shuffle: false, repeat: 'off', crossfade: 2, collapsed: false });
  const s = L.normalizeState({ playlist: 'Бой', track: 'Бой/a.mp3', pos: 12.5, volume: 7, shuffle: 1, repeat: 'track', crossfade: 99 });
  D([s.playlist, s.track, s.pos, s.volume, s.shuffle, s.repeat, s.crossfade], ['Бой', 'Бой/a.mp3', 12.5, 1, true, 'track', 10]);
  assert.strictEqual(L.normalizeState({ repeat: 'bad', crossfade: 0 }).crossfade, 0);
});

test('горячие клавиши: спецификации, допустимость, поиск действия', () => {
  const ev = (code, mods) => Object.assign({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, mods);
  assert.strictEqual(L.specFromEvent(ev('Space', { ctrlKey: true })), 'Ctrl+Space');
  assert.strictEqual(L.specFromEvent(ev('KeyM', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+KeyM');
  assert.strictEqual(L.specFromEvent(ev('ControlLeft', { ctrlKey: true })), '');
  assert.ok(L.validHotkey('Ctrl+Space') && L.validHotkey('Alt+KeyN') && L.validHotkey('F8') && L.validHotkey('MediaTrackNext'));
  // одиночные V R H D N B 0–9 стрелки и т.п. занять нельзя
  for (const bad of ['KeyV', 'Shift+KeyR', 'ArrowLeft', 'Digit1', 'Space', 'F1', 'Escape', 'Ctrl+Tab', '']) assert.ok(!L.validHotkey(bad), bad);
  const keys = L.mergeKeys({ next: 'Alt+KeyN', prev: '' });
  D(keys, { playPause: 'Ctrl+Space', next: 'Alt+KeyN', prev: '', volUp: 'Ctrl+ArrowUp', volDown: 'Ctrl+ArrowDown' });
  assert.strictEqual(L.actionFor(ev('KeyN', { altKey: true }), keys), 'next');
  assert.strictEqual(L.actionFor(ev('ArrowLeft', { ctrlKey: true }), keys), null);      // prev снят
  assert.strictEqual(L.actionFor(ev('KeyN'), keys), null);
  assert.strictEqual(L.labelOfSpec('Ctrl+ArrowRight'), 'Ctrl+→');
  assert.strictEqual(L.labelOfSpec('Alt+KeyN'), 'Alt+N');
  // умолчания не конфликтуют с клавишами мастера (V R H D N B 0-9 стрелки Delete Ctrl+Z ? Space F)
  for (const a of L.KEY_ACTIONS) assert.ok(L.validHotkey(L.DEFAULT_KEYS[a]), a);
  assert.strictEqual(new Set(Object.values(L.DEFAULT_KEYS)).size, L.KEY_ACTIONS.length);
});
