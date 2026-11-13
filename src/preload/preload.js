'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Strip Electron's "Error invoking remote method 'x': Error: " prefix so messages match the contract.
const inv = (ch, ...args) => ipcRenderer.invoke(ch, ...args).catch((e) => {
  const m = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
  throw new Error(m);
});

const sub = (ch, cb) => {
  const fn = (_e, ...a) => cb(...a);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

const toAB = (u8) => {
  const v = u8 instanceof ArrayBuffer ? new Uint8Array(u8) : u8;
  return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
};

contextBridge.exposeInMainWorld('host', {
  app: {
    version: () => inv('app:version'),
    platformInfo: () => inv('app:platformInfo'),
    defaultDataDir: (name) => inv('app:defaultDataDir', name),
    showWizard: () => inv('app:showWizard'),
    showGm: () => inv('app:showGm'),
  },
  settings: {
    get: () => inv('settings:get'),
    set: (p) => inv('settings:set', p),
  },
  campaigns: {
    list: () => inv('campaigns:list'),
    current: () => inv('campaigns:current'),
    create: (p) => inv('campaigns:create', p),
    update: (id, p) => inv('campaigns:update', id, p),
    switch: (id) => inv('campaigns:switch', id),
    remove: (id, o) => inv('campaigns:remove', id, o),
    duplicate: (id) => inv('campaigns:duplicate', id),
    inspectDataDir: (dir) => inv('campaigns:inspectDataDir', dir),
    relocateData: (id, dir, o) => inv('campaigns:relocateData', id, dir, o),
    onChanged: (cb) => sub('campaigns:changed', cb),
  },
  archive: {
    estimate: (include) => inv('archive:estimate', include),
    export: (dest, include) => inv('archive:export', dest, include),
    inspect: (file) => inv('archive:inspect', file),
    import: (file, o) => inv('archive:import', file, o),
  },
  watch: {
    onChange: (cb) => sub('watch:change', cb),
  },
  report: {
    collect: (dest, description) => inv('report:collect', dest, description),
    openIssues: () => inv('report:openIssues'),
  },
  kv: {
    get: (k) => inv('kv:get', k),
    set: (k, v) => inv('kv:set', k, v),
  },
  dialog: {
    pickFolder: (o) => inv('dialog:pickFolder', o),
    pickFiles: (o) => inv('dialog:pickFiles', o),
    saveFile: (o) => inv('dialog:saveFile', o),
  },
  fs: {
    list: (root, rel = '', o) => inv('fs:list', root, rel, o),
    exists: (root, rel) => inv('fs:exists', root, rel),
    readText: (root, rel) => inv('fs:readText', root, rel),
    readBinary: async (root, rel) => toAB(await inv('fs:readBinary', root, rel)),
    writeText: (root, rel, text, o) => inv('fs:writeText', root, rel, text, o),
    writeBinary: (root, rel, data) => inv('fs:writeBinary', root, rel, data),
    remove: (root, rel) => inv('fs:remove', root, rel),
    importFiles: (paths, root, relDir = '') => inv('fs:importFiles', paths, root, relDir),
    writeAbs: (p, text) => inv('fs:writeAbs', p, text),
    url: (root, rel = '') => `userfile://r/${encodeURIComponent(root)}/${String(rel).split('/').filter(Boolean).map(encodeURIComponent).join('/')}`,
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  scenes: {
    load: (id) => inv('scenes:load', id),
    save: (s) => inv('scenes:save', s),
    list: () => inv('scenes:list'),
    remove: (id) => inv('scenes:remove', id),
  },
  windows: {
    openPlayer: () => inv('windows:openPlayer'),
    closePlayer: () => inv('windows:closePlayer'),
    isPlayerOpen: () => inv('windows:isPlayerOpen'),
    onPlayerState: (cb) => sub('windows:playerState', cb),
    togglePlayerFullscreen: () => inv('windows:togglePlayerFullscreen'),
  },
  editor: {
    open: (req) => inv('editor:open', req),
    takeRequest: () => inv('editor:takeRequest'),
    onRequest: (cb) => sub('editor:request', cb),
    openInGm: (rel) => inv('editor:openInGm', rel),
    onOpenMap: (cb) => sub('editor:openMap', cb),
    setDirty: (v) => { try { ipcRenderer.send('editor:dirty', !!v); } catch (_) { /* ignore */ } },
    onConfirmClose: (cb) => sub('editor:confirmClose', cb),
    onLangChanged: (cb) => sub('app:langChanged', cb),
    forceClose: () => inv('editor:forceClose'),
  },
  sync: {
    send: (msg) => ipcRenderer.send('sync:send', msg),
    onMessage: (cb) => sub('sync:message', cb),
  },
  menu: {
    onAction: (cb) => sub('menu:action', cb),
  },
  log: {
    openFolder: () => inv('log:openFolder'),
    report: (rec) => { try { ipcRenderer.send('log:report', rec); } catch (_) { /* ignore */ } },
  },
});
