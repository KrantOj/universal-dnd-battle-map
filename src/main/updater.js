'use strict';
// Автообновление. Установленная версия (NSIS): electron-updater (скачивает в фоне, ставит по «Установить и перезапустить»).
// Portable: ничего не ставим — спрашиваем GitHub API, есть ли релиз новее, и показываем ссылку на страницу релиза.
// Ошибки (нет сети, нет релизов, 404) — только в лог, без сообщений в интерфейсе (кроме ручной проверки из «О программе»).
const { app, net } = require('electron');
const logger = require('./log');
const settings = require('./settings');
const windows = require('./windows');
const kv = require('./kv');
const L = require('./update-logic');

const state = { mode: 'dev', status: 'idle', version: null, progress: 0, url: null, current: null };
let timer = null, firstTimer = null, au = null, busy = false, manualNow = false;

const enabled = () => settings.get().checkUpdates !== false;
function publish(patch) {
  Object.assign(state, patch);
  windows.broadcast('update:state', getState());
}
function getState() { return Object.assign({}, state); }

function autoUpdater() {
  if (au) return au;
  au = require('electron-updater').autoUpdater;
  au.logger = logger.log;
  au.autoDownload = false;          // качаем сами — только после проверки, что это настоящая новая версия приложения
  au.autoInstallOnAppQuit = true;
  au.allowPrerelease = false;       // пререлизы и «чужие» релизы (extras-*) не предлагаем никогда
  au.allowDowngrade = false;
  au.on('download-progress', (p) => publish({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  au.on('update-downloaded', (info) => publish({ status: 'downloaded', version: info.version, progress: 100 }));
  au.on('error', (e) => { logger.log.warn('updater error: ' + (e && e.message)); });
  return au;
}

async function checkNsis() {
  const u = autoUpdater();
  const r = await u.checkForUpdates();
  const info = r && r.updateInfo;
  if (!info || !L.isStable(info.version) || !L.isNewer(info.version, app.getVersion())) return 'uptodate';
  if (state.status === 'downloading' || state.status === 'downloaded') return 'busy';
  publish({ status: 'downloading', version: info.version, progress: 0, url: `${L.RELEASES_URL}/tag/v${info.version}` });
  u.downloadUpdate().catch((e) => { logger.log.warn('update download failed: ' + (e && e.message)); publish({ status: 'idle', version: null }); });
  return 'available';
}

function getJson(url) {
  return net.fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'universal-dnd-battle-map' } })
    .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
}
async function checkPortable() {
  const rel = L.parseLatestRelease(await getJson(L.API_LATEST));
  if (!rel || !L.isNewer(rel.version, app.getVersion())) return 'uptodate';
  publish({ status: 'available', version: rel.version, url: rel.url });
  return 'available';
}

/** manual — по кнопке «Проверить обновления». Возвращает 'uptodate' | 'available' | 'busy' | 'error' | 'off'. */
async function check(manual) {
  const action = L.decide({ mode: state.mode, enabled: enabled(), manual: !!manual });
  if (action === 'off') return 'off';
  if (busy) return 'busy';
  if (state.status === 'downloading' || state.status === 'downloaded' || state.status === 'available') return 'available';
  busy = true; manualNow = !!manual;
  if (manual) publish({ status: 'checking' });
  try {
    const r = action === 'install' ? await checkNsis() : await checkPortable();
    if (state.status === 'checking') publish({ status: 'idle' });
    return r;
  } catch (e) {
    logger.log.info('update check failed: ' + (e && e.message));
    if (state.status === 'checking') publish({ status: manual ? 'error' : 'idle' });
    return 'error';
  } finally { busy = false; manualNow = false; }
}

/** Установить скачанное. Перед выходом сбрасываем kv на диск (сцену мастер уже сбросил из окна). */
function install() {
  if (state.mode !== 'nsis' || state.status !== 'downloaded') return false;
  try { kv.flushAll(); } catch (_) { /* ignore */ }
  setImmediate(() => { try { autoUpdater().quitAndInstall(false, true); } catch (e) { logger.log.error('quitAndInstall failed', e); } });
  return true;
}

function start() {
  state.current = app.getVersion();
  state.mode = L.detectMode({ portableDir: process.env.PORTABLE_EXECUTABLE_DIR, isPackaged: app.isPackaged });
  logger.log.info(`updater: mode=${state.mode}, enabled=${enabled()}`);
  if (state.mode === 'dev') return;
  firstTimer = setTimeout(() => { check(false); }, L.CHECK_FIRST_MS);
  timer = setInterval(() => { check(false); }, L.CHECK_EVERY_MS);
  if (firstTimer.unref) firstTimer.unref();
  if (timer.unref) timer.unref();
}
function stop() { clearTimeout(firstTimer); clearInterval(timer); }
/** Настройка «Проверять обновления» изменилась: включили — проверяем сразу. */
function onSettingsChanged() { if (enabled() && state.mode !== 'dev') setTimeout(() => { check(false); }, 1000); }

module.exports = { start, stop, check, install, getState, onSettingsChanged };
