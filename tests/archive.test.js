'use strict';
// .udbm: манифест, подмена путей на метки и обратно, проверка формата, круговой экспорт/импорт; логи: ротация и замена пути пользователя.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const archive = require('../src/main/archive');
const lu = require('../src/main/logutil');
const report = require('../src/main/report');
const { unzipSync, strFromU8 } = require('fflate');

function tmpDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `udbm-${name}-`)); }
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }

function sampleCampaign(root) {
  const c = {
    id: 'abc', name: 'Вестфалия',
    folders: { data: path.join(root, 'data'), maps: path.join(root, 'maps'), battlelog: path.join(root, 'log'), music: null },
    media: [{ id: 'm1', label: 'Герои', path: path.join(root, 'heroes'), recursive: false, exclude: null },
      { id: 'm2', label: 'Пусто', path: '', recursive: false, exclude: null }],
    battlelog: { enabled: true }, playerWindow: { auto: false, displayId: 2, fullscreen: true }, prefs: { x: 1 },
  };
  write(path.join(c.folders.data, 'scenes', 'a.scene.json'), '{"map":"a","tokens":[],"fog":"1"}');
  write(path.join(c.folders.data, 'library.tokens.json'), '{"format":"vestfalia-tokens/1","tokens":[]}');
  write(path.join(c.folders.data, 'kv.json'), '{"showPins":["m1/x.png"]}');
  write(path.join(c.folders.data, 'thumbs', 'h.jpg'), 'THUMB');
  write(path.join(c.folders.maps, 'a.map.json'), '{"image":"a.png"}');
  write(path.join(c.folders.maps, 'a.png'), Buffer.from([1, 2, 3, 4, 5]));
  write(path.join(c.folders.battlelog, 'Бой 1.md'), '# бой');
  write(path.join(c.media[0].path, 'Орк.png'), Buffer.alloc(3000, 7));
  write(path.join(c.media[0].path, 'sub', 'deep.png'), 'deep');
  write(path.join(c.media[0].path, 'notes.txt'), 'not an image');
  return c;
}

test('manifest: формат, пути заменены метками, абсолютных путей нет', () => {
  const root = tmpDir('mf');
  const c = sampleCampaign(root);
  const m = archive.buildManifest(c, { maps: true, media: false, battlelog: true }, '1.2.3', new Date('2026-01-02T03:04:05Z'));
  assert.strictEqual(m.format, 'udbm/1');
  assert.strictEqual(m.app, '1.2.3');
  assert.deepStrictEqual(m.include, { maps: true, media: false, battlelog: true });
  assert.deepStrictEqual(m.campaign.folders, { data: 'data', maps: 'maps', battlelog: 'battlelog', music: null });
  assert.strictEqual(m.campaign.media[0].path, 'media/m1');
  assert.strictEqual(m.campaign.media[1].path, null);
  assert.ok(!JSON.stringify(m).includes(root.replace(/\\/g, '\\\\')), 'в manifest остался абсолютный путь');
  assert.ok(!JSON.stringify(m).toLowerCase().includes('tmp'));
});

test('parseManifest: версия формата', () => {
  const ok = { format: 'udbm/1', campaign: { name: 'x' } };
  assert.strictEqual(archive.parseManifest(ok), ok);
  assert.throws(() => archive.parseManifest({ format: 'udbm/2', campaign: {} }), /ARCHIVE_FORMAT:udbm\/2/);
  assert.throws(() => archive.parseManifest({ format: 'zip', campaign: {} }), /ARCHIVE_NOT_UDBM/);
  assert.throws(() => archive.parseManifest(null), /ARCHIVE_NOT_UDBM/);
  assert.throws(() => archive.parseManifest({ format: 'udbm/1' }), /ARCHIVE_NOT_UDBM/);
});

test('targetsUnder / campaignFromManifest: метки -> пути под папкой данных', () => {
  const root = tmpDir('tg');
  const c = sampleCampaign(root);
  const m = archive.buildManifest(c, { maps: true, media: true, battlelog: false }, '1', new Date());
  const dd = path.join(root, 'new');
  const t = archive.targetsUnder(m, dd);
  assert.strictEqual(t.data, dd);
  assert.strictEqual(t.maps, path.join(dd, 'maps'));
  assert.strictEqual(t.battlelog, null);
  assert.deepStrictEqual(t.media, { m1: path.join(dd, 'media', 'm1') });
  const p = archive.campaignFromManifest(m, t, 'Новая');
  assert.strictEqual(p.name, 'Новая');
  assert.strictEqual(p.folders.maps, path.join(dd, 'maps'));
  assert.strictEqual(p.folders.battlelog, null);
  assert.strictEqual(p.media[0].path, path.join(dd, 'media', 'm1'));
  assert.strictEqual(p.media[1].path, '');
  const map = archive.mappingOf(m, t);
  assert.strictEqual(archive.resolveEntry('data/scenes/a.scene.json', map), path.join(dd, 'scenes', 'a.scene.json'));
  assert.strictEqual(archive.resolveEntry('maps/a.png', map), path.join(dd, 'maps', 'a.png'));
  assert.strictEqual(archive.resolveEntry('media/m1/Орк.png', map), path.join(dd, 'media', 'm1', 'Орк.png'));
  assert.strictEqual(archive.resolveEntry('battlelog/x.md', map), null);   // не включено
  assert.strictEqual(archive.resolveEntry('manifest.json', map), null);
  assert.throws(() => archive.resolveEntry('data/../../evil.txt', map), /BAD_PATH/);
  assert.throws(() => archive.resolveEntry('maps/C:/evil', map), /BAD_PATH/);
});

test('estimate: thumbs не считаются, галочки управляют частями', () => {
  const root = tmpDir('es');
  const c = sampleCampaign(root);
  const base = archive.estimate(c, {});
  assert.strictEqual(base.parts.maps + base.parts.media + base.parts.battlelog, 0);
  assert.ok(base.parts.data > 0);
  assert.ok(!archive.collect(c, {}).some((f) => f.name.includes('thumbs')));
  const all = archive.estimate(c, { maps: true, media: true, battlelog: true });
  assert.strictEqual(all.parts.maps, 5 + '{"image":"a.png"}'.length);
  assert.strictEqual(all.parts.media, 3000);   // только картинки верхнего уровня
  assert.ok(all.bytes > base.bytes);
});

test('экспорт -> inspect -> импорт как новая: сцены, библиотека, карты, картинки на месте', () => {
  const root = tmpDir('rt');
  const c = sampleCampaign(root);
  const dest = path.join(root, 'out', 'camp.udbm');
  const r = archive.exportTo(dest, c, { maps: true, media: true, battlelog: true }, '9.9.9');
  assert.ok(fs.statSync(dest).size === r.bytes && r.bytes > 0);

  const m = archive.readManifest(dest);
  assert.strictEqual(m.app, '9.9.9');
  assert.strictEqual(m.campaign.name, 'Вестфалия');

  const dd = path.join(root, 'restored');
  const t = archive.targetsUnder(m, dd);
  const res = archive.extractTo(dest, m, archive.mappingOf(m, t));
  assert.ok(res.files >= 6);
  assert.strictEqual(fs.readFileSync(path.join(dd, 'scenes', 'a.scene.json'), 'utf8'), '{"map":"a","tokens":[],"fog":"1"}');
  assert.ok(fs.existsSync(path.join(dd, 'library.tokens.json')));
  assert.ok(fs.existsSync(path.join(dd, 'kv.json')));
  assert.ok(!fs.existsSync(path.join(dd, 'thumbs')));
  assert.deepStrictEqual([...fs.readFileSync(path.join(dd, 'maps', 'a.png'))], [1, 2, 3, 4, 5]);
  assert.strictEqual(fs.readFileSync(path.join(dd, 'media', 'm1', 'Орк.png')).length, 3000);
  assert.ok(!fs.existsSync(path.join(dd, 'media', 'm1', 'sub')));
});

test('импорт без галочек: карты не распаковываются; чужой формат отклоняется', () => {
  const root = tmpDir('ng');
  const c = sampleCampaign(root);
  const dest = path.join(root, 'camp.udbm');
  archive.exportTo(dest, c, {}, '1');
  const m = archive.readManifest(dest);
  const dd = path.join(root, 'r');
  archive.extractTo(dest, m, archive.mappingOf(m, archive.targetsUnder(m, dd)));
  assert.ok(fs.existsSync(path.join(dd, 'scenes', 'a.scene.json')));
  assert.ok(!fs.existsSync(path.join(dd, 'maps')));

  const bad = path.join(root, 'bad.udbm');
  fs.writeFileSync(bad, 'это не zip');
  assert.throws(() => archive.readManifest(bad), /ARCHIVE_NOT_UDBM/);
  const { zipSync, strToU8 } = require('fflate');
  const future = path.join(root, 'future.udbm');
  fs.writeFileSync(future, zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'udbm/7', campaign: { name: 'x', folders: {}, media: [] } })) }));
  assert.throws(() => archive.readManifest(future), /ARCHIVE_FORMAT:udbm\/7/);
});

test('zip-slip: запись с .. в имени не распаковывается за пределы', () => {
  const root = tmpDir('zs');
  const { zipSync, strToU8 } = require('fflate');
  const mf = { format: 'udbm/1', include: {}, campaign: { name: 'x', folders: { data: 'data' }, media: [] } };
  const f = path.join(root, 'evil.udbm');
  fs.writeFileSync(f, zipSync({ 'manifest.json': strToU8(JSON.stringify(mf)), 'data/../../pwned.txt': strToU8('x') }));
  const dd = path.join(root, 'dd');
  const m = archive.readManifest(f);
  assert.throws(() => archive.extractTo(f, m, archive.mappingOf(m, archive.targetsUnder(m, dd))), /BAD_PATH/);
  assert.ok(!fs.existsSync(path.join(root, 'pwned.txt')));
});

test('scrubHome: путь пользователя -> <HOME> во всех написаниях', () => {
  const home = 'C:\\Users\\Иван';
  const text = [
    'open C:\\Users\\Иван\\Documents\\x.json',
    'json "C:\\\\Users\\\\Иван\\\\AppData"',
    'url c:/users/иван/maps/a.png',
    'other C:\\Users\\Петр\\x',
  ].join('\n');
  const out = lu.scrubHome(text, [home]);
  assert.ok(!/Иван/i.test(out), out);
  assert.strictEqual(out.split('<HOME>').length - 1, 3);
  assert.ok(out.includes('C:\\Users\\Петр'));
  assert.strictEqual(lu.scrubHome('нет пути', ['C:\\Users\\Иван']), 'нет пути');
  assert.strictEqual(lu.scrubHome('x', []), 'x');
});

test('ротация логов: main.log -> main.1.log -> main.2.log, старейший удаляется', () => {
  const dir = tmpDir('lg');
  const p = path.join(dir, 'main.log');
  fs.writeFileSync(p, 'A');
  lu.rotate(p, 3);
  fs.writeFileSync(p, 'B'); lu.rotate(p, 3);
  fs.writeFileSync(p, 'C'); lu.rotate(p, 3);
  fs.writeFileSync(p, 'D');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.1.log'), 'utf8'), 'C');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.2.log'), 'utf8'), 'B');
  assert.ok(!fs.existsSync(path.join(dir, 'main.3.log')));
  assert.deepStrictEqual(lu.listLogFiles(dir), ['main.1.log', 'main.2.log', 'main.log']);
});

test('отчёт: логи + описание + версии, путь пользователя заменён, сцен нет', () => {
  const dir = tmpDir('rp');
  const home = 'C:\\Users\\Иван';
  fs.writeFileSync(path.join(dir, 'main.log'), 'error at C:\\Users\\Иван\\Documents\\camp\\x.json\n');
  fs.writeFileSync(path.join(dir, 'other.scene.json'), '{"secret":1}');
  const z = report.build({ logDir: dir, description: 'сломалось в C:\\Users\\Иван\\Desktop', info: { app: '1.0', path: 'C:\\Users\\Иван' }, homeDirs: [home] });
  const files = unzipSync(z);
  assert.deepStrictEqual(Object.keys(files).sort(), ['description.txt', 'logs/main.log', 'versions.json']);
  for (const [n, d] of Object.entries(files)) assert.ok(!/Иван/.test(strFromU8(d)), n);
  assert.ok(strFromU8(files['logs/main.log']).includes('<HOME>\\Documents'));
  assert.strictEqual(JSON.parse(strFromU8(files['versions.json'])).app, '1.0');
});
