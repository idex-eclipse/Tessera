# Доставка и установка плагинов

Core-плагины (`@core/…`) вшиты в бандл хоста. Remote-плагины доставляются как
файлы на сервере хоста — по аналогии с `klippy/extras` в Klipper: вы кладёте
файлы в папку, хост их находит.

Доставка состоит из четырёх слоёв:

| Слой | Что делает | Где |
|---|---|---|
| **Provisioning** | файлы плагина лежат на сервере | `<проект>/extensions/<имя>/` |
| **Discovery** | список доступных плагинов | `/extensions/index.json` (статический файл) |
| **Loading** | fetch манифеста → import модуля | загрузчик плагинов хоста |
| **Enablement** | включён ли плагин, на каких принтерах | `localStorage` → `mpu:v2:plugins` |

Хост **сам файлы не пишет**, и обновлений «из интернета» нет: источник истины —
содержимое `extensions/`.

---

## Provisioning

```
extensions/
├── index.json                  ← генерируется tools/extensions-sync.cjs
├── hello/
│   ├── manifest.json
│   ├── index.js                ← entry (имя берётся из manifest.entry)
│   └── assets/…                ← любые статические файлы плагина
└── another-plugin/
    ├── manifest.json
    └── …
```

Правила:

- Имя папки произвольно, но удобнее делать его совпадающим с коротким именем плагина
  (в URL манифеста оно попадает как `/extensions/<имя>/manifest.json`).
- Обязателен `manifest.json` с полями `id`, `name`, `version`, `entry`.
- `entry` резолвится **относительно URL манифеста**: `"entry": "index.js"` →
  `/extensions/hello/index.js`. Абсолютный URL и путь от корня тоже допустимы.
- Поле `icon` в манифесте необязательно; скрипт пробрасывает его в запись каталога.

### Из реестра плагинов (рекомендуемый путь)

Проверенные плагины публикуются в отдельном репозитории-реестре. Его CI собирает
каждый плагин и выкладывает архив `.tar.gz` и `registry.json` с sha256 архива. На
принтере ничего не собирается: CLI скачивает архив, сверяет хеш и распаковывает его
в `extensions/<dir>/`:

```bash
tessera-ext                     # интерактивное меню: номер = установить / обновить / удалить
tessera-ext list                # плагины реестра + что установлено
tessera-ext install hello       # скачать → sha256 → extensions/hello/
tessera-ext update --all        # или: update hello
tessera-ext remove hello
```

Команду `tessera-ext` (`/usr/local/bin/tessera-ext`) создаёт `deploy/install.sh`.
Она запускает [`deploy/install-ext.sh`](../../deploy/install-ext.sh), а тот —
`tools/tessera-ext.cjs` из каталога установки. Плагин можно назвать полным id
(`acme/hello`) или коротким именем (`hello`); неоднозначное имя — ошибка. Без
команды `tessera-ext` (например, до обновления Tessera) работает
`bash ~/tessera/deploy/install-ext.sh`. В конце `install.sh` предлагает сразу
открыть меню.

`index.json` CLI пересобирает сам. Дальше — Settings → Plugins → Refresh → Install.

Что CLI проверяет, прежде чем что-то попадёт в `extensions/`:

- sha256 архива совпадает с `registry.json`;
- в архиве только обычные файлы и папки: без симлинков, абсолютных путей и `..`;
- `manifest.json` из архива совпадает с записью реестра по `id` и `version`;
- `pluginApi` записи не новее, чем поддерживает хост (сейчас `1`).

Плагин распаковывается в скрытую staging-папку и подменяется через `rename`. Если
обновление не удалось, остаётся прежняя версия. Рядом с манифестом плагина из
реестра появляется файл `.tessera-origin.json`. Папку, положенную вручную, CLI без
`--force` не перезапишет.

`TESSERA_REGISTRY_URL` переопределяет адрес реестра: `https://`, `file://` или
локальный путь. Локальный путь удобен, чтобы проверить реестр до публикации.

Раздача на сервере:

- **dev** (`npm run dev`): middleware в `vite.config.ts` отдаёт `extensions/` на
  `/extensions/...` с чтением диска на каждый запрос и `Cache-Control: no-cache`
  для `.json` и `.js`.
- **prod**: nginx-блок `location /extensions/ { alias <каталог проекта>/extensions/; … }`
  с отключённым кэшированием (его настраивает `deploy/install.sh`).

Кэширование: `index.json`, `manifest.json` и неименованные (без хеша) `entry` —
`no-cache`. Файлы с хешами в имени (`index-3f9a1c.js`) можно кэшировать
`immutable`. Пока для `index.js` без хеша кэш выключен, браузер получит свежий
код при следующей загрузке страницы.

---

## Discovery: каталог

`extensions/index.json` — **статический** массив, который генерирует скрипт:

```bash
node tools/extensions-sync.cjs
```

Скрипт обходит `extensions/*/manifest.json` и записывает:

```json
[
  {
    "id": "acme/hello",
    "name": "Hello",
    "version": "1.0.0",
    "manifestUrl": "/extensions/hello/manifest.json",
    "icon": "optional",
    "description": "optional",
    "origin": "registry",
    "sha256": "…"
  }
]
```

`origin` равен `registry` у плагинов, установленных через `tools/tessera-ext.cjs`
(в каталоге у них бейдж *Проверен*), и `local` у папок, положенных вручную. Папки,
имя которых начинается с `.`, пропускаются.

Папки без `manifest.json` пропускаются с предупреждением; ошибки разбора
манифеста логируются, остальные плагины всё равно попадают в каталог.

Запускайте скрипт **после добавления плагина** и при смене его `name`/`version`.
Правки кода плагина без смены версии перегенерации не требуют.

Каталог — удобство discovery, не источник истины для загрузки: плагин, которого
нет в `index.json`, всё равно можно установить по URL.

---

## Установка пользователем

### Из каталога

Settings → Plugins → **Refresh** (перечитывает `index.json` без кэша) →
**Install**. Для каждой записи показывается состояние:

| Состояние | Условие |
|---|---|
| не установлен | нет записи в `mpu:v2:plugins` |
| установлен | запись есть, версия совпадает с каталогом (или не записана) |
| доступно обновление | `installedVersion` ≠ версия в каталоге |

При установке можно ограничить плагин набором принтеров (`printerIds`);
пустой список — все принтеры.

### По URL (advanced)

Settings → Plugins → **Add by URL (advanced)**: хост загружает манифест по
адресу, показывает превью (`id`, `name`, `version`) и предупреждение о доверии
(плагин получает полный доступ к Moonraker). Запись получает бейдж *external*.

Для адреса с другого origin сервер плагина должен отдавать **CORS** (и для
манифеста, и для модуля). Для плагинов из `extensions/` (тот же origin) CORS не
нужен.

По умолчанию `deploy/install.sh` **запрещает** этот режим на сервере. nginx отдаёт
`Content-Security-Policy: script-src 'self'`, и браузер не импортирует модуль с
чужого origin. Ещё установщик пишет `/extensions/policy.json`
(`{ "allowRemotePlugins": false }`), и UI прячет кнопку. Если `policy.json` нет
(dev-сервер, ручная настройка), кнопка видна.

Настройка меняется в меню установщика: `tessera` → **S) Settings** →
**2) Plugins by URL**. Пересборка не нужна: установщик перепишет `policy.json`,
переключит CSP в конфиге nginx и перезагрузит nginx. После этого обновите страницу
UI. Без меню: `TESSERA_ALLOW_REMOTE_PLUGINS=1 bash ~/tessera/deploy/install.sh --plugins-policy`.

### Обновление

Кнопка **Update** — горячая перезагрузка манифеста без F5. Что она *не* делает:
не перезагружает уже импортированный модуль (браузер кэширует `import()`
по URL) и не переопределяет Custom Elements. Если изменился код, нужен **F5**
(или новое имя файла с хешем); после обновления UI показывает плашку
**Перезагрузить**. Подробнее — в
[plugin-development.md](plugin-development.md#чего-не-происходит-при-update).

### Выключение и удаление

Выключатель в списке установленных плагинов снимает вклады и гарды без
удаления записи; удаление убирает запись из `mpu:v2:plugins`. Core-плагин
`@core/system` закреплён (*pinned*): его нельзя отключить или удалить.

---

## Безопасность и доверие

- У плагина **полный** доступ к `api.moonraker()` (в том числе к G-code и
  отключению питания): рантайм-песочницы и гранулярных разрешений нет.
  Устанавливайте только то, чему доверяете. Для install-по-URL хост требует
  явного подтверждения.
- Плагин исполняется в контексте страницы хоста: он видит `localStorage` своего
  origin (включая токены авторизации Moonraker). Ставьте плагины только из
  доверенных источников.
- Целостность проверяется **при доставке**: `tools/tessera-ext.cjs` сверяет каждый
  архив с sha256 из `registry.json`. Доверие к плагину из реестра держится на ревью
  его исходников в репозитории-реестре и на сборке в CI. Браузер хеши повторно не
  проверяет, а плагины, установленные по URL, не проверяются вовсе.
- CSP, который выставляет `install.sh` (см. «По URL»), — серверный барьер против
  чужих скриптов. Диалог подтверждения в UI барьером не является.
- Гарды — удобство и защита от ошибок пользователя в UI, а не граница безопасности.

---

## Установка хоста: `deploy/install.sh`

Скрипт для Armbian/Debian: клонирует репозиторий, собирает хост, настраивает
nginx (включая `/extensions/` и проксирование WebSocket) и, при желании,
конфиги Klipper. Он запускается как меню в стиле kiauh:

```bash
curl -fsSL https://raw.githubusercontent.com/idex-eclipse/tessera/main/deploy/install.sh \
  -o /tmp/tessera-install.sh && bash /tmp/tessera-install.sh
```

После установки то же меню открывает команда `tessera`.

| Пункт | Что делает |
|---|---|
| **1) Install** | спрашивает каталог, порт nginx, адрес Moonraker, каталог конфигов Klipper; ставит зависимости, клонирует, собирает, настраивает nginx и Klipper, создаёт команды `tessera` и `tessera-ext` |
| **2) Update** | показывает установленный коммит и последний коммит ветки на GitHub. *Update Tessera* — fetch → сборка → nginx → конфиг Klipper, без вопросов. *Rebuild only* — пересборка без обновления исходников |
| **3) Remove** | показывает, что будет удалено, и просит подтверждения: сайт nginx и его логи, `[include tessera-shell.cfg]` из `printer.cfg` (резервная копия — `printer.cfg.tessera-bak`) и `tessera-shell.cfg`, команды `tessera`/`tessera-ext`, каталог установки, `install.conf`. Установленные расширения можно сохранить — они переносятся в `~/tessera-extensions-backup`. nginx, Node.js, git и графики `shapers/` не удаляются |
| **S) Settings** | ветка (список веток с GitHub; после смены предлагается Update) и плагины по URL (применяется сразу, без пересборки) |
| **E) Extensions** | менеджер расширений `tessera-ext` |

Навигация как в kiauh: буква или цифра, затем Enter. Каждое действие выполняется
отдельно: ошибка завершает действие и возвращает в меню.

Настройки хранятся в `~/.config/tessera/install.conf` (`KEY=value`). Update берёт
их оттуда и ничего не спрашивает. Если файла нет (установка, сделанная до появления
меню), значения определяются по системе: ветка — по git, порт и Moonraker — по
конфигу nginx, плагины по URL — по `policy.json`.

Без меню (скрипты, CI):

```bash
bash install.sh install | update | rebuild | remove | extensions
TESSERA_NO_PROMPT=1 bash install.sh      # без терминала и вопросов: установка или обновление
```

Переменные окружения имеют приоритет над `install.conf`:

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `TESSERA_DIR` | `~/tessera` | каталог установки (внутри — `extensions/`) |
| `TESSERA_BRANCH` | `main` | ветка |
| `TESSERA_PORT` | `8000` | порт nginx |
| `TESSERA_MOONRAKER` | `127.0.0.1:7125` | адрес Moonraker |
| `TESSERA_KLIPPER_CFG` | `~/printer_data/config` | каталог конфигов Klipper |
| `TESSERA_SKIP_NGINX` | `0` | не настраивать nginx |
| `TESSERA_NO_PROMPT` | `0` | не задавать вопросов |
| `TESSERA_ALLOW_REMOTE_PLUGINS` | прежний выбор (при первой установке `0`) | `1` — разрешить установку по URL (без CSP); `0` — только `/extensions/` |

Скрипт не запускается от root. При каждой установке и обновлении он пересобирает
`extensions/index.json`. Подробности — в самом `deploy/install.sh`.

---

## Чек-лист публикации плагина

1. Собрать (`vite build`): один ES-модуль, имя = `manifest.entry`, зависимости
   внутри, `process.env.NODE_ENV` определён.
2. Положить `manifest.json` + собранные файлы в `extensions/<имя>/`.
3. Увеличить `version`.
4. `node tools/extensions-sync.cjs`.
5. Settings → Plugins → Refresh → Install / Update.
6. F5, если менялся код.
7. Проверить обе темы, оба языка, offline, *Klippy not ready*.

### Публикация в реестр

CI реестра (или автор локально) упаковывает папку собранного плагина:

```bash
node tools/registry-pack.cjs path/to/built-plugin --dir hello \
  --url-base https://github.com/<org>/tessera-ext/releases/download/hello-1.2.0 \
  --out registry/
```

Скрипт кладёт `registry/hello-<version>.tar.gz` и добавляет или заменяет запись
плагина в `registry/registry.json`:

```json
{ "schema": 1, "plugins": [ {
  "id": "acme/hello", "dir": "hello", "name": "Hello", "version": "1.2.0",
  "pluginApi": 1, "url": "https://…/hello-1.2.0.tar.gz",
  "sha256": "…", "size": 12345, "description": "…" } ] }
```

Архив воспроизводим: записи отсортированы, время и владелец обнулены, в заголовке
gzip нет времени. Любой может пересобрать плагин из проверенного коммита и получить
тот же sha256. `--url-base .` оставляет URL архивов относительными к
`registry.json`.

Рекомендуемый процесс в реестре: автор присылает PR, в котором закреплён коммит его
исходников; ревьюер читает diff; после merge CI делает checkout этого коммита,
собирает, запускает `registry-pack.cjs`, выкладывает архив как release asset и
коммитит `registry.json`.
