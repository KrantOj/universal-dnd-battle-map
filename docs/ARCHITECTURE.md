# Universal DnD Battle map — архитектура

Настольное приложение (Electron) для боёв на картах D&D 5e: мастер ведёт бой на карте сетки,
окно игроков выводится на второй монитор и показывает то же состояние. Формат карт — см. [MAP-FORMAT.md](MAP-FORMAT.md).
Контракт между главным процессом, preload и рендерером — [HOST-API.md](HOST-API.md) (единственный источник правды по API).

Сборки рендерера нет: это обычные `<script>` (без ES-модулей) с общим пространством имён `window.VTT`.
Зависимости времени выполнения: `electron-log`, `electron-updater`, `fflate`. Для разработки и сборки: `electron`, `electron-builder`.

## 1. Процессы и хост

| Процесс | Файлы | Роль |
|---|---|---|
| **main** | `src/main/*.js` | Жизненный цикл, окна, файловая система, кампании, настройки, меню, протоколы `app://` и `userfile://`, IPC-мост |
| **preload** | `src/preload/preload.js` | Единственная точка доступа рендерера к системе: `contextBridge` выставляет `window.host` (см. HOST-API) |
| **renderer** | `src/renderer/*.html`, `src/renderer/js/*.js`, `src/renderer/css/*.css` | Интерфейс и игровая логика; Node и Electron недоступны |

### Окна (`src/main/windows.js`)
- **GM** — `gm.html`; до создания первой кампании — `wizard.html`. `host.app.showWizard()` / `showGm()` переключают страницу.
  `boot-gm.js` поднимает `VTT.gm`, `VTT.showcase`, `VTT.combat`, `VTT.settings`.
- **Player** — `player.html` (`boot-player.js` → `VTT.player`). Открывается `host.windows.openPlayer()` и автоматически после загрузки GM,
  если `campaign.playerWindow.auto` и есть второй монитор. Ставится на `displayId`, иначе на первый непервичный экран; полноэкранно,
  если `playerWindow.fullscreen`.
- Геометрия окон GM сохраняется в `userData/window-state.json`.

### Настройки окон и безопасность рендерера
- `webPrefs`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload = `preload.js`.
- `setWindowOpenHandler → deny`; `will-navigate` и `will-redirect` отменяются. Окон из кода страницы не создаётся.
- CSP в каждой странице (meta): `default-src 'self' app: userfile: data: blob:`; `img-src` и `media-src` — те же источники.
  Внешних ресурсов и CDN нет.
- Схема `app://` (`protocol.js`) отдаёт только файлы из `src/renderer`; выход за корень → 403.
- Схема `userfile://` отдаёт только файлы корней текущей кампании. Путь проверяется `pathutil.resolveIn`:
  `..`, абсолютные пути и `\0` отклоняются (403). Схема зарегистрирована как `standard`, `secure`, `stream`.
- Файловый API (`fsapi.js`) работает только через пару `(root, rel)`. `fs.writeAbs` принимает лишь путь, который в этой сессии
  вернул `dialog.saveFile` (одноразовый, `allowedSaves`).
- Одна копия приложения (`requestSingleInstanceLock`); второй запуск фокусирует окно GM.

### Корни (roots)
Все файловые операции адресуются корнем, который привязан к **текущей кампании** (`campaigns.rootPath`):

| Корень | Папка | Примечание |
|---|---|---|
| `data` | `campaign.folders.data` | всегда задан; по умолчанию `<Документы>/Universal DnD Battle map/<имя кампании>` |
| `maps` | `campaign.folders.maps` | `*.map.json` и картинки карт |
| `battlelog` | `campaign.folders.battlelog` | журнал боёв `.md`; `null`, если `battlelog.enabled === false` |
| `media:<id>` | `campaign.media[i].path` | по одному корню на каждый источник картинок «Показа» |
| `music` | `campaign.folders.music` | музыка мастера: подпапки = плейлисты (`js/music.js`, чистая логика — `js/music-logic.js`); играет только в окне мастера, kv-ключ `music` |

Незаданный корень → ошибка `ROOT_NOT_SET:<root>`.

### Схемы URL, которые видит рендерер
- `userfile://r/<encodeURIComponent(root)>/<сегменты>` — картинки карт и показа. Строит `host.fs.url(root, rel)` (в preload, синхронно).
  Картинки игрокам передаются этим URL, а не dataURL или Blob. Исключение — портреты токенов (dataURL, §6).
- `app://…/<страница>.html` — страницы рендерера.

### Межоконная связь (IPC-мост)
Окна не общаются напрямую. `host.sync.send(msg)` → `ipcRenderer.send('sync:send')` → main (`ipc.js`) →
`windows.relay(sender)`: сообщение от GM уходит окну игроков, от игроков — окну GM (канал `sync:message`).
Сообщения — структурно клонируемые простые данные (без File, Blob, Image).

## 2. Кампании и где лежат данные

- **Кампания** — JSON `userData/campaigns/<id>.json` (`src/main/campaigns.js`):
  `{ id, name, created, updated, folders:{data,maps,battlelog,music}, media:[…], battlelog:{enabled}, playerWindow:{auto,displayId,fullscreen}, prefs:{} }`.
  Текущая кампания — `settings.currentCampaign` в `userData/settings.json`.
- **Папка данных** `data` (по умолчанию в Документах; можно выбрать при создании кампании):
  - `scenes/<карта>.scene.json` — сцены (§4);
  - `library.tokens.json` — библиотека шаблонов токенов (`format: vestfalia-tokens/1`);
  - `kv.json` — ключ-значение кампании (`host.kv`), в том числе незавершённый бой (ключ `pendingBattle`), закреплённые картинки показа (`showPins`);
    пишется с отложенным сбросом, при выходе сбрасывается `kv.flushAll`;
  - `thumbs/<hash>.jpg` — миниатюры картинок «Показа» (`media.js`).
- **Совместимость библиотеки**: если в папке карт лежит `Библиотека токенов.vtt.json`, она тоже читается. При слиянии
  побеждает шаблон с большим `updated` (ключ — `lid`).
- **Глобально** (`userData`): `settings.json`, `campaigns/`, `window-state.json`, логи `electron-log` (пункт меню «Открыть логи»).
- Сцена ключуется именем карты (`scene.map`), а не путём на диске.

## 3. Файлы

```
src/main/
  main.js        вход: схемы, обработчики, IPC, меню, окна, smoke
  windows.js     окна GM и игроков, размещение, relay, broadcast
  ipc.js         регистрация ipcMain-обработчиков (все методы host.*)
  protocol.js    app:// и userfile://
  campaigns.js   кампании, rootPath
  fsapi.js       чтение, запись, список, импорт в корнях
  pathutil.js    чистые функции путей (тестируются без Electron)
  scenes.js, kv.js, settings.js, store.js (json-утилиты), menu.js, log.js
  smoke.js       сквозной прогон (§8)
src/preload/preload.js     window.host
src/renderer/
  gm.html, player.html, wizard.html
  css/   vtt.css ui.css showcase.css show-player.css combat.css wizard.css
  js/
    geometry.js movement.js dice.js ui.js        чистые модули (ui — с DOM)
    music-logic.js music.js                      плейлисты/кроссфейд/хоткеи (чистая логика) и плеер (два <audio>, setSinkId)
    store.js tokens-draw.js render.js sync.js media.js
    showcase.js battlelog.js combat.js cfgui.js settings.js wizard.js
    gm.js player.js boot-gm.js boot-player.js
tests/   node --test; fixtures/demo.map.json и картинка к нему
docs/    HOST-API.md, MAP-FORMAT.md, ARCHITECTURE.md
```

Порядок подключения в `gm.html`: geometry → movement → dice → ui → store → tokens-draw → render → sync → music-logic → media →
showcase → battlelog → combat → music → cfgui → settings → gm → boot-gm.
В `player.html`: geometry → movement → dice → tokens-draw → render → sync → player → boot-player.

## 4. Модель данных

```js
Map (в памяти, store.buildMap) = {
  name, title,                    // name — ключ сцены; title — meta.name
  cols, rows, ppg, feet,          // resolution.map_size, pixels_per_grid, feet_per_cell
  meta,                           // исходный map.json
  image,                          // HTMLImageElement
  imageURL,                       // userfile:// URL картинки (уходит игрокам)
  imageGrid: {x,y,width,height},  // клетка (0,0) внутри картинки и полный размер картинки
  labels, geo: {walls, doors}, walls,
  warning?                        // картинка не совпадает с сеткой
}

Scene (scenes/<карта>.scene.json) = {
  version: 1, map: name,
  tokens: Token[],
  fog: string,                    // cols*rows символов: '1' скрыто, '0' открыто; индекс y*cols+x
  doors: boolean[],               // по одному на portals[i]; по умолчанию portals[i].open
  round: 1,
  settings: { diagonal:'5'|'5-10-5', autoReveal, gridGM, gridPlayer, playerView:'fit-map'|'fit-revealed'|'gm',
              rulerToPlayers, labelsGM, labelsPlayer, showQueue },
  combat?:   { active, order:[tokenId], turnId },           // создаётся лениво
  counters?: [{ id, name, value>=0, perRound:-1|0|1, tokenId|null }]
}

Token = { id, name, label /*≤3 символа*/, color, kind:'pc'|'ally'|'enemy'|'neutral', size:1..4,
          x, y /*левая верхняя клетка*/, speed:30, vision:60,
          status:'ok'|'unconscious'|'incapacitated'|'dead', hidden:false,
          image: null | dataURL, moved:0,
          init?, initMod, hp?, maxHp, ac,    // hp/ac видят игроки только у pc/ally
          lid? }                              // ссылка на шаблон библиотеки

Template (library.tokens.json, format 'vestfalia-tokens/1') = {
  lid, updated, name, label, color, kind, size, speed, vision, image, hidden:false,
  category, maxHp, ac, team, initMod }
```
Старые сцены открываются без миграции: недостающие поля заполняются при загрузке (`normalizeScene`, `combat` — лениво).

## 5. Модули и контракты (renderer)

Все модули регистрируются как `window.VTT.<имя>`.

### `VTT.geometry` (geometry.js, чистый)
```js
segmentsFromMap(meta) -> { walls: Seg[], doors: Seg[] }   // Seg = {x1,y1,x2,y2}; doors[i] ↔ portals[i]
blockingSegments(geo, doorsOpen[]) -> Seg[]               // стены + закрытые двери
segIntersect(a, b), rayBlocked(segs, ax,ay,bx,by), edgeBlocked(segs, x0,y0,x1,y1)   // между центрами клеток
visibleCells(map, segs, cx, cy, radiusCells) -> idx[]     // луч к любой из 5 точек клетки
cellName(x, y) -> 'D6'                                    // x: A..Z, AA..; y: с 1
distToSegment(px, py, seg)
```
Препятствия (`obstacle`) видны, но не блокируют обзор. Луч, проходящий ровно через стык стен, блокируется, если стык сквозной.

### `VTT.movement` (movement.js, чистый)
```js
cellRule(map, x, y) -> { blocked, mult: 1|2, reason: ''|'difficult'|'water' }   // таблица в MAP-FORMAT.md
findPath(map, segs, from, to, opts) -> { path, feet, ok, difficult, elevFrom, elevTo }
reach(map, segs, from, budgetFt, opts) -> Map<idx, feet>
// opts: { diagonal:'5'|'5-10-5', size:1..4, occupied:Set<idx>, free:false }
```
Дейкстра по 8 соседям. Для `5-10-5` состояние = (клетка, чётность диагоналей). Диагональ запрещена, если стенка перекрывает
оба ортогональных угла. Токен размера `size` проверяет весь след; множитель — максимум по следу.
Стоимость шага = 5 фт (вторая диагональ в `5-10-5` — 10 фт) × множитель клетки, в которую вошли.

### `VTT.dice` (dice.js, чистый)
`parse(expr)`, `roll(expr, rng?) -> {expr,total,text,parts,d20,sides}`, `svg(sides, {size,label})`, `MAX_COUNT`, `MAX_SIDES`.
Синтаксис: `NdM`, `khK`/`klK`/`dhK`/`dlK`, `+ −`, константы, суффикс `adv`/`dis` для одиночного d20. Лимиты: ≤100 кубиков, 2–1000 граней.

### `VTT.ui` (ui.js, ui.css)
`confirm({title,text,ok,cancel,danger}) → Promise<bool>`, `alert({title,text})`, `prompt({title,text,value}) → Promise<string|null>`.
Нативные `alert`, `confirm`, `prompt` не используются.

### `VTT.store` (store.js, поверх `window.host`)
Тонкий слой над `host`: `saveScene/loadScene`, `getLibrary/saveLibrary` (`data/library.tokens.json`, слияние с legacy-файлом по `lid`),
`getKV/setKV`, `listMaps`, `loadMapFromEntry`, `importMapFiles(paths)` (картинка выбирается по `meta.image`),
`exportScene/importScene`, `exportLibrary/importLibraryFile`. IndexedDB не используется.

### `VTT.tokensDraw` (tokens-draw.js)
`drawToken(ctx, token, px, sx, sy, {gm, selected, dragging, turn})`. Статусы:
- **ok** — круг; заливка `color` или картинка; обводка по `kind` (pc зелёная, ally синяя, enemy красная, neutral жёлтая);
  полоска HP внизу круга при `maxHp>0`; золотое кольцо, если `turn`.
- **unconscious** — серый, сплющенный, синий пунктирный ободок, значок сна.
- **incapacitated** — частично серый, пульсирующее оранжевое кольцо.
- **dead** — серый и затемнённый, красный крест; рисуется под остальными токенами, клетку для пути не занимает.
- **hidden** (виден только GM) — полупрозрачность и значок скрытости.

### `VTT.render` (render.js) — `createRenderer(canvas, {mode:'gm'|'player'})`
`setMap`, `setScene`, `camera {x,y,scale}`, `screenToCell`, `cellToScreen`, `fit(rect?, ms?)`, `ruler`, `pings`, `overlay(ctx)`, `requestDraw()`, `getView()`.
Слои: фон → карта (по `imageGrid`) → сетка (опц.) → подписи (`labels`, по флагам `labelsGM`/`labelsPlayer`) → двери →
мёртвые токены → живые токены → туман → линейка → пинги → overlay.
- Рамка картинки вне сетки туманом не закрывается.
- Туман: маска `cols×rows`, растягивается с мягкими краями. Игрокам — непрозрачный; токены в полностью закрытых клетках им не рисуются.
- Двери: закрытая — доска с тёмной обводкой; открытая — та же доска, повёрнутая. Игрокам — только если открыта хотя бы одна соседняя клетка.

### `VTT.sync` (sync.js) — обёртка над `host.sync` и `host.windows`
GM: `send(msg)` (только при открытом окне игроков), `queueState(getter)` (debounce 50 мс), `sendRuler(ruler)` (30 Гц),
`onHello(cb)`, `openPlayerWindow()`, `onState(cb)`. Игрок: `listen(cb)`, `hello()`.

### `VTT.gm` (gm.js) — интерфейс мастера
Канвас на всё окно; справа панель (токены на карте, «+ Токен», библиотека, настройки); сверху тулбар; снизу статус-строка.
Инструменты: выбор и движение, открыть/скрыть кистью, прямоугольник, двери, пинг (Alt+клик).
Линейка при перетаскивании токена строится по `findPath`; цвет зависит от остатка скорости. Shift — свободное перемещение.
Автооткрытие тумана — для `pc` и `ally` по радиусу `vision`. Ctrl+Z отменяет перемещение.
Клавиши: V, R / Shift+R, H, D, 1/3/5, 0 (вписать карту), N (следующий ход), стрелки, Delete.

### `VTT.player` (player.js)
Только канвас и слой «Показа». Ждёт `map`, `state`, `images`, `ruler`, `ping`, `show`, `roll`. Пока карты нет — заставка.
Двойной клик или `F` — полноэкранный режим (`host.windows.togglePlayerFullscreen`).

### `VTT.showcase` (showcase.js, media.js; showcase.css, show-player.css)
Режим «Показ»: GM выбирает картинку из каталога, игроки видят её поверх карты; бой продолжает синхронизироваться.
- Источники — `campaign.media` (корни `media:<id>`). `VTT.media`: `scan`, `matches`, `titleFromName`, `urlOf(item)`, `thumb` (миниатюры — `thumbs/`, кэш в kv).
- Сообщение `{t:'show', item: null | {id, title, caption, cat, url}}`, `url` — `userfile://`. `null` убирает показ. GM повторяет текущий показ на каждый `hello`.
- Закреплённые картинки («★ Сессия») хранятся в `kv['showPins']`.

### `VTT.combat` (combat.js, combat.css)
Инициатива, HP, статусы, счётчики, броски. API: `init`, `render`, `next`, `prev`, `applyHp(token, '−5'|'+5'|'20'|'=20')`, `queueFor(visIds)`.
HP ≤ 0 → `unconscious` (pc, ally) или `dead`. Переход хода через конец круга вызывает `gm._api.newRound()`.
Броски уходят игрокам как `{t:'roll', …}` и показываются анимацией кубика (`#rollShow`).
Очередь ходов (`state.queue`, при `settings.showQueue`) — без цифр инициативы.

### `VTT.blog` (battlelog.js)
Журнал боя: автоматические записи (начало и конец боя, ходы, раунды, урон и лечение, статусы). Зеркалится в `kv['pendingBattle']`,
поэтому не теряется при закрытии. Сохраняется в `.md` в корень `battlelog`. Выключается `campaign.battlelog.enabled === false`.

### `VTT.cfg` / `VTT.settings` (cfgui.js, settings.js); wizard.js
`cfg` — общие элементы форм (папки, источники «Показа», чекбоксы). `settings` — окно «Настройки»: изменения сразу пишутся через `host.campaigns.update`.
`wizard.js` — мастер первого запуска: создаёт кампанию через `host.campaigns.create`.

## 6. Протокол мастер ↔ игроки

Сообщения через `host.sync` (IPC-мост):
```
GM → игроки
{t:'map', name, cols, rows, ppg, image:<userfile URL>, imageGrid, labels, geoDoors}   смена карты и ответ на hello
{t:'state', tokens /*без hidden и image*/, fog, doors, settings, view, round, turnId, queue?}
{t:'images', images:{[tokenId]: dataURL}}        портреты токенов, только новые или изменённые
{t:'ruler', ruler|null}                          не чаще 30 Гц
{t:'ping', x, y}
{t:'show', item|null}
{t:'roll', who, expr, total, text, d20, sides}

игроки → GM
{t:'hello'}          при загрузке окна игроков; GM отвечает полным состоянием (map, state, show)
```
- `geoDoors` — сегменты дверей (нужны игрокам для отрисовки); `doors` — их состояние.
- `view = {cx, cy, cellsW}` — вид мастера для режима `playerView:'gm'`.
- Скрытые токены не передаются вовсе. `init` и `initMod` не передаются никому. `hp`, `maxHp`, `ac` — только у pc и ally.

Отличия от прежней браузерной версии: карты и картинки показа идут игрокам как `userfile://` URL, а не dataURL или Blob.
`postMessage` и `window.open` больше не используются.

## 7. Отличия от браузерной версии

- Нет `file://`: нет File System Access API, IndexedDB, `window.open`/`postMessage` и сборщика `build.py`.
- Пути к данным и картинкам задаёт кампания. Карта выбирается из папки `maps` или импортом файлов (`dialog.pickFiles`).
- Журнал боя, библиотека и сцены лежат в папке `data` кампании, а не в браузере.

## 8. Проверка

- **Юнит-тесты** (чистые модули, без Electron): `npm test` → `node --test tests/`.
  Файлы: `geometry`, `movement`, `dice`, `fixture` (на `tests/fixtures/demo.map.json`), `main-fsapi` (пути и корни), `smoke`.
  Вспомогательные построители карт — `tests/helpers/map.js`, загрузчик модулей — `tests/helpers/load.js`.
- **Сквозной smoke**: `npm run smoke` → `electron . --smoke`; `npm run smoke:wizard` → `electron . --smoke-wizard` (путь без кампании).
  Реализация — `src/main/smoke.js`: временный `userData` в `os.tmpdir()`, скриптованная сессия GM, скриншоты и
  `smoke-report.json` (шаги, ошибки, console.error) в папке `udbm-smoke-<время>`. Выводит строку `SMOKE_DIR=…`. Код выхода 0 — успех.
- **Сборка установщика**: `npm run dist` (electron-builder, Windows, без публикации).
