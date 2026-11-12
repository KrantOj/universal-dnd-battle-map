'use strict';
const { app, BrowserWindow } = require('electron');
const logger = require('./log');
logger.init();
const protocol = require('./protocol');
const ipc = require('./ipc');
const windows = require('./windows');
const menu = require('./menu');
const kv = require('./kv');

const smoke = require('./smoke');
smoke.early();
protocol.registerSchemes();

if (!smoke.enabled && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = windows.getGmWindow();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    protocol.registerHandlers();
    ipc.register();
    menu.build();
    windows.watchDisplays();
    if (smoke.enabled) smoke.run(windows, require('./campaigns'));
    else windows.createGmWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windows.createGmWindow();
    });
  }).catch((e) => logger.log.error('startup failed', e));
  app.on('before-quit', () => kv.flushAll());
  app.on('window-all-closed', () => app.quit());
}
