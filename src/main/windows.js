'use strict';
const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const campaigns = require('./campaigns');
const store = require('./store');
const logger = require('./log');
const { t } = require('./i18n');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const APP = 'app://local/';

let gmWindow = null;
let playerWindow = null;
let editorWindow = null;
let aboutWindow = null;
let editorRequest = null;     // запрос на открытие (карта/новая из картинки), который окно редактора забирает при загрузке
let editorDirty = false;
let editorForceClose = false;

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function secure(win, label) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  logger.attachWebContents(win.webContents, label);
}

function webPrefs() {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

function load(win, page) {
  if (!win || win.isDestroyed()) return Promise.resolve();
  return win.loadURL(APP + page).catch((e) => { logger.log.error(`load ${page} failed: ${e && e.message}`); });
}

// ---------- window state (GM) ----------
function intersectsDisplay(b) {
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    const ix = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const iy = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return ix >= 100 && iy >= 100;
  });
}
function loadGmState(key) {
  key = key || 'gm';
  const s = store.readJson(stateFile(), null);
  const opts = { width: key === 'editor' ? 1360 : 1280, height: 860 };
  if (!s || !s[key]) return { opts, maximized: false };
  const g = s[key];
  if (Number.isFinite(g.width) && Number.isFinite(g.height)) {
    opts.width = Math.max(800, g.width); opts.height = Math.max(500, g.height);
  }
  if (Number.isFinite(g.x) && Number.isFinite(g.y) && intersectsDisplay({ x: g.x, y: g.y, width: opts.width, height: opts.height })) {
    opts.x = g.x; opts.y = g.y;
  }
  return { opts, maximized: !!g.maximized };
}
function saveGmState(win, key) {
  key = key || 'gm';
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  const prev = store.readJson(stateFile(), {}) || {};
  const nb = win.getNormalBounds();
  prev[key] = { x: nb.x, y: nb.y, width: nb.width, height: nb.height, maximized: win.isMaximized() };
  try { store.writeJson(stateFile(), prev); } catch (_) {}
}

// ---------- GM window ----------
function createGmWindow() {
  const st = loadGmState();
  const win = new BrowserWindow(Object.assign({
    backgroundColor: '#111111',
    title: 'Universal DnD Battle map',
    autoHideMenuBar: false,
    show: false,
    webPreferences: webPrefs(),
  }, st.opts));
  gmWindow = win;
  secure(win, 'gm');
  if (st.maximized) win.maximize();
  win.show();
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(() => saveGmState(win), 500); };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', () => { clearTimeout(t); saveGmState(win); });
  win.on('closed', () => {
    gmWindow = null;
    if (playerWindow && !playerWindow.isDestroyed()) playerWindow.destroy();
  });
  win.webContents.on('did-finish-load', onGmLoaded);
  return load(win, campaigns.list().length ? 'gm.html' : 'wizard.html');
}

function onGmLoaded() {
  try {
    const c = campaigns.current();
    if (c && c.playerWindow && c.playerWindow.auto && screen.getAllDisplays().length > 1 && !isPlayerOpen()) openPlayer();
  } catch (e) { logger.log.error('auto-open player failed', e); }
}

// ---------- Editor window ----------
function isEditorOpen() { return !!(editorWindow && !editorWindow.isDestroyed()); }
function getEditorWindow() { return isEditorOpen() ? editorWindow : null; }

/** Открыть/сфокусировать редактор. req: {mapRel?, newFromImage?}. Окно запоминает размер и положение, как окно мастера. */
function openEditor(req) {
  editorRequest = req || null;
  if (isEditorOpen()) {
    if (editorWindow.isMinimized()) editorWindow.restore();
    editorWindow.show(); editorWindow.focus();
    if (editorRequest) { editorWindow.webContents.send('editor:request', editorRequest); editorRequest = null; }
    return;
  }
  const st = loadGmState('editor');
  const win = new BrowserWindow(Object.assign({
    backgroundColor: '#111111', title: t('editor.title'), show: false, webPreferences: webPrefs(),
  }, st.opts));
  editorWindow = win;
  editorDirty = false; editorForceClose = false;
  win.setMenu(null);
  secure(win, 'editor');
  if (st.maximized) win.maximize();
  win.show();
  let tm = null;
  const later = () => { clearTimeout(tm); tm = setTimeout(() => saveGmState(win, 'editor'), 500); };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', (e) => {
    clearTimeout(tm); saveGmState(win, 'editor');
    if (editorDirty && !editorForceClose) { e.preventDefault(); win.webContents.send('editor:confirmClose'); }
  });
  win.on('closed', () => { if (editorWindow === win) editorWindow = null; editorDirty = false; });
  return load(win, 'editor.html');
}
function takeEditorRequest() { const r = editorRequest; editorRequest = null; return r; }
function setEditorDirty(v) { editorDirty = !!v; }
function forceCloseEditor() { editorForceClose = true; if (isEditorOpen()) editorWindow.close(); }
/** «Проверить в бою»: окно мастера выходит вперёд и открывает карту. */
function openInGm(rel) {
  if (!gmWindow || gmWindow.isDestroyed()) return;
  if (gmWindow.isMinimized()) gmWindow.restore();
  gmWindow.show(); gmWindow.focus();
  gmWindow.webContents.send('editor:openMap', String(rel));
}

// ---------- About window ----------
function getAboutWindow() { return aboutWindow && !aboutWindow.isDestroyed() ? aboutWindow : null; }
function openAbout() {
  if (getAboutWindow()) { if (aboutWindow.isMinimized()) aboutWindow.restore(); aboutWindow.show(); aboutWindow.focus(); return; }
  const win = new BrowserWindow({
    width: 540, height: 680, minWidth: 420, minHeight: 480, show: false, backgroundColor: '#111111',
    title: t('about.title'), parent: gmWindow && !gmWindow.isDestroyed() ? gmWindow : undefined,
    minimizable: false, maximizable: false, webPreferences: webPrefs(),
  });
  aboutWindow = win;
  win.setMenu(null);
  secure(win, 'about');
  win.on('closed', () => { if (aboutWindow === win) aboutWindow = null; });
  win.once('ready-to-show', () => win.show());
  return load(win, 'about.html');
}

/** Язык сменился: заголовки окон и перезагрузка страниц (HTML получает новый <html lang>). Мастер уже сбросил состояние на диск. */
function applyLang() {
  if (isEditorOpen()) { editorWindow.setTitle(t('editor.title')); editorWindow.webContents.send('app:langChanged'); }   // редактор сам допишет черновик и перезагрузится
  if (isPlayerOpen()) {
    playerWindow.setTitle(t('player.title'));
    const reloadPlayer = () => { if (isPlayerOpen()) playerWindow.webContents.reload(); };
    if (gmWindow && !gmWindow.isDestroyed()) gmWindow.webContents.once('did-finish-load', () => setTimeout(reloadPlayer, 300));
    else reloadPlayer();
  }
  if (getAboutWindow()) { aboutWindow.setTitle(t('about.title')); aboutWindow.webContents.reload(); }
  if (gmWindow && !gmWindow.isDestroyed()) gmWindow.webContents.reload();
}

function showWizard() { return load(gmWindow, 'wizard.html'); }
function showGm() { return load(gmWindow, 'gm.html'); }
function getGmWindow() { return gmWindow; }
function getPlayerWindow() { return playerWindow; }

// ---------- Player window ----------
function isPlayerOpen() { return !!(playerWindow && !playerWindow.isDestroyed()); }
function emitPlayerState() {
  if (gmWindow && !gmWindow.isDestroyed()) gmWindow.webContents.send('windows:playerState', isPlayerOpen());
}

/** Where should the player window go? -> {target: Display|null, fullscreen} */
function plan() {
  const c = campaigns.current();
  const pw = (c && c.playerWindow) || {};
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  let target = pw.displayId != null ? displays.find((d) => String(d.id) === String(pw.displayId)) : null;
  if (!target) target = displays.find((d) => d.id !== primaryId) || null;
  const nonPrimary = !!target && target.id !== primaryId;
  return { target, fullscreen: pw.fullscreen !== false && nonPrimary };
}

function place(win) {
  const p = plan();
  if (win.isFullScreen()) win.setFullScreen(false);
  if (p.target) {
    const b = p.target.bounds;
    if (p.fullscreen) {
      win.setBounds(b);
      win.setFullScreen(true);
    } else {
      const w = Math.min(1280, b.width), h = Math.min(720, b.height);
      win.setBounds({ x: b.x + Math.round((b.width - w) / 2), y: b.y + Math.round((b.height - h) / 2), width: w, height: h });
    }
  } else {
    const b = screen.getPrimaryDisplay().workArea;
    const w = Math.min(1280, b.width), h = Math.min(720, b.height);
    win.setBounds({ x: b.x + Math.round((b.width - w) / 2), y: b.y + Math.round((b.height - h) / 2), width: w, height: h });
  }
}

function openPlayer() {
  if (isPlayerOpen()) { playerWindow.show(); playerWindow.focus(); return; }
  const win = new BrowserWindow({
    width: 1280, height: 720, show: false, backgroundColor: '#000000',
    title: t('player.title'),
    webPreferences: webPrefs(),
  });
  playerWindow = win;
  win.setMenu(null);
  secure(win, 'player');
  win.on('closed', () => { if (playerWindow === win) playerWindow = null; emitPlayerState(); });
  place(win);
  win.show();
  load(win, 'player.html');
  emitPlayerState();
}

function closePlayer() { if (isPlayerOpen()) playerWindow.close(); }

function togglePlayerFullscreen() {
  if (isPlayerOpen()) playerWindow.setFullScreen(!playerWindow.isFullScreen());
}

let displayTimer = null;
function onDisplaysChanged() {
  clearTimeout(displayTimer);
  displayTimer = setTimeout(() => { if (isPlayerOpen()) place(playerWindow); }, 400);
}
function watchDisplays() {
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
}

// ---------- Sync bridge ----------
function relay(senderWc, msg) {
  const to = (gmWindow && senderWc === gmWindow.webContents) ? playerWindow
    : (playerWindow && senderWc === playerWindow.webContents) ? gmWindow : null;
  if (to && !to.isDestroyed()) to.webContents.send('sync:message', msg);
}

function broadcast(channel, ...args) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}

module.exports = {
  createGmWindow, getGmWindow, openEditor, getEditorWindow, getAboutWindow, openAbout, isEditorOpen, takeEditorRequest, setEditorDirty, forceCloseEditor, openInGm, getPlayerWindow, showWizard, showGm, applyLang,
  openPlayer, closePlayer, isPlayerOpen, togglePlayerFullscreen, watchDisplays, relay, broadcast, emitPlayerState,
};
