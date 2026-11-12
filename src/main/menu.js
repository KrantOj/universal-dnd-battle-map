'use strict';
const { Menu, app, dialog } = require('electron');
const windows = require('./windows');
const logger = require('./log');

function send(action) {
  const w = windows.getGmWindow();
  if (w && !w.isDestroyed()) w.webContents.send('menu:action', action);
}

function about() {
  const w = windows.getGmWindow();
  dialog.showMessageBox(w || undefined, {
    type: 'info',
    title: 'О программе',
    message: 'Universal DnD Battle map',
    detail: `Версия ${app.getVersion()}\nElectron ${process.versions.electron}`,
    buttons: ['OK'],
  });
}

function build() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Импорт карты…', click: () => send('import-map') },
        { type: 'separator' },
        { label: 'Кампании…', click: () => send('campaigns') },
        { label: 'Кампания: настройки', click: () => send('settings') },
        { label: 'Мастер первого запуска', click: () => send('wizard') },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Полный экран', role: 'togglefullscreen' },
        { label: 'Перезагрузить', role: 'reload' },
        { label: 'Инструменты разработчика', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'Папка логов', click: () => { logger.openFolder().catch(() => {}); } },
        { label: 'О программе', click: about },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { build };
