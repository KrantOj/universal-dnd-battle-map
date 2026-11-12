'use strict';
const { app, BrowserWindow } = require('electron');
const protocol = require('./protocol');
const ipc = require('./ipc');
const windows = require('./windows');

protocol.registerSchemes();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = windows.getGmWindow();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    protocol.registerHandlers();
    ipc.register();
    windows.createGmWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windows.createGmWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
}
