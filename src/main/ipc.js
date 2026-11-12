'use strict';
const { app, ipcMain } = require('electron');

function register() {
  ipcMain.handle('app:version', () => app.getVersion());
}

module.exports = { register };
