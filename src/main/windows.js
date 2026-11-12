'use strict';
const { BrowserWindow } = require('electron');
const path = require('path');

let gmWindow = null;

function secure(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createGmWindow() {
  gmWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#111111',
    title: 'Universal DnD Battle map',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  secure(gmWindow);
  gmWindow.on('closed', () => { gmWindow = null; });
  gmWindow.loadURL('app://local/gm.html');
  return gmWindow;
}

function getGmWindow() { return gmWindow; }

module.exports = { createGmWindow, getGmWindow };
