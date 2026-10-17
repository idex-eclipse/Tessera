<p align="center">
  <a href="./README.md">English</a> · <strong>Русский</strong>
</p>

<p align="center">
  <img src="host/public/logo.svg" width="128" alt="Изометрический тессеракт" />
</p>

<h1 align="center" id="top">Tessera</h1>

<p align="center">
  <strong>Модульный веб-UI для 3D-принтеров Klipper / Moonraker.</strong><br/>
  Плагинный дашборд: хост оркестрирует, плагины вносят плитки,<br/>
  и всё, что вы видите, — мозаика независимых поверхностей, считываемых одним взглядом.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Лицензия: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" /></a>
  <img alt="Svelte 5" src="https://img.shields.io/badge/svelte-5-ff3e00.svg" />
  <img alt="Vite" src="https://img.shields.io/badge/vite-5-646cff.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6.svg" />
  <img alt="Без бэкенда" src="https://img.shields.io/badge/backend-none-informational.svg" />
  <img alt="Версия" src="https://img.shields.io/badge/version-0.2.0--beta-orange.svg" />
</p>

---

> *Прочтите это первым: я не программист и не фронтенд-разработчик. Tessera целиком собрана с помощью ИИ. Ожидайте шероховатостей, нестандартных решений и изредка багов, с которыми я ещё не сталкивался. Issues и pull requests искренне приветствуются; если что-то выглядит странно, обычно рядом на пару файлов есть задокументированная причина.*

---

## Оглавление

- [Tessera](#top)
- [Возможности](#features)
  - [Дашборд и виджеты](#dashboard-widgets)
  - [Полоса чипов быстрого доступа](#quick-access-chip-strip)
  - [Калибровочный набор](#calibration-suite)
  - [Файлы, редактор, превью](#files-editor-preview)
  - [Система и уведомления](#system-notifications)
  - [Консоль](#console)
  - [Мультипринтерность и персонализация](#multi-printer-personalization)
- [Требования](#requirements)
- [Установка](#installation)
  - [One-liner (Armbian / Debian)](#installer-one-liner)
  - [Вручную / разработка](#manual-development)
  - [Первый запуск](#first-launch)
- [Для разработчиков](#for-developers)
  - [Архитектура одним абзацем](#architecture)
  - [Модель плагинов](#plugin-model)
  - [Гарды](#guards)
  - [Remote-плагины и доставка](#remote-plugins-delivery)
  - [Где живут настройки](#where-settings-live)
  - [Структура проекта](#project-structure)
- [Лицензия](#licensing)
- [Благодарности](#acknowledgments)

---

Tessera — это браузерная панель управления для принтеров Klipper. Она общается с Moonraker напрямую через один WebSocket на принтер, хранит все ваши предпочтения в `localStorage` и **не имеет собственного бэкенда** — на хосте принтера работают Klipper и Moonraker, а Tessera просто красиво их отрисовывает.

UI собран из **плагинов**: хост предоставляет оболочку (вкладки принтеров, сайдбар, дашборд-грид, страницу Settings, тему, локаль, постоянные поверхности), а каждый функциональный блок — графики температур, макросы, калибровочные визарды, файловые таблицы — это вклад плагина. Сторонние плагины — полноценные граждане: они загружаются как Custom
Elements и могут быть написаны на **любом фреймворке**.

<a id="features"></a>
## Возможности

<a id="dashboard-widgets"></a>
### Дашборд и виджеты

Drag-and-drop грид автономных виджетов, раскладываемый per-printer:

- **Температура** — живой график нескольких нагревателей (текущая / цель / мощность), чипы по сенсору, клик для изоляции серии
- **Статус** — прогресс печати, слой и ETA, пауза / возобновление / отмена, коэффициенты скорости и потока
- **Макросы** — кнопки с автоматическими формами параметров, распарсенными из тел макросов (дефолты предзаполнены, обязательные поля помечены)
- **Инструменты** — jog крест/строки, экструзия и ретракция, force move, motors off, режимы кареток IDEX (PRIMARY / COPY / MIRROR / экспериментальный DIRECT-mode из [форка Klipper для IDEX-принтеров Дмитрия Бютюгина](https://github.com/dmbutyugin/klipper/tree/generic-cartesian)), подсветка активного тула
- **Лимиты** — скорость, ускорение и square-corner velocity на лету
- **Выходы** — слайдеры вентиляторов и управление output-пинами (PWM и digital), плюс read-only индикаторы авто-вентиляторов Klipper (heater_fan / controller_fan / temperature_fan)
- **Камера** — живые MJPEG/HLS виды, несколько потоков
- **Филамент** — статус датчика окончания филамента и его включение/выключение
- **Очередь заданий** — переупорядочивание, запуск, управление queued-печатью

Каждый виджет автономен по данным: он сам подписывается на прокси, поэтому два виджета
никогда не делят скрытый канал, а сломанный плагин не уронит остальной UI.

<a id="quick-access-chip-strip"></a>
### Полоса чипов быстрого доступа

Постоянная полоса под баннерами держит самые срочные контролы в один тап на **каждой
странице** — посреди печати, на экране заданий, в настройках:

- **Чипы температур** — текущее значение, бейдж цели, тренд нагрева/остывания, тап для установки температуры через поповер с пресетами
- **Чипы макросов** — запуск мгновенно или открытие формы параметров
- **Чипы выходов** — состояние вентилятора/пина с обратной связью вращения; пресет-кнопки (0/25/50/75/100 %) + тонкий слайдер
- **Чипы тюнинга** — pressure advance, ретракция, поток и коэффициент скорости с живым превью ровно того G-code, который будет отправлен
- **Чип Live Z** — пошаговая подстройка живого Z-offset (0.01–0.1 мм), запекание в probe, сохранение в конфиг
- **Чипы филамента** — detected / empty / off с одного взгляда, переключение из поповера
- **Чипы питания** — power-устройства Moonraker, **тап по самому чипу переключает** (свет, питание принтера, вентилятор корпуса) — работает даже когда Klipper не ready и уважает серверную блокировку `locked_while_printing`

Чипы переживают навигацию и переключения принтера. В edit-режиме дашборда вы добавляете их из аккордеон-пикеров по провайдерам; удалённые или переименованные устройства показывают явное состояние *unavailable* вместо тихого распада.

<p align="left">
  <img src="docs/screenshots/Dashboard.png" alt="Дашборд" width="40%"/>
  <img src="docs/screenshots/Dashboard2.png" alt="Дашборд" width="40%"/>
</p>

<a id="calibration-suite"></a>
### Калибровочный набор

Одна страница, четыре таба, единый панельный язык — каждое действие показывает read-only превью формируемой G-code-строки и **отправляет ровно это превью**:

- **Input shaper** — `TEST_RESONANCES` / `SHAPER_CALIBRATE` с живыми считываниями fitted/recommended, таблица прогонов с apply-to-config и опциональный пайплайн shell-команд, рендерящий графики резонанса PNG прямо в вашу папку конфига
- **Натяжение ремней** — авто-детект по кинематике (CoreXY / Delta / generic cartesian), сравнительный график за один прогон
- **Probe и Z offset** — авто-детект типа probes (eddy current / probe / bltouch / endstop), визард калибровки, таблица прогонов accuracy, оверлей ручного зондирования, выбор мульти-чип eddy
- **Нагреватели (PID)** — автотюн с живым графиком температура/мощность, карточки Kp/Ki/Kd и монитор девиации, предупреждающий когда настроенный нагреватель дрейфует от цели
- **Сетка стола** — 2D heatmap и 3D поверхность с вертикальным преувеличением, управление профилями, инструменты Z-tilt / QGL / screws-tilt, оверлей уточнения TEST_Z

Долгие калибровки переживают переключения таба и принтера — активность отслеживается из g-code store Moonraker, поэтому тюнинг, начатый в другом клиенте, виден и здесь.

<p align="left">
  <img src="docs/screenshots/Calib1.png" alt="Секция Probe" width="40%"/>
  <img src="docs/screenshots/Calib2.png" alt="Секция нагревателей" width="40%"/>
</p>

<a id="files-editor-preview"></a>
### Файлы, редактор, превью

- **Универсальная файловая таблица** для jobs / config / logs: расширенные метаданные G-code (филамент, время, превью, статусы printed/queued), менеджер колонок с drag-переупорядочиванием, per-printer сортировка и колонки, контекстные меню
- **3MF-инспектор** — открывайте проекты OrcaSlicer / Bambu-lineage прямо в браузере: осмотр плит, сводки срезов и слоты филамента, превью, и **извлечение встроенного G-code** для печати (сырой `.3mf` никогда не загружается в Moonraker)
- **Редактор конфига и G-code** — полноэкранный редактор с подсветкой Klipper-конфига и G-code, подсветкой Jinja, оглавлением секций, собственным поиском/заменой (хоткеи не зависят от раскладки), номерами строк, автопарами и *Save & Restart* для `.cfg` / `moonraker.conf`
- **Превью G-code** — 2D и 3D (three.js) вьюеры с живым оверлеем прогресса печати, скраббингом слоёв, режимом **follow-print** и **exclude object** (необратимо, с подтверждением и 3D-маркерами клетки)

<p align="left">
  <img src="docs/screenshots/3MF.png" alt="Диалог загрузки 3MF" width="40%"/>
</p>

<a id="system-notifications"></a>
### Система и уведомления

- **Правая панель** (всегда доступна): аварийный стоп, рестарты сервисов, power-устройства, выключение/перезагрузка хоста, загрузка-и-печать, аккаунты Moonraker
- **Центр уведомлений** — тосты + фильтруемая боковая панель, питаемая ответами Klipper, shutdown'ами, **флагами драйверов TMC** (перегрев / stall, edge-детект), отказами гардов и уведомлениями плагинов (конвенция `M118 MPU_NOTIFY …`)
- **Страница машины** — статистика CPU / памяти / сети, живые графики нагрузки, инвентарь и версии MCU, менеджер обновлений с историей коммитов и откатом
- **Баннер состояния Klipper** — отличается от статуса соединения: ошибки прошивки и запуск показываются там, где им место

<a id="console"></a>
### Консоль

View над g-code store Moonraker с автодополнением команд (включая **режим параметров макросов**: наберите `MACRO ` и получите подсказки `NAME=` с типами и дефолтами), встроенным каталогом G/M-команд с сигнатурами параметров, regex-фильтрами сообщений и настройками reverse/autoscroll.

<p align="left">
  <img src="docs/screenshots/Console.png" alt="Консоль" width="40%"/>
</p>

<a id="multi-printer-personalization"></a>
### Мультипринтерность и персонализация

- **Вкладки принтеров** с per-printer layout дашборда, полосой чипов, провайдерами виджетов, видимостью страниц и настройками плагинов
- **Fleet mode** — нажмите кнопку-сетку под вкладками, чтобы выдвинуть drawer, показывающий камеру, статус печати, положение головы и температуры каждого принтера в живой карточной сетке. Каждая карточка read-only и общается со своим принтером; нажмите **Активировать**, чтобы перейти на дашборд этого принтера. Панели вносятся плагинами (`printerPanels` в манифесте), поэтому сторонние плагины могут добавлять свои карточки парка.
- **Offline overlay** — только инфраструктурный (никогда не читает бизнес-данные); вы можете переключать принтеры, не закрывая его
- **Синхронизация настроек** — opt-in per-plugin, device-global
- **Темы** — светлая и тёмная, каждый цвет CSS-переменная; кастомизация акцента и фоновые картинки на роадмапе
- **i18n** — английский и русский, RTL-ready layout

<a id="requirements"></a>
## Требования

- **Klipper** + **Moonraker** на хосте принтера (свежие версии; Moonraker с API файлов, обновлений и device-power)
- Современный evergreen-браузер (Custom Elements, ES modules, `DecompressionStream` для 3MF)
- Node.js ≥ 18 только если собираете из исходников (инсталлятор обрабатывает это сам)

Опциональные компаньоны:

| Компонент | Включает |
|---|---|
| расширение Klipper `gcode_shell_command` | графики shaper / belt PNG (установка вручную через kiauh) |
| crowsnest / mjpegstreamer / ustreamer | виджеты камеры |
| Spoolman (через Moonraker) | плагин катушек филамента (отдельный remote-плагин, в разработке) |

<a id="installation"></a>
## Установка

<a id="installer-one-liner"></a>
### One-liner (Armbian / Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/idex-eclipse/tessera/main/deploy/install.sh \
  -o /tmp/tessera-install.sh && bash /tmp/tessera-install.sh
```

Инсталлятор **идемпотентен** — повторный запуск обновляет всё на месте. Он:

1. установит системные зависимости (`git`, `curl`, `nginx`) и Node.js 20 при отсутствии;
2. склонирует (или обновит) репозиторий в `~/tessera` и соберёт фронтенд;
3. напишет nginx-site (`sites-available/tessera` + symlink в `sites-enabled`) по образцу kiauh/fluidd: SPA-fallback, no-cache `index.html`, gzip, безлимитный размер загрузки, `location /extensions/` для provision-а плагинов и reverse-прокси `/websocket` + `/printer|api|access|machine|server/` на Moonraker — поэтому UI **same-origin с Moonraker и не требует изменений в `moonraker.conf`**;
4. создаст `tessera-shell.cfg` (shell-команды графиков shaper/belt) в вашей папке конфига Klipper и включит его в `printer.cfg` **только если** расширение `gcode_shell_command` обнаружено — иначе напечатает инструкции ручной установки kiauh и оставит include вне конфига, поэтому отсутствующее расширение никогда не уронит ваш конфиг при рестарте;
5. напомнит сделать `FIRMWARE_RESTART`, когда будете готовы.

<details>
<summary><strong>Конфигурация инсталлятора (env-переменные / промпты)</strong></summary>

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `TESSERA_DIR` | `~/tessera` | директория clone + build + extensions |
| `TESSERA_PORT` | `8080` | порт nginx для UI (спрашивается, переспрашивается при конфликте) |
| `TESSERA_REPO` / `TESSERA_BRANCH` | repo / `main` | форки и dev-каналы |
| `TESSERA_MOONRAKER` | `127.0.0.1:7125` | Moonraker upstream для прокси |
| `TESSERA_KLIPPER_CFG` | `~/printer_data/config` | директория конфига Klipper (multi-instance kiauh aware) |
| `TESSERA_KLIPPER_DIR` | `~/klipper` | используется для детекта `gcode_shell_command` |
| `TESSERA_SKIP_NGINX=1` | off | используйте свой reverse-прокси |
| `TESSERA_SKIP_KLIPPER_CFG=1` | off | только web UI, не трогать конфиг Klipper |
| `TESSERA_NO_PROMPT=1` | off | полностью неинтерактивно (CI) |

Удаление: уберите symlink `sites-enabled/tessera`, строку `[include tessera-shell.cfg]`
из `printer.cfg` и `~/tessera`.

</details>

<a id="manual-development"></a>
### Вручную / для разработки

```bash
git clone https://github.com/idex-eclipse/tessera.git
cd tessera
npm install
npm run dev        # vite dev server + /extensions/ middleware
npm run build      # production bundle → host/dist
npm run check      # svelte-check + tsc
npm run test       # vitest
```

Раздавайте `host/dist` любым статическим сервером и реверс-проксируйте API и WebSocket
Moonraker на тот же origin (см. `deploy/install.sh` для эталонной nginx-конфигурации).

<a id="first-launch"></a>
### Первый запуск

1. Откройте `http://<printer-host>:8080`.
2. Нажмите **[+]** во вкладках принтеров и введите URL Moonraker.
3. Tessera подключается и подсвечивает только те виджеты, чипы и страницы, которые реально есть у вашего принтера — feature-detection per printer.

<a id="for-developers"></a>
## Для разработчиков

<a id="architecture"></a>
### Архитектура одним абзацем

**Хост** — намеренно тупой оркестратор: вкладки принтеров, сайдбар, дашборд-грид, настройки, тема, локаль и постоянные поверхности (баннеры, полоса чипов, оверлеи, правая панель). Он никогда не парсит протокол Moonraker и никогда не читает бизнес-данные, чтобы отрисовать свой chrome. **MoonrakerProxy** пулит один WebSocket на принтер с snapshot-кэшированием, дедупликацией подписок и poll-on-demand. **GuardAgent** оборачивает каждый плагинский `request()` в декларативный префлайт-конвейер. **Плагины** — автономные вклады: страницы, виджеты, чипы, оверлеи, баннеры, панели парка, — которые сами подписываются на прокси и никогда не общаются друг с другом. **SDK** — тонкий слой хуков. Бэкенда нет, общей шины состояния нет, канала плагин↔плагин нет — по проекту.

<a id="plugin-model"></a>
### Модель плагинов

Плагины вносят через манифест:

```ts
interface PluginManifest {
  id: string; name: string; version: string; entry: string;
  pages?: PageContribution[];        // sidebar entries, receive route query as params
  widgets?: WidgetContribution[];    // dashboard tiles (+ optional headerElement)
  chips?: ChipContribution[];        // quick-access strip: element + pickerElement
  overlays?: OverlayContribution[];  // floating windows (visibility = plugin's call)
  banners?: BannerContribution[];    // in-flow blocks above main
  rightPanel?: RightPanelContribution; // unique slot — accepted from @core/system only
  printerPanels?: PrinterPanelContribution[]; // fleet cards: one instance per printer
  guards?: GuardContribution[];      // pre-flight request interception
  locales?: string[];
  defaultSettings?: Record<string, unknown>;
}
```

Поверхности рендерятся как **Custom Elements**; хост инжектит API плагина и params как
свойства (`mpuApi`, `mpuParams`). Core-плагины на Svelte 5 runes получают то же через context
внутри auto-wrap `defineMpuElement`; **remote-плагины могут быть написаны на ЛЮБОМ
фреймворке** — контракт = CE + property-инъекция (проверено боем на React 18-плагине).

API плагина даёт вам:

```ts
api.moonraker()             // guarded request(), subscribe(), onNotify(), poll(),
                            // httpBaseUrl for binary traffic, readyState, auth token

api.moonrakerFor(printerId) // same guarded handle, but bound to a specific printer
                            // (for fleet panels and multi-printer workflows)

api.settings                // namespaced get/set/onChange for the active printer
                            // (or device-global when sync is enabled)

api.settingsFor(printerId)  // same PluginSettingsApi, but scoped to a specific printer
                            // (for fleet panels that persist per-printer prefs)

api.i18n                    // t(key, params), live locale + dir
api.theme                   // current theme, onThemeChange
api.guards.resume(...)      // continue a frozen request chain
api.onPrinterChange / onLocaleChange / onThemeChange
```

**Printer panels** (`printerPanels`) — Custom Elements, рендерящиеся по одному экземпляру на
принтер, пока открыт fleet mode. Хост инжектит `mpuParams.printerId`; панель читает свои
данные через `api.moonrakerFor(printerId)` и персистит предпочтения через
`api.settingsFor(printerId)`. Каждый экземпляр панели изолирован — unmount одной карточки не
затрагивает другие, а закрытие drawer чисто срывает все подписки.

Core `@core/widgets` несёт четыре панели в 0.2.0:

- камера
- статус печати
- положение головы
- температуры

Сторонние плагины могут вносить свои панели парка по тому же контракту.

<a id="guards"></a>
### Гарды

Гарды — декларативные матчеры на **строку метода** запроса (например `printer.gcode.script`, `printer.print.start`). Хост строит цепочку из всех совпавших гардов минус гарды самого инициатора (анти-рекурсия), обходит её последовательно, и каждый обработчик возвращает `allow`, `deny` (с атрибуцией) или `freeze` — припаркованный запрос, который плагин-гард возобновляет через токен после показа своего оверлея. Таймауты fail-closed (10 с на решение, 10 мин на парковку) и всплывают в центре уведомлений. Гарды никогда не мутируют запросы, не имеют приоритетов сверх порядка регистрации и являются **префлайт-проверкой локальных действий, а не границей безопасности** — печати, начатые из других клиентов, для них невидимы по проекту.

<a id="remote-plugins-delivery"></a>
### Remote-плагины и доставка

Четыре слоя, никаких сетевых автообновлений — **файлы на диске источник истины** (аналог Klipper extras):

1. **Provisioning** — `extensions/<id>/` на хосте (dev: vite middleware; prod: nginx `location /extensions/`);
2. **Discovery** — same-origin каталог `/extensions/index.json`, регенерируемый `tools/extensions-sync.js`; плюс продвинутый режим *Add by URL* с подтверждением доверия и бейджем `external`;
3. **Loading** — fetch манифеста → резолв entry относительно origin МАНИФЕСТА → `import()` → слияние локалей → sanitize вкладов;
4. **Enablement** — включение per-printer, бейджи версий, горячий *Update* без перезагрузки.

Правила сборки remote-плагинов (vite lib-mode): определите `process.env.NODE_ENV`, держите
runtime-зависимости бандленными (bare-импорты не резолвятся в браузерном `import()`), и
держите `manifest.entry` синхронным с именем собранного файла.

<a id="where-settings-live"></a>
### Где живут настройки

Всё в `localStorage` под версионированным префиксом (`mpu:v2:*`): принтеры, активный принтер, установленные плагины, предпочтения UI (включая состояние fleet-mode), per-printer layout дашборда/страниц/чипов и настройки плагинов (per-printer или device-global). Изменения схемы показывают диалог export-or-reset — тихих миграций нет.

<a id="project-structure"></a>
<details>
<summary><strong>Структура проекта</strong></summary>

```
tessera/
├── host/src/
│   ├── core/        # proxy pool, guard agent, loader, registry, settings store, i18n
│   ├── pages/       # dashboard grid, settings sections
│   ├── components/  # layout, tabs, sidebar, slots, overlays/banners/chips hosts
│   ├── i18n/        # host locales (en, ru)
│   └── styles/      # global.css — the single source of theme variables
├── plugin-sdk/src/  # types, svelte hooks, define-plugin, CE define-element   (MIT)
├── plugins/
│   ├── shared/      # UI bricks + pure parsers (file table, editor, highlight,
│   │                #   macro-params, header-help, klippy-state, slider, color-picker,
│   │                #   3MF inspector, uPlot core) — never a data bus
│   ├── widgets-core/  # temperature, status, macros, tools, limits, outputs,
│   │                  #   camera, filament, job-queue + their chips + fleet panels
│   ├── calibrations/  # shaper / belts / probe / heaters / mesh + livez chip
│   ├── system/        # right panel, banner, notifications, machine page, power chip
│   └── console · jobs · history · config · gcode-preview
├── extensions/      # remote-plugin provisioning folder (index.json generated)
├── tools/           # extensions-sync.js, gen-favicon.mjs
├── deploy/          # install.sh, reference nginx config
└── docs/            # architecture, plugin development, proxy, settings
```

</details>

<a id="licensing"></a>
## Лицензия

- **GPL-3.0**. Форки и дистрибутивы (appliance-образы, предзагруженные коробки) должны оставаться открытыми. Это соответствует экосистеме Klipper/Moonraker.

<a id="acknowledgments"></a>
## Благодарности

Экосистемы прошивок/API [Klipper](https://www.klipper3d.org/) и
[Moonraker](https://github.com/Arksine/moonraker); [Mainsail](https://mainsail.xyz/) и
[Fluidd](https://fluidd.xyz/) за UX-вдохновение; [Svelte](https://svelte.dev/),
[Vite](https://vitejs.dev/), [uPlot](https://github.com/leeoniya/uPlot) и
[three.js](https://threejs.org/) под капотом.

---

<p align="center">
  <em>Tessera — модульный UI для модульных принтеров.</em>
</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>Русский</strong>
</p>