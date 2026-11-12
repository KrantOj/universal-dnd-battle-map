'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
});
