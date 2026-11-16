# Changelog / История версий

Формат раздела: `## [X.Y.Z] - дата`. Скрипт `npm run release` берёт текст раздела текущей версии из package.json как описание релиза.
Section format: `## [X.Y.Z] - date`. `npm run release` uses the section of the current package.json version as the release notes.

## [1.1.0] - 2026-11-16

**RU**
- Скины 3D-костей: в «Настройки → Кости (3D)» можно выбрать вид костей (Классика, Кость, Обсидиан, Изумруд, Тайная магия) и сразу посмотреть пробный бросок. Выбранный скин видят игроки.
- Свои скины: папка со `skin.json` и картинками (цвет и материал корпуса, текстура, карта рельефа, цвет, контур и свечение цифр) кладётся в папку скинов; кнопка «Открыть папку скинов» открывает её. Инструкция, в том числе по Blender: `docs/DICE-SKINS.ru.md`, готовый образец: `docs/dice-skin-example`.
- Обновление теперь спрашивает разрешения: установленная версия больше не скачивает новую версию сама, а показывает плашку «Доступна версия X» с кнопкой «Скачать обновление» (в окне «О программе» тоже). Установка по-прежнему по кнопке «Установить и перезапустить».

**EN**
- 3D dice skins: pick the look of the dice in "Settings → Dice (3D)" (Classic, Bone, Obsidian, Emerald, Arcane) and preview it with a sample roll. Players see the selected skin.
- Custom skins: a folder with `skin.json` and images (body colour and material, texture, normal map, number colour, outline and glow) goes into the skins folder; the "Open skins folder" button opens it. Guide, including Blender: `docs/DICE-SKINS.en.md`, ready sample: `docs/dice-skin-example`.
- Updates now ask first: the installed version no longer downloads a new version by itself; it shows "Version X is available" with a "Download update" button (also in the About window). Installing is still done with "Install and restart".

## [1.0.4] - 2026-11-16

**RU**
- 3D-кубики: бросок мастера в окне игроков теперь показывается объёмными кубиками (d2 «монета Кракена», d4, d6, d8, d10, d12, d20, d100 как пара десятков и единиц). Кубик кувыркается и останавливается гранью с выпавшим числом; противоположные грани дают N+1, у 6 и 9 есть подчёркивание. Формулы с несколькими кубиками (например, 4d6) показываются все сразу, отброшенный кубик тускнеет. Нестандартные кубики (d3, d7…), больше 10 кубиков в броске или отсутствие WebGL показываются прежним плоским способом.
- Модели кубиков собираются из STL скриптом `node scripts/build-dice.js` (папка `assets/dice`).
- Если 3D-анимацию не удалось запустить (например, нет WebGL), причина записывается в журнал приложения, а кубики показываются плоским способом.

**EN**
- 3D dice: a roll shown by the GM now plays out with 3D dice in the player window (d2 "Kraken coin", d4, d6, d8, d10, d12, d20, and d100 as a tens + units pair). The die tumbles and lands with the rolled number facing you; opposite faces add up to N+1, and 6 and 9 are underlined. Multi-dice formulas (e.g. 4d6) show every die at once, a dropped die fades out. Unusual dice (d3, d7…), more than 10 dice in one roll, or no WebGL fall back to the previous flat display.
- Dice models are built from STL files by `node scripts/build-dice.js` (folder `assets/dice`).
- If the 3D animation cannot start (e.g. no WebGL), the reason is written to the app log and the dice are shown the flat way.

## [1.0.3] - 2026-11-15

**RU**
- Туман войны теперь открывают только персонажи. Союзники, враги и нейтральные токены его не открывают; для токена на карте это включается вручную в контекстном меню (правый клик по токену, по строке в списке токенов или по плашке в порядке хода): «Открывать туман войны». Старые союзники по умолчанию не открывают туман.
- Подписи и текст на карте: в редакторе новый инструмент «Текст (L)» и слой «Подписи» (добавление, перенос, вид, размер, скрытие от игроков). В бою новый инструмент «Подписи (L)»: клик по подписи показывает/скрывает её для игроков, клик по пустому месту добавляет свою подпись (скрыта по умолчанию), Shift+клик удаляет её. Скрытые подписи игрокам не отправляются вообще.

**EN**
- Only player characters now reveal the fog of war. Allies, enemies and neutral tokens no longer do; for a token on the map this is enabled manually from its context menu (right-click the token, its row in the token list or its plate in the turn order): "Reveal fog of war". Existing allies do not reveal fog by default.
- Map labels and text: the editor has a new "Text (L)" tool and a "Labels" layer (add, move, kind, size, hide from players). In battle there is a new "Labels (L)" tool: click a label to show/hide it for players, click empty space to add your own label (hidden by default), Shift+click deletes it. Hidden labels are never sent to players at all.

## [1.0.2] - 2026-11-14

**RU**
- Рамка карты из картинки в редакторе теперь в том же тёмном стиле, что у карт скилла battle-map: заголовок, буквы столбцов и цифры строк с двух сторон, легенда.
- Легенда собирается из содержимого карты: масштаб, труднопроходимая местность, вода, ямы, препятствия, непроходимые клетки, двери и перепады высот (каждая высота своим цветом). Длинная легенда переносится на новую строку.
- Исправлено: на картах из картинки не отображались вода, труднопроходимая местность, ямы, препятствия и высоты. Теперь в бою (у мастера и игроков) они рисуются приложением по слоям карты: цветная заливка, «◆◆» у труднопроходимых клеток, цветной пунктир по границам высот.
- Легенда и рамка обновляются при каждом сохранении карты: исходная картинка без рамки хранится рядом (`<имя>.base.png`). Карты, сохранённые в 1.0.1 с рамкой, не обновляются — их нужно создать заново.

**EN**
- The frame added to maps made from an image in the editor now uses the same dark style as battle-map skill maps: title, column letters and row numbers on both sides, legend.
- The legend is built from the map contents: scale, difficult terrain, water, pits, obstacles, impassable cells, doors and height differences (each height in its own colour). A long legend wraps onto a new line.
- Fixed: water, difficult terrain, pits, obstacles and heights were not shown on maps made from an image. They are now drawn by the app from the map layers in battle (GM and players): coloured fill, "◆◆" on difficult cells, coloured dashed outlines along height borders.
- The frame and legend are redrawn on every save: the original image without a frame is kept next to the map (`<name>.base.png`). Maps saved with a frame in 1.0.1 are not updated — recreate them.

## [1.0.1] - 2026-11-14

**RU**
- Исправлено: у карт, созданных в редакторе из обычной картинки, не было подписей столбцов (A, B, …), строк (1, 2, …) и легенды. Теперь при первом сохранении редактор предлагает добавить рамку с заголовком, подписями столбцов и строк и легендой (масштаб); можно отказаться («Без рамки»).

**EN**
- Fixed: maps created in the editor from a plain image had no column (A, B, …) or row (1, 2, …) labels and no legend. On the first save the editor now offers to add a frame with a title, column and row labels and a legend (scale); you can decline ("No frame").

## [1.0.0] - 2026-11-13

**RU**
- Первый публичный релиз: установщик и портативная версия для Windows.
- Окно «О программе» (версии, лицензия MIT, ссылка на GitHub, проверка обновлений).
- Автообновление: установленная версия сама находит и скачивает новую (проверка при запуске и раз в 6 часов), «Установить и перезапустить». Портативная версия только сообщает о новой версии со ссылкой на релиз. Настройка «Проверять обновления».
- Смена языка посреди боя больше не спрашивает про «оставшийся бой» — бой восстанавливается сам.
- Иконка приложения, README со скриншотами, руководства RU/EN.
- Редактор: двери длиной в несколько клеток, стены привязаны к углам клеток (Alt — свободно), панель не обрезается, после закрытия редактора открывается главное окно.
- Музыка: перемотка ползунком, «Автоматически переходить к следующему треку», плавный переход на коротких треках, длинные плейлисты отображаются целиком.
- Анимация броска кубиков у игроков короче. F11 — полноэкранный режим, Esc — выход из него.
- При удалении программы можно удалить и настройки со списком кампаний (по умолчанию — нет).

**EN**
- First public release: installer and portable build for Windows.
- "About" window (versions, MIT license, GitHub link, update check).
- Auto-update: the installed build finds and downloads new versions by itself (on start and every 6 hours) and offers "Install and restart". The portable build only tells you about a new version and links to the release. New "Check for updates" setting.
- Switching the language in the middle of a battle no longer asks about a "leftover battle" — the battle is restored silently.
- App icon, README with screenshots, RU/EN user guides.
- Editor: multi-cell doors, walls snap to cell corners (Alt for free placement), side panel no longer clipped, the main window reopens when the editor closes.
- Music: seeking with the slider, "Automatically play the next track", crossfade on short tracks, long playlists are fully listed.
- Shorter dice animation on the players' screen. F11 toggles fullscreen, Esc exits it.
- The uninstaller can also remove settings and the campaign list (default: no).

## [0.5.0] - 2026-11-13

**RU** — Английский интерфейс: переключатель языка без перезапуска, словари ru/en, руководства на двух языках.
**EN** — English interface: language switch without a restart, ru/en dictionaries, user guides in both languages.

## [0.4.0] - 2026-11-13

**RU** — Музыка: панель плеера, плейлисты из папок, кроссфейд, выбор устройства вывода, горячие клавиши.
**EN** — Music: player panel, folder playlists, crossfade, output device selection, hotkeys.

## [0.3.0] - 2026-11-13

**RU** — Редактор карт: сетка, стены, двери, труднопроходимая местность, вода, высоты, проверка карты, «Проверить в бою», черновики.
**EN** — Map editor: grid, walls, doors, difficult terrain, water, heights, map check, "Test in battle", drafts.

## [0.2.0] - 2026-11-13

**RU** — Профили кампаний, экспорт/импорт `.udbm`, смена папки данных с переносом, слежение за папками карт, лог и отчёт о проблеме.
**EN** — Campaign profiles, `.udbm` export/import, moving the data folder, watching map folders, log and problem report.

## [0.1.0] - 2026-11-13

**RU** — Перенос VTT на Electron: карта с сеткой, туман войны, двери, токены, линейка, бой (инициатива, HP, кубики), показ картинок, журнал боя, окно игроков для второго экрана, мастер первого запуска, импорт карт.
**EN** — VTT ported to Electron: grid map, fog of war, doors, tokens, ruler, combat (initiative, HP, dice), image showcase, battle log, player window for a second screen, first-run wizard, map import.
