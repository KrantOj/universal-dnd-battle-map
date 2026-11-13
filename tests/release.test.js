'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { changelogSection, releaseFiles } = require('../scripts/release');

const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('CHANGELOG: раздел текущей версии есть, содержит RU и EN', () => {
  const s = changelogSection(text, pkg.version);
  assert.ok(s && s.includes('**RU**') && s.includes('**EN**'));
});

test('CHANGELOG: разделы не смешиваются, неизвестная версия -> null', () => {
  const a = changelogSection(text, '0.5.0');
  assert.ok(a && !a.includes('1.0.0') && !a.includes('0.4.0') && !a.includes('Музыка'));
  assert.strictEqual(changelogSection(text, '9.9.9'), null);
  assert.strictEqual(changelogSection('## [1.0.0] - x\n\nтекст\n## [1.0.1] - y\nдругое', '1.0.0'), 'текст');
  assert.strictEqual(changelogSection('## [1.0.10] - x\nтекст', '1.0.1'), null);
});

test('имена файлов релиза совпадают с artifactName из electron-builder.yml', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');
  const f = releaseFiles('1.2.3', ['a.exe.blockmap', 'x']);
  assert.deepStrictEqual(f, ['Universal-DnD-Battle-map-Setup-1.2.3.exe', 'Universal-DnD-Battle-map-1.2.3-portable.exe', 'latest.yml', 'a.exe.blockmap']);
  assert.ok(yml.includes('artifactName: "Universal-DnD-Battle-map-Setup-${version}.exe"'));
  assert.ok(yml.includes('artifactName: "Universal-DnD-Battle-map-${version}-portable.exe"'));
});
