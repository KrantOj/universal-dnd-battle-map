# Changelog / История версий

Формат раздела: `## [X.Y.Z] - дата`. Скрипт `npm run release` берёт текст раздела текущей версии из package.json как описание релиза.
Section format: `## [X.Y.Z] - date`. `npm run release` uses the section of the current package.json version as the release notes.

## [1.0.0] - unreleased

**RU**
- Первый публичный релиз: установщик и портативная версия для Windows.
- Окно «О программе» (версии, лицензия MIT, ссылка на GitHub, проверка обновлений).
- Автообновление: установленная версия сама находит и скачивает новую (проверка при запуске и раз в 6 часов), «Установить и перезапустить». Портативная версия только сообщает о новой версии со ссылкой на релиз. Настройка «Проверять обновления».
- Смена языка посреди боя больше не спрашивает про «оставшийся бой» — бой восстанавливается сам.
- Иконка приложения, README со скриншотами, руководства RU/EN.

**EN**
- First public release: installer and portable build for Windows.
- "About" window (versions, MIT license, GitHub link, update check).
- Auto-update: the installed build finds and downloads new versions by itself (on start and every 6 hours) and offers "Install and restart". The portable build only tells you about a new version and links to the release. New "Check for updates" setting.
- Switching the language in the middle of a battle no longer asks about a "leftover battle" — the battle is restored silently.
- App icon, README with screenshots, RU/EN user guides.

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
