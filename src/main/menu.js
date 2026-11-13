'use strict';
const { Menu } = require('electron');
const windows = require('./windows');
const logger = require('./log');
const { t } = require('./i18n');

function send(action) {
  const w = windows.getGmWindow();
  if (w && !w.isDestroyed()) w.webContents.send('menu:action', action);
}

function about() { windows.openAbout(); }

function build() {
  const template = [
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.file.importMap'), click: () => send('import-map') },
        { label: t('menu.file.newMap'), click: () => windows.openEditor({ newFromImage: true }) },
        { label: t('menu.file.editMap'), click: () => send('edit-current-map') },
        { type: 'separator' },
        { label: t('menu.file.campaigns'), click: () => send('campaigns') },
        { label: t('menu.file.settings'), click: () => send('settings') },
        { label: t('menu.file.wizard'), click: () => send('wizard') },
        { type: 'separator' },
        { label: t('menu.file.quit'), role: 'quit' },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.view.fullscreen'), role: 'togglefullscreen' },
        { label: t('menu.view.reload'), role: 'reload' },
        { label: t('menu.view.devtools'), role: 'toggleDevTools' },
      ],
    },
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.help.report'), click: () => send('report') },
        { label: t('menu.help.logs'), click: () => { logger.openFolder().catch(() => {}); } },
        { label: t('menu.help.about'), click: about },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { build };
