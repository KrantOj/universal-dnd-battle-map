'use strict';
// Чистая логика обновлений (без electron) — решения «что делать» и сравнение версий. Тесты: tests/update-logic.test.js.

const REPO = 'KrantOj/universal-dnd-battle-map';
const REPO_URL = `https://github.com/${REPO}`;
const RELEASES_URL = `${REPO_URL}/releases`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_FIRST_MS = 10 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// только «настоящие» версии приложения: X.Y.Z без пререлизных суффиксов (тег extras-tokens-1 и т.п. сюда не проходит)
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(v) {
  const m = STABLE.exec(String(v == null ? '' : v).trim().replace(/^v/i, ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isStable(v) { return !!parse(v); }

/** -1 / 0 / 1; null, если любая из версий не X.Y.Z. */
function compareVersions(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function isNewer(remote, current) { return compareVersions(remote, current) === 1; }

/** 'nsis' (установленная), 'portable', 'dev' (не упакована — не обновляем). */
function detectMode({ portableDir, isPackaged }) {
  if (portableDir) return 'portable';
  return isPackaged ? 'nsis' : 'dev';
}

/** Что делать при проверке: 'install' (скачать и поставить), 'notify' (только сообщить), 'off'. manual — нажата кнопка «Проверить». */
function decide({ mode, enabled, manual }) {
  if (mode === 'dev') return 'off';
  if (!enabled && !manual) return 'off';
  return mode === 'portable' ? 'notify' : 'install';
}

/** Ответ GitHub API /releases/latest -> {version, url} или null, если это не релиз приложения.
 *  Релиз приложения: не draft/prerelease, тег vX.Y.Z, среди файлов есть latest.yml. */
function parseLatestRelease(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.draft || json.prerelease) return null;
  const tag = String(json.tag_name || '');
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) return null;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  if (!assets.some((a) => a && a.name === 'latest.yml')) return null;
  return { version: tag.slice(1), url: `${RELEASES_URL}/tag/${tag}` };
}

module.exports = { REPO, REPO_URL, RELEASES_URL, API_LATEST, CHECK_FIRST_MS, CHECK_EVERY_MS, parse, isStable, compareVersions, isNewer, detectMode, decide, parseLatestRelease };
