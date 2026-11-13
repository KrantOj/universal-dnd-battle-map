# Universal DnD Battle map — User Guide

Universal DnD Battle map is a tool for D&D 5e game masters: a battle map with a grid, fog of war, doors and tokens on your screen, and a clean player window for a second screen. It also has initiative, hit points, dice, showing images to players, background music and a map editor. Everything works offline.

*Русская версия: [USER-GUIDE.ru.md](USER-GUIDE.ru.md).*

## Contents

1. [Installation](#1-installation)
2. [First run: the wizard](#2-first-run-the-wizard)
3. [Campaigns](#3-campaigns)
4. [Maps: folder and import](#4-maps-folder-and-import)
5. [Map editor](#5-map-editor)
6. [Two screens and the player window](#6-two-screens-and-the-player-window)
7. [Tokens, fog, doors, ruler](#7-tokens-fog-doors-ruler)
8. [Combat: initiative, HP, counters, dice](#8-combat-initiative-hp-counters-dice)
9. [Showcase: images for the players](#9-showcase-images-for-the-players)
10. [Music and the output device](#10-music-and-the-output-device)
11. [Battle log](#11-battle-log)
12. [Exporting and importing a campaign](#12-exporting-and-importing-a-campaign)
13. [Interface language](#13-interface-language)
14. [Report a problem](#14-report-a-problem)
15. [Optional: token library](#15-optional-token-library)
16. [Keyboard shortcuts](#16-keyboard-shortcuts)

---

## 1. Installation

The app is built for Windows (64-bit) in two flavors. Download the one you want from the **Releases** page on GitHub (`KrantOj/universal-dnd-battle-map`):

| Flavor | File | When to choose it |
|---|---|---|
| **Installer (NSIS)** | `Universal-DnD-Battle-map-Setup-<version>.exe` | A normal installation: choose the folder, desktop shortcut, uninstall from "Apps". Recommended. |
| **Portable** | `Universal-DnD-Battle-map-<version>-portable.exe` | No installation: runs from any folder, including a USB stick. Leaves nothing in the system. |

**SmartScreen warning.** The files are not signed with a publisher certificate yet, so Windows may show a blue "Windows protected your PC" window the first time. Click **More info → Run anyway**. This is normal for unsigned software; only download files from the project's Releases page.

App settings and campaign profiles live in your user profile (`%APPDATA%\Universal DnD Battle map`). Scenes, the token library and pins live in each campaign's "data folder" (by default `Documents\Universal DnD Battle map\<campaign name>`). Your maps, images and music stay where they are: the app reads them from the folders you choose and never deletes them.

**Updates.** The installed version checks GitHub for a new release on start and every 6 hours; when one is found it downloads it in the background and shows "Install and restart" (your scene is saved first). The portable version only shows "Version X is available" with a link to the release page. Turn this off in Settings → "Check for updates"; **Help → About** has a manual check.

Uninstalling: use Settings → Apps for the installer version; the portable version is just a file you can delete (campaign data stays in `Documents`).

## 2. First run: the wizard

If there are no campaigns yet, the first-run wizard opens. You can skip every step except the name and the final one ("Skip"); everything can be changed later in Settings.

1. **Language** — Русский or English. The default follows your Windows display language; changing it reloads the page immediately.
2. **Campaign name** — only you see it.
3. **Data folder** — for scenes, the token library and the cache. If you leave it, `Documents\Universal DnD Battle map\<name>` is created. If you pick a folder that already holds other files (for example a notes vault), the app warns you and offers to create a subfolder; it only ever touches its own files.
4. **Maps folder** — where your battle maps live (`*.map.json` and their images).
5. **Showcase categories** — folders of images to show the players: portraits, crests, illustrations. A category can have any name; you can include subfolders.
6. **Music** — a folder with audio; its subfolders become playlists.
7. **Battle log** — whether to keep a log and which folder to save notes (`.md`) to.
8. **Player window** — whether it opens by itself at startup when a second monitor is connected.
9. **Done** — review the summary and click "Create campaign".

You can run the wizard again: **File → First-run wizard** (or "New campaign…" in Settings) creates another campaign.

## 3. Campaigns

A campaign is a set of settings — folders, Showcase categories, music, battle log and player window — plus its own scenes and token library.

**File → Campaigns…** opens the manager: open, rename, duplicate (a copy of the settings), delete, export and import. Deleting removes the profile from the app while your maps, images and logs stay on disk; a separate checkbox also deletes the app's own files in the data folder (scenes, library, pins, thumbnails) — other files in that folder are never touched.

With several campaigns, the app asks which to open at startup. **File → Campaign settings** (or the ⚙ button) opens the settings of the current campaign; changes apply immediately. If you change the data folder, the app offers to move the old data (scenes, library, pins) to the new one.

## 4. Maps: folder and import

A battle map is a `<name>.map.json` file plus a PNG image next to it (the format is described in [MAP-FORMAT.md](MAP-FORMAT.md)). You can make such maps in the editor (section 5) or with outside tools.

- **📂 Maps** lists the maps in the campaign's maps folder. The last opened one is marked "(last used)".
- **⬇ Import map** (or **File → Import map…**) copies the chosen `map.json` and its PNG into the maps folder and opens the map. If the image is not found next to it, the app asks you to pick it.
- You can also simply **drag `*.map.json` and `*.png` files onto the window** — same result.
- If the maps folder is not set, the app offers to choose it on your first import.
- If a map file changes on disk (say you edited it in the editor), a "Map changed on disk" bar appears with a "Reload" button; tokens and fog are preserved.

Every map has its own **scene**: tokens, fog, doors and round. It is saved automatically and restored the next time you open the map.

## 5. Map editor

**✏ Editor** (or **File → New map from image…** / **Open in editor**) opens a separate window where an ordinary image (JPG, PNG, WEBP) becomes a battle map.

1. **New from image…** — pick an image and type a name; the map is created in its own subfolder inside the maps folder (not before the first save). You can also open an existing map (**Open…**).
2. **Grid (G)** — cell size in pixels, offset, number of columns and rows, feet per cell. "Outline a cell" (a frame for one cell; drag the corners) and "N cells horizontally" (mark two points and say how many cells lie between them) help to fit the grid. Arrow keys shift the grid by 1 px (Shift — 10), Ctrl+arrows change the cell size.
3. **Walls (W)** — a polyline along the cells: clicks add points (snapping to corners and edge midpoints, Alt — no snapping), Enter or double-click finishes, Esc cancels, Backspace removes the last point.
4. **Doors (D)** — click a wall to make a one-cell door; click a door to remove it. A door can be "open by default".
5. **Terrain (T)** — brush, rectangle or fill: normal, difficult terrain, water, pit, obstacle, impassable. Fill does not cross walls.
6. **Height (H)** — cell height in feet (set or add).
7. **Select (V)** — drag wall points, delete points and segments (Delete; Shift — the whole wall), add a point by double-clicking a segment.

Along the top: **Save** (Ctrl+S, with validation), **Check** (a list of issues: grid beyond the image, a door not on a wall, and so on), **Test in battle** (save and open the map in the GM window), undo/redo (Ctrl+Z / Ctrl+Y), **Fit**, and layer toggles. Unsaved work is written to a draft automatically and offered for restoring the next time you open the editor.

## 6. Two screens and the player window

**🖥 Player window** opens a separate window for your audience: fog, tokens, the round and turn order, shown images and dice results. It contains none of your notes or hidden tokens.

- With a second monitor connected, the window opens on it in full screen; you can choose the monitor in settings. With one monitor it is an ordinary window you can drag around.
- Opening it automatically at startup is set in the campaign settings ("Player window"), along with "Full screen on the second monitor".
- In the player window, **double-click or F** toggles full screen.
- If a monitor is plugged in or removed, the window moves by itself.
- The **"Player view"** block: "Whole map", "Revealed" (follows the revealed fog), "Same as mine" (mirrors your zoom and pan) and "Send my view" (a one-time send).

## 7. Tokens, fog, doors, ruler

**The right-hand panel holds "Tokens on the map" and "Library".** Create tokens with **+ Token** (name, label up to 3 characters, color or image, type — Player / Ally / Enemy / Neutral, size from Medium 1×1 up to Gargantuan 4×4, speed, vision, AC, max HP, initiative modifier, team) or pick them from the library (a click places the token on the map). Right-click a token for a menu: status, hide from players, edit, duplicate, **"Add to library"**. **Place party** places all player templates around the cell you click. The library can be exported to and imported from a file.

**Statuses:** Normal, Unconscious, Incapacitated, Dead. HP ≤ 0 sets the status automatically.

**Tools** (top bar; keys in brackets):

- **✋ Select (V)** — select and drag tokens; while you drag, a ruler shows the cost in feet, accounting for difficult terrain, height, walls and closed doors. **Shift** — free movement without restrictions; **Ctrl+Z** — undo a move; arrow keys nudge the selected token by a cell.
- **🌫 Reveal (R)** / **🌑 Hide (H)** — fog brush (size 1/3/5), **▭ Area (Shift+R)** — reveal with a rectangle. "Reveal all" / "Hide all" act on the whole map.
- **👁 Reveal player view** — reveal fog wherever party tokens and allies can see right now (each token has its own "Vision" in feet). The "Auto-reveal fog" option does this automatically whenever a party or ally token is placed or moved.
- **🚪 Doors (D)** — click near a door to open or close it. Closed doors and walls stop tokens.
- **📍 Ping** — a marker on the map visible to the players (Alt+click works in any tool).
- **Ruler visible to players** — a separate toggle in the scene settings, next to the grid and labels (separately for you and for the players), "Diagonals" (the counting rule) and scene export/import.
- Wheel — zoom toward the cursor; pan with Space + left button, middle or right mouse button; the `?` key or the **?** button shows all shortcuts.

## 8. Combat: initiative, HP, counters, dice

The **Combat** panel is on the right.

1. Place tokens. Each has fields for initiative, "mod" (modifier), AC, HP / "max" and team.
2. **🎲 Roll initiative** rolls d20 + modifier for everyone who has none yet (Shift — reroll for everyone). The 🎲 on a token rolls just for it. You can also type initiative by hand.
3. **▶ Start battle** sorts the participants and highlights the first. **Next turn (N)** moves on; at the end of the order a new round begins (counters set to "−1/+1 each round" tick by themselves). **■ End** ends the battle, **⇅ Sort** re-sorts, **Reset** clears initiative for everyone.
4. **"Turn order on the players' screen"** — whether to show the players the turn order.
5. **HP.** In the "−5 / +5" field, `−5` is damage, `+5` is healing, `20` or `=20` sets the value. "max" must be set first. At HP ≤ 0 the status changes by itself. "Source" decides who is credited with damage dealt and kills ("current turn" — whoever's turn it is).
6. **Counters** ("+ Counter"): torch, concentration, charges; attach one to a token and let it go down or up by 1 each round. A notice appears when a counter runs out.
7. **Dice.** In the Dice panel, clicking a die adds it to the formula, ±1 changes the modifier, **Adv.** / **Disadv.** roll a d20 with advantage/disadvantage. You can also type a formula: `2d6+3`, `d20+5`, `4d6dl1` (drop lowest), `2d20kh1` (keep highest), `2d20kl1`, `d20 adv`, `d20 dis`. The Russian `д` and the words `преим` / `помеха` are understood too, whatever the interface language. "Show to players" puts the result on their screen (natural 20 and 1 get a special banner); clicking an entry in the dice log shows it to the players.

## 9. Showcase: images for the players

**🖼 Showcase** opens a panel with tabs: **★ Session** (pinned images) and one tab per category from your settings. Click a thumbnail to show the image on the players' screen; click again to remove it; ✕ on the chip at the top (or the **B** key) returns the map. The ☆ star pins an image to the Session tab. There is search by name, a caption at the bottom of the players' screen ("Caption for players") and a folder rescan. If you don't need a battle map, the map list has a **"🖼 Showcase only"** mode.

## 10. Music and the output device

The **Music** panel is in the right column. Set a music folder (in settings or with the button in the panel): its **subfolders are playlists**, and files directly in the folder go to "No folder". Supported: mp3, ogg, wav, flac, m4a, aac, opus.

- Pick a playlist, then play/pause, previous/next track, shuffle (each track once per cycle), repeat (off / playlist / track), and the position and volume sliders.
- **Fade** — a crossfade between tracks (off or a few seconds).
- **Output** — the device the sound goes to. Choose speakers or headphones; the choice is remembered. If the device disappears, music falls back to the system default and returns to the device when it is back. Only the GM hears the music; the player window is silent.
- **Music hotkeys** (in Settings): by default Ctrl+Space — pause, Ctrl+←/→ — track, Ctrl+↑/↓ — volume. They need Ctrl or Alt (or F2–F12) so they don't clash with the map keys, and they don't fire while the cursor is in a text field.

## 11. Battle log

While a battle runs, the app records turns, damage, healing, status changes and kills. **💾 Save battle** creates a `.md` note: participants (AC, max HP, damage taken/dealt, kills, outcome), "who killed whom" and a chronology by round. The note is written in the interface language. The notes folder is set in settings ("Battle log"); if there is none, the app offers to choose a folder or "Save as…".

If a battle is not saved, the app offers to save it at the next battle or after a restart. You can turn the log off entirely with "Keep a battle log and save notes"; then there is no save button. Before "Clear scene" the app also offers to save the battle.

## 12. Exporting and importing a campaign

**File → Campaigns…** has **Export…** and **Import…** buttons. Export packs a campaign into a single `.udbm` file you can move to another computer:

- always included: settings (paths are replaced with labels), scenes, the token library, Showcase pins;
- optional: maps, Showcase images, battle logs (thumbnails are not included).

Before exporting you see the size and the estimated time; the app may stop responding while it works — don't close it. On **import**, choose a `.udbm` file: you can create a new campaign (give it a data folder — maps, images and logs are unpacked into its subfolders) or replace the contents of the current one (scenes, the library and pins with the same names are overwritten; everything else stays).

## 13. Interface language

The language — Русский or English — is switched in **Settings** ("Interface language") and on the first wizard step. It is an app-wide setting, not a per-campaign one. No restart is needed: the scene is saved, the GM, editor and player windows reload, and the menu is rebuilt. If you switch in the middle of a battle, the app offers to save the "left over" battle after the reload. Dice formulas work in both languages whichever is selected.

## 14. Report a problem

**Help → Report a problem…**: describe what you did and what happened, then click "Collect report". The app saves an archive with logs, your description and software versions (no scenes, maps or images; your user folder name is replaced with `<HOME>`), opens its folder and offers to open the GitHub **Issues** page — attach the file to your issue. Where to send the report is up to you. **Help → Logs folder** opens the logs, and **About** shows the version.

## 15. Optional: token library

A ready-made token library (monsters, NPCs and so on) is available separately — it is not part of the installer:

1. Open https://github.com/KrantOj/universal-dnd-battle-map/releases/tag/extras-tokens-1 and download the library file.
2. Rename it to **`Библиотека токенов.vtt.json`** (exactly this name).
3. Put the file into your campaign's **maps folder**.
4. Open the app: in the "Library" panel click **Import library** and pick that file. The tokens appear in the list, searchable by name and category.

## 16. Keyboard shortcuts

The full list is always one key away: press **?**. The essentials:

| Keys | Action |
|---|---|
| V / R / H / Shift+R / D | Select / reveal brush / hide brush / reveal area / doors |
| 1 / 3 / 5 | Brush size |
| Alt+click | Ping |
| Shift while dragging | Free movement, no ruler limits |
| Arrow keys | Nudge the selected token by a cell |
| Ctrl+Z | Undo a move |
| Delete | Delete the selected token |
| N | Next turn in combat |
| B | Return the map to the players (stop the showcase) |
| Wheel / Space+mouse | Zoom / pan |
| 0 | Fit the map to the window |
| Esc | Cancel (placement, dragging, menus, the Showcase panel) |
| F or double-click (player window) | Full screen |
| Ctrl+Space, Ctrl+←/→/↑/↓ | Music (configurable) |
