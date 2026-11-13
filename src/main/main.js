'use strict';
const { app, BrowserWindow, session } = require('electron');
const smoke = require('./smoke');
smoke.early();          // до init логов: smoke подменяет userData
const logger = require('./log');
logger.init();
const protocol = require('./protocol');
const ipc = require('./ipc');
const windows = require('./windows');
const menu = require('./menu');
const kv = require('./kv');
const watcher = require('./watcher');
const updater = require('./updater');

protocol.registerSchemes();

// Права для устройств вывода звука (enumerateDevices отдаёт названия только при разрешении media): только для страниц app://, остальное — отказ.
const AUDIO_PERMS = new Set(['media', 'speaker-selection']);
const isAppOrigin = (o) => { try { return new URL(o).protocol === 'app:'; } catch (_) { return false; } };
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_wc, permission, origin) => AUDIO_PERMS.has(permission) && isAppOrigin(origin));
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(AUDIO_PERMS.has(permission) && isAppOrigin((details && details.requestingUrl) || '')));
}

if (!smoke.enabled && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = windows.getGmWindow();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    protocol.registerHandlers();
    setupPermissions();
    ipc.register();
    menu.build();
    windows.watchDisplays();
    watcher.start();
    if (!smoke.enabled) updater.start();
    if (smoke.enabled) smoke.run(windows, require('./campaigns'));
    else windows.createGmWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windows.createGmWindow();
    });
  }).catch((e) => logger.log.error('startup failed', e));
  app.on('before-quit', () => { kv.flushAll(); watcher.stop(); updater.stop(); });
  app.on('window-all-closed', () => app.quit());
}
