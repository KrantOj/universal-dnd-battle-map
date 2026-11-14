# Changelog / История версий

Формат раздела: `## [X.Y.Z] - дата`. Скрипт `npm run release` берёт текст раздела текущей версии из package.json как описание релиза.
Section format: `## [X.Y.Z] - date`. `npm run release` uses the section of the current package.json version as the release notes.

## [1.0.2] - 2026-11-14

**RU**
- Рамка карты из картинки в редакторе теперь в том же тёмном стиле, что у карт скилла battle-map: заголовок, буквы столбцов и цифры строк с двух сторон, легенда.
- Легенда собирается из содержимого карты: масштаб, труднопроходимая местность, вода, ямы, препятствия, непроходимые клетки, двери и перепады высот (каждая высота своим цветом). Длинная легенда переносится на новую строку.
- Легенда и рамка обновляются при каждом сохранении карты: исходная картинка без рамки хранится рядом (`<имя>.base.png`). Карты, сохранённые в 1.0.1 с рамкой, не обновляются — их нужно создать заново.

**EN**
- The frame added to maps made from an image in the editor now uses the same dark style as battle-map skill maps: title, column letters and row numbers on both sides, legend.
- The legend is built from the map contents: scale, difficult terrain, water, pits, obstacles, impassable cells, doors and height differences (each height in its own colour). A long legend wraps onto a new line.
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
