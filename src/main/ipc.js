'use strict';
const fs = require('fs');
const { app, ipcMain, dialog, shell, BrowserWindow } = require('electron');
const settings = require('./settings');
const campaigns = require('./campaigns');
const kv = require('./kv');
const fsapi = require('./fsapi');
const scenes = require('./scenes');
const windows = require('./windows');
const logger = require('./log');
const transfer = require('./transfer');
const report = require('./report');
const smoke = require('./smoke');

const allowedSaves = new Set(); // paths returned by dialog.saveFile, consumable by fs.writeAbs once

function parentOf(e) { return BrowserWindow.fromWebContents(e.sender) || undefined; }

function takeSave(p) { if (!allowedSaves.delete(p)) throw new Error('PATH_NOT_ALLOWED'); }
function labelOf(wc) {
  const g = windows.getGmWindow(), p = windows.getPlayerWindow();
  return g && !g.isDestroyed() && g.webContents === wc ? 'gm' : (p && !p.isDestroyed() && p.webContents === wc ? 'player' : 'window');
}

function register() {
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));

  h('app:version', () => app.getVersion());
  h('app:platformInfo', () => ({ version: app.getVersion(), electron: process.versions.electron, os: `${process.platform} ${process.getSystemVersion ? process.getSystemVersion() : ''}`.trim() }));
  h('app:defaultDataDir', (e, n) => campaigns.defaultDataDir(n));
  h('app:showWizard', () => windows.showWizard());
  h('app:showGm', () => windows.showGm());

  h('settings:get', () => settings.get());
  h('settings:set', (e, p) => settings.set(p));

  h('campaigns:list', () => campaigns.list());
  h('campaigns:current', () => campaigns.current());
  h('campaigns:create', (e, p) => campaigns.create(p));
  h('campaigns:update', (e, id, p) => campaigns.update(id, p));
  h('campaigns:switch', (e, id) => campaigns.switchTo(id));
  h('campaigns:remove', (e, id, o) => campaigns.remove(id, o));
  h('campaigns:duplicate', (e, id) => campaigns.duplicate(id));
  h('campaigns:inspectDataDir', (e, dir) => require('./datafiles').inspect(String(dir || '')));
  h('campaigns:relocateData', (e, id, dir, o) => {
    const old = (campaigns.get(id) || {}).folders;
    kv.flushAll();
    const r = campaigns.relocateData(id, dir, { move: !!(o && o.move), conflict: o && o.conflict });
    if (old && old.data) kv.invalidate(old.data);
    return r;
  });
  campaigns.bus.on('data-removed', (d) => kv.invalidate(d));

  h('archive:estimate', (e, inc) => transfer.estimate(inc));
  h('archive:export', (e, dest, inc) => { takeSave(dest); return transfer.exportCurrent(dest, inc); });
  h('archive:inspect', (e, file) => transfer.inspect(file));
  h('archive:import', (e, file, o) => transfer.importFile(file, o));

  h('report:collect', (e, dest, description) => {
    takeSave(dest);
    const v = process.versions;
    const zip = report.build({ logDir: logger.logDir(), description, info: {
      app: app.getVersion(), electron: v.electron, chrome: v.chrome, node: v.node,
      os: `${process.platform} ${process.getSystemVersion ? process.getSystemVersion() : ''}`.trim(), arch: process.arch, locale: app.getLocale(), created: new Date().toISOString(),
    } });
    fs.writeFileSync(dest, Buffer.from(zip));
    shell.showItemInFolder(dest);
    return dest;
  });
  h('report:openIssues', () => shell.openExternal(report.ISSUES_URL));
  campaigns.bus.on('changed', (c) => windows.broadcast('campaigns:changed', c));

  h('kv:get', (e, k) => kv.get(k));
  h('kv:set', (e, k, v) => kv.set(k, v));

  h('dialog:pickFolder', async (e, o = {}) => {
    if (smoke.enabled && smoke.pickQueue.length) return smoke.pickQueue.shift();   // smoke: подготовленные пути вместо системного диалога
    const r = await dialog.showOpenDialog(parentOf(e), { title: o.title, defaultPath: o.defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  h('dialog:pickFiles', async (e, o = {}) => {
    const r = await dialog.showOpenDialog(parentOf(e), { title: o.title, filters: o.filters, properties: o.multi ? ['openFile', 'multiSelections'] : ['openFile'] });
    return r.canceled ? [] : r.filePaths;
  });
  h('dialog:saveFile', async (e, o = {}) => {
    const r = await dialog.showSaveDialog(parentOf(e), { title: o.title, defaultPath: o.defaultName, filters: o.filters });
    if (r.canceled || !r.filePath) return null;
    allowedSaves.add(r.filePath);
    return r.filePath;
  });

  h('fs:list', (e, root, rel, o) => fsapi.list(root, rel, o));
  h('fs:exists', (e, root, rel) => fsapi.exists(root, rel));
  h('fs:readText', (e, root, rel) => fsapi.readText(root, rel));
  h('fs:readBinary', (e, root, rel) => fsapi.readBinary(root, rel));
  h('fs:writeText', (e, root, rel, t, o) => fsapi.writeText(root, rel, t, o));
  h('fs:writeBinary', (e, root, rel, d) => fsapi.writeBinary(root, rel, d));
  h('fs:remove', (e, root, rel) => fsapi.remove(root, rel));
  h('fs:importFiles', (e, paths, root, relDir) => fsapi.importFiles(paths, root, relDir));
  h('fs:writeAbs', (e, p, text) => {
    if (!allowedSaves.delete(p)) throw new Error('PATH_NOT_ALLOWED');
    fs.writeFileSync(p, String(text), 'utf8');
  });

  h('scenes:load', (e, id) => scenes.load(id));
  h('scenes:save', (e, s) => scenes.save(s));
  h('scenes:list', () => scenes.list());
  h('scenes:remove', (e, id) => scenes.remove(id));

  h('windows:openPlayer', () => windows.openPlayer());
  h('windows:closePlayer', () => windows.closePlayer());
  h('windows:isPlayerOpen', () => windows.isPlayerOpen());
  h('windows:togglePlayerFullscreen', () => windows.togglePlayerFullscreen());

  ipcMain.on('sync:send', (e, msg) => windows.relay(e.sender, msg));
  h('log:openFolder', () => logger.openFolder());
  ipcMain.on('log:report', (e, rec) => { try { logger.fromRenderer(labelOf(e.sender), rec); } catch (_) {} });
}

module.exports = { register };
