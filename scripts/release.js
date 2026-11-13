'use strict';
// Выпуск релиза: `npm run release`.
//   1) проверки: чистое дерево git, ветка main, тег vX.Y.Z (X.Y.Z из package.json) ещё не существует, раздел в CHANGELOG.md есть;
//   2) сборка `electron-builder --win --publish never` (установщик, portable, latest.yml, blockmap);
//   3) печатает точную команду `gh release create ...`.
// Саму публикацию делает только `npm run release -- --publish` (нужен вход `gh auth login`; токен в репозитории не хранится).
// Остальные флаги: --skip-build (не пересобирать, взять готовое из dist/), --check (только проверки, без сборки).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/** Текст раздела `## [X.Y.Z]...` из CHANGELOG.md (до следующего `## [`), или null. */
function changelogSection(text, version) {
  const lines = String(text).split(/\r?\n/);
  const head = (l) => /^##\s+\[/.test(l);
  const start = lines.findIndex((l) => head(l) && l.replace(/^##\s+\[/, '').startsWith(version + ']'));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (head(lines[i])) { end = i; break; }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

/** Имена файлов релиза для версии: [установщик, portable, latest.yml, ...blockmap]. */
function releaseFiles(version, names) {
  const setup = `Universal-DnD-Battle-map-Setup-${version}.exe`;
  const portable = `Universal-DnD-Battle-map-${version}-portable.exe`;
  const maps = names.filter((n) => n.endsWith('.blockmap'));
  return [setup, portable, 'latest.yml', ...maps];
}

function run(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({ cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npx' }, opts));
}
function out(cmd, args) { const r = run(cmd, args); return { ok: r.status === 0, text: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; }
function fail(msg) { console.error('\nОШИБКА: ' + msg); process.exit(1); }
const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

function main() {
  const argv = process.argv.slice(2);
  const publish = argv.includes('--publish');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = 'v' + version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`версия «${version}» в package.json не X.Y.Z (пререлизы не выпускаем)`);

  // --- проверки ---
  const st = out('git', ['status', '--porcelain']);
  if (!st.ok) fail('git status не сработал: ' + st.err);
  if (st.text) fail('в рабочем дереве есть незакоммиченные изменения:\n' + st.text);
  const br = out('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (br.text !== 'main') fail(`релиз выпускается с ветки main, сейчас «${br.text}»`);
  if (out('git', ['tag', '-l', tag]).text) fail(`тег ${tag} уже существует локально`);
  const remote = out('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remote.ok && remote.text) fail(`тег ${tag} уже есть на GitHub`);
  if (!remote.ok) console.warn('Предупреждение: не удалось проверить теги на GitHub (нет сети?): ' + remote.err);
  const notesText = changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!notesText) fail(`в CHANGELOG.md нет раздела «## [${version}]»`);
  console.log(`Проверки пройдены: ветка main, дерево чистое, тег ${tag} свободен, раздел CHANGELOG найден.`);
  if (argv.includes('--check')) return;

  // --- сборка ---
  if (!argv.includes('--skip-build')) {
    console.log('\nСобираем (electron-builder --win --publish never)…');
    const b = run('npx', ['electron-builder', '--win', '--publish', 'never'], { stdio: 'inherit' });
    if (b.status !== 0) fail('сборка не удалась');
  }
  const files = releaseFiles(version, fs.existsSync(DIST) ? fs.readdirSync(DIST) : []);
  for (const f of files) if (!fs.existsSync(path.join(DIST, f))) fail(`в dist/ нет файла ${f}`);
  const yml = fs.readFileSync(path.join(DIST, 'latest.yml'), 'utf8');
  if (!new RegExp(`^version:\\s*${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(yml)) fail('версия в dist/latest.yml не совпадает с package.json (старая сборка?)');
  if (yml.indexOf(files[0]) < 0) fail(`latest.yml не ссылается на ${files[0]}`);

  // --- команда ---
  const notesFile = path.join(os.tmpdir(), `udbm-release-notes-${version}.md`);
  fs.writeFileSync(notesFile, notesText + '\n');
  const ghArgs = ['release', 'create', tag, ...files.map((f) => path.join('dist', f)), '--title', `Universal DnD Battle map ${version}`, '--notes-file', notesFile, '--latest'];
  // --target main: тег создаётся на текущем коммите main (он должен быть запушен)
  ghArgs.push('--target', 'main');
  const printed = 'gh ' + ghArgs.map(quote).join(' ');
  console.log('\nКоманда публикации:\n\n  ' + printed + '\n');
  if (!publish) { console.log('Публикация НЕ выполнена. Чтобы выполнить: npm run release -- --publish'); return; }

  const head = out('git', ['rev-parse', 'HEAD']).text;
  out('git', ['fetch', 'origin', 'main']);
  const originHead = out('git', ['rev-parse', 'origin/main']).text;
  if (head !== originHead) fail('локальный main не совпадает с origin/main — сначала git push (иначе тег встанет не на тот коммит)');
  const exists = out('gh', ['release', 'view', tag]);
  if (exists.ok) fail(`релиз ${tag} уже есть на GitHub`);
  const r = run('gh', ghArgs, { stdio: 'inherit' });
  if (r.status !== 0) fail('gh release create завершился с ошибкой');
  console.log(`\nГотово: https://github.com/KrantOj/universal-dnd-battle-map/releases/tag/${tag}`);
}

if (require.main === module) main();
module.exports = { changelogSection, releaseFiles };
