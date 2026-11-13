# Выпуск релиза / Releasing

## Как выпустить версию

1. Версия в `package.json` (`npm version X.Y.Z --no-git-tag-version`), раздел `## [X.Y.Z] - дата` в `CHANGELOG.md` (RU + EN). Тест `tests/release.test.js` проверяет, что раздел текущей версии есть.
2. Полная проверка: `npm test`, `npm run smoke`, `npm run smoke:wizard`, `npm run dist`.
3. Коммит, merge в `main`, **`git push origin main`** (тег встанет на запушенный коммит `main`).
4. `npm run release` — проверяет: чистое дерево git, ветка `main`, тег `vX.Y.Z` ещё не существует (локально и на GitHub), в `CHANGELOG.md` есть раздел версии; собирает `electron-builder --win --publish never` и **печатает** точную команду:

   ```
   gh release create vX.Y.Z dist/Universal-DnD-Battle-map-Setup-X.Y.Z.exe dist/Universal-DnD-Battle-map-X.Y.Z-portable.exe dist/latest.yml dist/*.blockmap \
     --title "Universal DnD Battle map X.Y.Z" --notes-file <раздел CHANGELOG> --latest --target main
   ```

   Ничего не публикуется. Проверьте файлы в `dist/` (запустите установщик и portable).
5. `npm run release -- --publish` — то же самое плюс выполнение `gh release create` (нужен вход `gh auth login`; токен в репозитории не хранится; дополнительно проверяется, что локальный `main` совпадает с `origin/main`).

Флаги: `--check` (только проверки), `--skip-build` (взять готовое из `dist/`), `--publish`.

Имена файлов задаёт `electron-builder.yml` (`artifactName` без пробелов): GitHub меняет пробелы в именах ассетов, и тогда ссылки в `latest.yml` перестали бы совпадать с файлами. Если меняете `artifactName`, поменяйте и `scripts/release.js` (`releaseFiles`) — тест сверяет их.

## Какие релизы увидит автообновление

Установленная версия берёт `latest.yml` из **последнего (Latest) релиза** репозитория через `electron-updater` (`allowPrerelease: false`, `allowDowngrade: false`) и предлагает только версию вида `X.Y.Z`, которая новее текущей. Portable спрашивает `api.github.com/.../releases/latest` и принимает релиз, только если тег `vX.Y.Z`, он не draft/prerelease и среди файлов есть `latest.yml`.

**Не-приложенческие релизы (например, `extras-tokens-1` с библиотекой токенов) создавайте с `--latest=false`:**

```
gh release create extras-tokens-2 "Библиотека токенов.vtt.json" --title "..." --notes "..." --latest=false
```

Для уже существующего: `gh release edit extras-tokens-1 --latest=false` (после того, как выпущен первый релиз приложения; пока других релизов нет, GitHub всё равно показывает единственный как Latest). Даже если такой релиз окажется «последним», обновление не предложится — нет `latest.yml` / тег не `vX.Y.Z` (ошибка 404 тихо пишется в лог) — но так всё равно не делайте: `--latest` у релиза приложения (его ставит `npm run release`) должен быть единственным.

## Как проверить автообновление 1.0.0 → 1.0.1 (задача 6.5)

1. Выпустите 1.0.0 (шаги выше), скачайте и **установите** установщик (portable не обновляется сам).
2. Поднимите версию до 1.0.1 (`package.json`, раздел в `CHANGELOG.md`), коммит, merge в `main`, push, `npm run release -- --publish`.
3. Запустите установленную 1.0.0: через ~10 секунд внизу окна мастера появится «Доступна версия 1.0.1 — загрузка N%», затем «Версия 1.0.1 загружена» и кнопка «Установить и перезапустить». Нажмите; приложение закроется, поставит обновление и запустится заново. **Справка → О программе** покажет 1.0.1.
4. Лог (`%APPDATA%\Universal DnD Battle map\logs\main.log`) содержит `updater: mode=nsis`, строки о проверке и загрузке. Для portable: «Доступна версия 1.0.1» и кнопка «Открыть страницу релиза».
5. Проверка «тихих ошибок»: отключите сеть — приложение молча пишет `update check failed` в лог, плашка не появляется.

Первый релиз: пока на GitHub нет релиза приложения, проверка получает 404 — это нормально, пишется только в лог.

---

## English summary

- Bump `package.json` and add a `## [X.Y.Z]` section to `CHANGELOG.md`; run `npm test`, `npm run smoke`, `npm run smoke:wizard`, `npm run dist`; merge to `main` and push.
- `npm run release` runs the safety checks (clean tree, branch `main`, tag free, changelog section), builds with `--publish never` and prints the exact `gh release create vX.Y.Z <installer> <portable> dist/latest.yml dist/*.blockmap --title ... --notes-file ...` command. `npm run release -- --publish` also runs it.
- Auto-update reads `latest.yml` of the repository's **Latest** release. Releases that are not app releases (e.g. `extras-tokens-1`) must be created with `--latest=false`; the app additionally ignores any release whose tag is not `vX.Y.Z` or that has no `latest.yml`.
- To test 1.0.0 → 1.0.1: install 1.0.0 from the installer, publish 1.0.1, start 1.0.0 and wait ~10 s for the "Version 1.0.1 is available" bar, then "Install and restart".
