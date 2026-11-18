'use strict';
const { Menu, app } = require('electron');
const windows = require('./windows');
const logger = require('./log');
const { t } = require('./i18n');

function send(action) {
  const w = windows.getGmWindow();
  if (w && !w.isDestroyed()) w.webContents.send('menu:action', action);
}

function about() { windows.openAbout(); }

function build() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: t('menu.help.about'), click: about },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
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
        ...(isMac ? [] : [{ type: 'separator' }, { label: t('menu.file.quit'), role: 'quit' }]),
      ],
    },
    // macOS: без стандартного меню «Правка» не работают ⌘C/⌘V/⌘Z в полях ввода
    ...(isMac ? [{ role: 'editMenu' }] : []),
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.view.fullscreen'), accelerator: 'F11', registerAccelerator: false, click: () => windows.toggleFullscreen(null) },
        { label: t('menu.view.reload'), role: 'reload' },
        { label: t('menu.view.devtools'), role: 'toggleDevTools' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.help.report'), click: () => send('report') },
        { label: t('menu.help.logs'), click: () => { logger.openFolder().catch(() => {}); } },
        ...(isMac ? [] : [{ label: t('menu.help.about'), click: about }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { build };
