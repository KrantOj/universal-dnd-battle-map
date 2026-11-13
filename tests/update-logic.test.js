'use strict';
// Решения автообновления: режим сборки, «что делать» (установить / сообщить / выкл), сравнение версий, отбор релизов приложения,
// список разрешённых внешних ссылок.
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/main/update-logic');
const { isAllowedExternal } = require('../src/main/links');

test('режим: portable по PORTABLE_EXECUTABLE_DIR, nsis если упакована, иначе dev', () => {
  assert.strictEqual(L.detectMode({ portableDir: 'C:\\x', isPackaged: true }), 'portable');
  assert.strictEqual(L.detectMode({ portableDir: undefined, isPackaged: true }), 'nsis');
  assert.strictEqual(L.detectMode({ portableDir: '', isPackaged: true }), 'nsis');
  assert.strictEqual(L.detectMode({ portableDir: undefined, isPackaged: false }), 'dev');
});

test('решение: nsis ставит, portable только сообщает, dev не трогает', () => {
  assert.strictEqual(L.decide({ mode: 'nsis', enabled: true }), 'install');
  assert.strictEqual(L.decide({ mode: 'portable', enabled: true }), 'notify');
  assert.strictEqual(L.decide({ mode: 'dev', enabled: true, manual: true }), 'off');
});

test('настройка «Проверять обновления» выключена: автопроверки нет, ручная работает', () => {
  assert.strictEqual(L.decide({ mode: 'nsis', enabled: false }), 'off');
  assert.strictEqual(L.decide({ mode: 'portable', enabled: false }), 'off');
  assert.strictEqual(L.decide({ mode: 'nsis', enabled: false, manual: true }), 'install');
  assert.strictEqual(L.decide({ mode: 'portable', enabled: false, manual: true }), 'notify');
});

test('сравнение версий', () => {
  assert.strictEqual(L.isNewer('1.0.1', '1.0.0'), true);
  assert.strictEqual(L.isNewer('1.10.0', '1.9.9'), true);   // не строковое сравнение
  assert.strictEqual(L.isNewer('2.0.0', '1.99.99'), true);
  assert.strictEqual(L.isNewer('1.0.0', '1.0.0'), false);
  assert.strictEqual(L.isNewer('0.9.9', '1.0.0'), false);
  assert.strictEqual(L.isNewer('v1.0.1', '1.0.0'), true);
  assert.strictEqual(L.compareVersions('1.0.0', '1.0.0'), 0);
});

test('не-версии и пререлизы никогда не считаются обновлением', () => {
  for (const bad of ['', null, undefined, 'extras-tokens-1', '1.0', '1.0.1-beta.1', '1.0.0.1', 'latest']) {
    assert.strictEqual(L.isNewer(bad, '1.0.0'), false, String(bad));
    assert.strictEqual(L.isStable(bad), false, String(bad));
  }
});

test('GitHub latest: только настоящий релиз приложения', () => {
  const app = { tag_name: 'v1.2.3', draft: false, prerelease: false, assets: [{ name: 'latest.yml' }, { name: 'x Setup 1.2.3.exe' }] };
  assert.deepStrictEqual(L.parseLatestRelease(app), { version: '1.2.3', url: 'https://github.com/KrantOj/universal-dnd-battle-map/releases/tag/v1.2.3' });
  // дополнительный релиз с токенами: тег не vX.Y.Z и нет latest.yml
  assert.strictEqual(L.parseLatestRelease({ tag_name: 'extras-tokens-1', assets: [{ name: 'Библиотека токенов.vtt.json' }] }), null);
  assert.strictEqual(L.parseLatestRelease(Object.assign({}, app, { tag_name: 'extras-tokens-1' })), null);
  assert.strictEqual(L.parseLatestRelease(Object.assign({}, app, { assets: [{ name: 'a.exe' }] })), null);
  assert.strictEqual(L.parseLatestRelease(Object.assign({}, app, { prerelease: true })), null);
  assert.strictEqual(L.parseLatestRelease(Object.assign({}, app, { draft: true })), null);
  assert.strictEqual(L.parseLatestRelease(Object.assign({}, app, { tag_name: 'v1.2.3-rc1' })), null);
  assert.strictEqual(L.parseLatestRelease(null), null);
  assert.strictEqual(L.parseLatestRelease({ message: 'Not Found' }), null);
});

test('интервалы: первая проверка через 10 с, далее раз в 6 ч', () => {
  assert.strictEqual(L.CHECK_FIRST_MS, 10000);
  assert.strictEqual(L.CHECK_EVERY_MS, 6 * 3600 * 1000);
});

test('внешние ссылки: только репозиторий приложения на github.com', () => {
  const R = 'https://github.com/KrantOj/universal-dnd-battle-map';
  assert.ok(isAllowedExternal(R));
  assert.ok(isAllowedExternal(R + '/releases/latest'));
  assert.ok(isAllowedExternal(R + '/releases/tag/v1.0.0'));
  for (const bad of ['http://github.com/KrantOj/universal-dnd-battle-map', 'https://github.com/KrantOj/universal-dnd-battle-map-evil',
    'https://github.com/KrantOj', 'https://evil.com/KrantOj/universal-dnd-battle-map', 'https://github.com.evil.com/KrantOj/universal-dnd-battle-map',
    'https://user@github.com/KrantOj/universal-dnd-battle-map', 'javascript:alert(1)', 'file:///C:/Windows', '', null, undefined]) {
    assert.strictEqual(isAllowedExternal(bad), false, String(bad));
  }
});
