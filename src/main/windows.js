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
function loadGmState() {
  const s = store.readJson(stateFile(), null);
  const opts = { width: 1280, height: 800 };
  if (!s || !s.gm) return { opts, maximized: false };
  const g = s.gm;
  if (Number.isFinite(g.width) && Number.isFinite(g.height)) {
    opts.width = Math.max(800, g.width); opts.height = Math.max(500, g.height);
  }
  if (Number.isFinite(g.x) && Number.isFinite(g.y) && intersectsDisplay({ x: g.x, y: g.y, width: opts.width, height: opts.height })) {
    opts.x = g.x; opts.y = g.y;
  }
  return { opts, maximized: !!g.maximized };
}
function saveGmState(win) {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  const prev = store.readJson(stateFile(), {}) || {};
  const nb = win.getNormalBounds();
  prev.gm = { x: nb.x, y: nb.y, width: nb.width, height: nb.height, maximized: win.isMaximized() };
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
  createGmWindow, getGmWindow, getPlayerWindow, showWizard, showGm,
  openPlayer, closePlayer, isPlayerOpen, togglePlayerFullscreen, watchDisplays, relay, broadcast, emitPlayerState,
};
