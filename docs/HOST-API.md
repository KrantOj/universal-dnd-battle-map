# HOST-API — contract between main/preload and renderer (stage 1)

Single source of truth. Main+preload implement it; renderer code uses ONLY `window.host` (no Node, no File System Access API, no IndexedDB, no window.open).
All methods return Promises unless marked (sync). Errors reject with `Error(message)`; a root that is not configured rejects with message `ROOT_NOT_SET:<root>`.

## Roots
File access is always `(root, rel)`; `rel` uses `/`, is relative, never contains `..` (main rejects traversal). Roots resolve against the **current campaign**:
- `data` — campaign data folder (always set): scenes, library, kv, thumbs, pending battle.
- `maps` — battle maps folder (`*.map.json` + images).
- `battlelog` — battle log `.md` folder (may be unset / disabled).
- `media:<id>` — one per entry of `campaign.media`.
- `music` — stage 4.

## API
```js
host.app.version() -> '0.1.0'
host.app.platformInfo() -> {version, electron, os}
host.app.defaultDataDir(name) -> absPath    // default data folder for a campaign name (shown in wizard)
host.app.showWizard()                       // GM window navigates to wizard.html
host.app.showGm()                           // GM window navigates to gm.html

host.settings.get() -> {lang:'ru', currentCampaign:id|null}
host.settings.set(patch) -> settings

host.campaigns.list() -> Campaign[]
host.campaigns.current() -> Campaign|null
host.campaigns.create(partial) -> Campaign  // partial ok (no folders.data -> default dir); fills defaults, makes it current, creates data folder
host.campaigns.update(id, patch) -> Campaign // shallow-merge of folders/battlelog/playerWindow/prefs keys (folders:{maps:null} clears maps); media replaced as whole array
host.campaigns.switch(id) -> Campaign
host.campaigns.remove(id, {deleteData:false})
host.campaigns.onChanged(cb(campaign))      // (sync) returns unsubscribe; fired after update/switch

host.kv.get(key) -> any|null                // per campaign, stored in data/kv.json
host.kv.set(key, value)                     // value JSON-serialisable; null deletes

host.dialog.pickFolder({title, defaultPath}) -> absPath|null
host.dialog.pickFiles({title, filters:[{name, extensions:['json','png']}], multi}) -> absPath[]
host.dialog.saveFile({title, defaultName, filters}) -> absPath|null

host.fs.list(root, rel='', {recursive:false}) -> [{rel, name, size, mtime, isDir}]  // `rel` is relative to the ROOT (not to the listed dir); missing dir -> []
host.fs.exists(root, rel) -> bool
host.fs.readText(root, rel) -> string       // strips UTF-8 BOM
host.fs.readBinary(root, rel) -> ArrayBuffer
host.fs.writeText(root, rel, text, {bom:false}) // creates parent dirs, atomic (tmp + rename)
host.fs.writeBinary(root, rel, ArrayBuffer)
host.fs.remove(root, rel)
host.fs.importFiles(absPaths[], root, relDir='') -> rel[]   // copy external files into root; existing name -> overwrite; rejects `SOURCE_NOT_FOUND:<path>` (before copying anything) if a source is missing
host.fs.writeAbs(absPath, text)             // only for a path just returned by dialog.saveFile
host.fs.url(root, rel) -> 'userfile://r/<encodeURIComponent(root)>/<rel segments encoded>'   (sync, built in preload)
host.fs.pathForFile(file:File) -> absPath   (sync, webUtils.getPathForFile) — for drag&drop

host.scenes.load(mapId) -> Scene|null       // data/scenes/<safe(mapId)>.scene.json
host.scenes.save(scene)                     // key = scene.map
host.scenes.list() -> [mapId]
host.scenes.remove(mapId)

host.windows.openPlayer()                   // creates/focuses player window (player.html)
host.windows.closePlayer()
host.windows.isPlayerOpen() -> bool
host.windows.onPlayerState(cb(open:bool))   // (sync) returns unsubscribe
host.windows.togglePlayerFullscreen()       // called from player window (F / dblclick)

host.sync.send(msg)                         // gm -> player window, or player -> gm window; msg is structured-cloneable plain data (no Blob/File/Image)
host.sync.onMessage(cb(msg))                // (sync) returns unsubscribe

host.menu.onAction(cb(action))              // (sync) 'import-map' | 'settings' | 'campaigns' | 'wizard'   // open-logs and about are handled in main only (never sent to renderer)
host.log.openFolder()
```

`userfile://` protocol is served by main for any root of the current campaign (images, audio). Path traversal → 403.

## Campaign
```js
{ id, name, created, updated,
  folders: { data, maps:null, battlelog:null, music:null },          // absolute paths
  media:   [{ id, label, path, recursive:false, exclude:null /*regex string*/ }],
  battlelog: { enabled:true },
  playerWindow: { auto:true, displayId:null, fullscreen:true },
  prefs: {} }
```
Default `folders.data` = `<Documents>/Universal DnD Battle map/<safe name>`. Stored in `userData/campaigns/<id>.json`. Global settings in `userData/settings.json`.

## Player window
- Opened by `host.windows.openPlayer()`; also automatically after GM page load if `campaign.playerWindow.auto` and a second display exists.
- Placed on `displayId` if it exists, else first non-primary display, else a normal 1280×720 window on primary. Fullscreen if `playerWindow.fullscreen` and it is on a non-primary display.
- On load, player sends `{t:'hello'}` via `host.sync.send`; GM answers with full state (protocol from old ARCHITECTURE §5 "VTT.sync").
- Images go to the player as `userfile://` URLs (never dataURL/Blob): `{t:'map', …, image:<url>}`, `{t:'show', item:{…, url}}`. Token portraits stay dataURL.
- Window positions/sizes of the GM window are saved in `userData/window-state.json`.

## Files in `data`
`scenes/*.scene.json`, `library.tokens.json` (`{format:'vestfalia-tokens/1', tokens:[…]}`), `kv.json`, `thumbs/<hash>.jpg`, `pending-battle.json`.
