# HOST-API — contract between main/preload and renderer (stages 1–2)

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
host.campaigns.remove(id, {deleteData:false}) // deleteData also removes the data folder (refused silently if shared with another campaign or it is home/Documents/Desktop/drive root)
host.campaigns.duplicate(id) -> Campaign    // copy of settings: new id, name "<name> (копия)", NEW empty data folder; maps/media/battlelog folders are shared with the source; does NOT become current
host.campaigns.onChanged(cb(campaign))      // (sync) returns unsubscribe; fired after create/update(current)/switch/remove(current). cb gets null when no campaign is left.
                                            // Renderer compares campaign.id with the previous one: different id => tear down the scene and reinitialise (store/media/showcase/blog/watch). A switch must be preceded by flushing pending saves (VTT.gm.flush()), because main switches immediately.

host.archive.estimate({maps,media,battlelog}) -> {bytes, files, parts:{data,maps,media,battlelog}}   // uncompressed size of the CURRENT campaign export
host.archive.export(destPath, {maps,media,battlelog}) -> {path, bytes, files}   // destPath must come from dialog.saveFile (one-shot); writes <name>.udbm
host.archive.inspect(udbmPath) -> {name, app, created, include, media, fileBytes, defaultDataDir}
host.archive.import(udbmPath, {mode:'new', dataDir, name?}) -> Campaign   // extracts under dataDir (maps/, media/<id>/, battlelog/), creates the campaign and makes it current
host.archive.import(udbmPath, {mode:'replace'}) -> Campaign              // overwrites same-named files in the CURRENT campaign (data + included maps/media/logs in its folders); renderer must call VTT.gm.reinit()
   // errors: ARCHIVE_NOT_UDBM, ARCHIVE_FORMAT:<format> (not udbm/1), DATA_DIR_IN_USE, DATA_DIR_REQUIRED, NO_CAMPAIGN

host.watch.onChange(cb({kind:'maps'|'media', root, rels:[rel]}))   // (sync) returns unsubscribe. fs.watch(recursive) on the maps folder and every media folder of the current campaign, debounced 500 ms; rels are root-relative ('/'). Watchers are rebuilt on every campaigns.onChanged.

host.report.collect(destPath, description) -> destPath   // destPath from dialog.saveFile (one-shot). Writes zip: logs/*.log + description.txt + versions.json (no scenes/images; user home path -> <HOME>), then reveals it in Explorer
host.report.openIssues()                                // shell.openExternal('https://github.com/KrantOj/universal-dnd-battle-map/issues') — the only URL main will open

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

host.menu.onAction(cb(action))              // (sync) 'import-map' | 'settings' | 'campaigns' | 'wizard' | 'report'   // open-logs and about are handled in main only (never sent to renderer)
host.log.openFolder()
host.log.report({level:'error'|'warn', message, source})   // fire-and-forget: renderer error -> userData/logs/main.log (used by js/errlog.js for window.onerror, unhandledrejection, console.error)
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
`scenes/*.scene.json`, `library.tokens.json` (may be absent in a new campaign — check `fs.exists` first, a failed `readText` is logged by Electron as an ENOENT stack) (`{format:'vestfalia-tokens/1', tokens:[…]}`), `kv.json`, `thumbs/<hash>.jpg`, `pending-battle.json`.

## Player sync messages added in stage 2
- GM -> player `{t:'reset'}`: campaign switched; player clears map/scene/showcase and shows the splash until the next `map`.

## .udbm (stage 2)
Zip (fflate). `manifest.json` first: `{format:'udbm/1', app, created, include:{maps,media,battlelog}, campaign:{name, folders:{data:'data', maps:'maps'|null, battlelog:'battlelog'|null, music:null}, media:[{id,label,path:'media/<id>'|null,recursive,exclude}], battlelog, playerWindow, prefs}}` — folder paths are replaced by labels, never absolute. Entries: `data/…` (everything in the data folder except `thumbs/` and `*.tmp`), `maps/…`, `media/<id>/…` (images only, respecting recursive/exclude), `battlelog/…`. Major format other than 1 is refused with `ARCHIVE_FORMAT:<format>`; entries are validated against path traversal. Code: `src/main/archive.js` (pure, tested) + `transfer.js`.

## Logging (stage 2)
`userData/logs/main.log`, rotation at 5 MB keeping 3 files (`main.log`, `main.1.log`, `main.2.log`); first line holds app/Electron/Chrome/Node/Windows versions. Main `uncaughtException`/`unhandledRejection` and renderer errors (via `host.log.report`) are written there.
