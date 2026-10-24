# Разработка remote-плагинов для Tessera

Это главное руководство. Оно написано по исходному коду хоста; там, где поведение
не очевидно или отличается от интуитивного, это сказано явно (см. раздел
[Подводные камни](#9-подводные-камни)). Остальные документы раскрывают детали:

| Документ | О чём |
|---|---|
| [architecture.md](architecture.md) | как устроен хост, роли, жизненный цикл, поток данных |
| [surfaces.md](surfaces.md) | справочник по каждой поверхности: страницы, виджеты, баннеры, оверлеи, чипы, fleet-панели, hotkeys |
| [plugin-api.md](plugin-api.md) | полный справочник `PluginApi` |
| [moonraker-proxy.md](moonraker-proxy.md) | работа с Moonraker: подписки, кэш, поллинг, ошибки, auth |
| [guards.md](guards.md) | GuardAgent: preflight-проверки запросов |
| [hotkeys.md](hotkeys.md) | горячие клавиши плагинов и хоста |
| [settings.md](settings.md) | настройки, localStorage, синхронизация |
| [i18n-and-theming.md](i18n-and-theming.md) | локализация и дизайн-система (CSS-переменные) |
| [deployment.md](deployment.md) | установка плагинов на сервер, каталог, кэширование |

---

## 1. Что такое плагин

Плагин — автономный вклад в интерфейс. Он состоит из двух частей:

1. **`manifest.json`** — статическое описание: идентификатор, версия, точка входа
   и список *вкладов* (страницы, виджеты, баннеры, …).
2. **ES-модуль (`entry`)** — JavaScript, который хост импортирует через `import()`.
   Модуль регистрирует **Custom Elements** (CE) — по одному на каждый вклад — и,
   при необходимости, экспортирует `locales`, обработчики гардов и hotkeys.

Хост ничего не знает о том, на каком фреймворке написан плагин. Контракт между
ними — это **Custom Element + два свойства** (`api` и `params`). Плагин на Svelte,
React, Vue, Lit или голом JavaScript выглядит для хоста одинаково.

Что плагин **может**:

- читать состояние принтера и вызывать методы Moonraker (`api.moonraker()`);
- хранить свои настройки (`api.settings`);
- показывать страницы, виджеты дашборда, баннеры, оверлеи, чипы быстрого доступа,
  панели fleet-режима;
- перехватывать запросы других плагинов гардами (`allow`/`deny`/`freeze`);
- регистрировать горячие клавиши;
- переводить свой интерфейс на языки хоста.

Чего плагин **не может** (намеренно):

- обмениваться сообщениями с другими плагинами — шины нет, общего состояния нет;
- занять правую панель (слот принадлежит только `@core/system`);
- менять запросы, проходящие через гарды (гарды только разрешают, запрещают или замораживают);
- читать чужие настройки.

Если двум плагинам нужны общие данные, каждый читает их из первоисточника —
из Moonraker/Klipper (например, из `save_variables`), а не друг у друга.

---

## 2. Быстрый старт: минимальный плагин без зависимостей

Чтобы увидеть, как всё работает, начнём с плагина-страницы на чистом JavaScript.

Структура каталога на сервере хоста (подробнее — [deployment.md](deployment.md)):

```
extensions/
└── hello/
    ├── manifest.json
    └── index.js
```

**`extensions/hello/manifest.json`**

```json
{
  "id": "acme/hello",
  "name": "Hello",
  "version": "1.0.0",
  "entry": "index.js",
  "locales": ["en", "ru"],
  "pages": [
    {
      "id": "acme-hello",
      "titleKey": "hello.title",
      "icon": "file",
      "element": "acme-hello-page"
    }
  ]
}
```

**`extensions/hello/index.js`**

```js
export const locales = {
  en: { hello: { title: 'Hello', greeting: 'Active printer: {name}' } },
  ru: { hello: { title: 'Привет', greeting: 'Активный принтер: {name}' } },
};

class HelloPage extends HTMLElement {
  #api = null;
  #params = {};
  #off = [];

  // Хост выставляет свойства ДО подключения элемента к DOM.
  set api(value) { this.#api = value; }
  get api() { return this.#api; }
  set params(value) { this.#params = value ?? {}; this.#render?.(); }
  get params() { return this.#params; }

  connectedCallback() {
    this.#render();
    // Живая смена принтера и языка.
    this.#off.push(this.#api.onPrinterChange(() => this.#render()));
    this.#off.push(this.#api.onLocaleChange(() => this.#render()));
  }

  disconnectedCallback() {
    for (const off of this.#off) off();
    this.#off = [];
  }

  #render = () => {
    const { t } = this.#api.i18n;

    const title = document.createElement('strong');
    title.textContent = t('hello.title');

    const text = document.createElement('p');
    text.textContent = t('hello.greeting', { name: this.#api.printer.name });

    const panel = document.createElement('section');
    panel.style.cssText =
      'padding: var(--space-md); background: var(--bg-surface);' +
      'border: 1px solid var(--border-color); border-radius: var(--radius-md);';
    panel.append(title, text);

    // textContent/append, а не innerHTML: имя принтера задаёт пользователь.
    this.replaceChildren(panel);
  };
}

// ОБЯЗАТЕЛЬНО проверять: define() с уже занятым тегом бросает исключение.
if (!customElements.get('acme-hello-page')) {
  customElements.define('acme-hello-page', HelloPage);
}
```

Дальше:

```bash
node tools/extensions-sync.cjs        # пересобрать extensions/index.json
```

Откройте **Settings → Plugins → Refresh**, нажмите **Install** у «Hello» —
в боковой панели появится страница «Hello». Установка и обновление описаны в
[deployment.md](deployment.md).

Что здесь важно:

- `entry` резолвится **относительно URL манифеста**, а не хоста и не принтера.
- Тег CE — глобальное пространство имён браузера: используйте префикс плагина
  (`acme-hello-page`), а не `hello-page`.
- Строки переводятся через `api.i18n.t`, ключи — внутри `locales` вашего модуля.
- Данные из Moonraker и пользовательский ввод (имя принтера, имена файлов, ответы
  консоли) вставляйте как текст (`textContent`), а не через `innerHTML`.
- Цвета и отступы — CSS-переменные темы (см. [i18n-and-theming.md](i18n-and-theming.md)).

---

## 3. Плагин на Svelte 5 (рекомендуемый путь)

Core-плагины хоста написаны на Svelte 5 (runes). Для remote-плагина на Svelte
используйте тот же SDK (`plugin-sdk/`): он умеет оборачивать Svelte-компонент
в Custom Element и раздаёт `api` через Svelte-контекст.

```ts
// src/index.ts
import { defineMpuElement } from '@sdk/element/define-element';
import HelloPage from './HelloPage.svelte';

export const locales = { /* ... */ };

defineMpuElement('acme-hello-page', HelloPage);
```

```svelte
<!-- src/HelloPage.svelte -->
<script lang="ts">
  import { usePluginApi, useI18n } from '@sdk/svelte';

  let { params }: { params: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = useI18n();
</script>

<section class="panel">{i18n.t('hello.title')}: {api.printer.name}</section>
```

`defineMpuElement(tag, Component)`:

- создаёт CE с сеттерами `api` / `params`;
- в `connectedCallback` монтирует компонент (`mount` из Svelte), в
  `disconnectedCallback` — размонтирует;
- в компонент передаёт проп `params`, а `api` кладёт в контекст (`usePluginApi()`);
- безопасно вызывается повторно: если тег уже зарегистрирован — ничего не делает.

Хуки SDK (`@sdk/svelte`):

| Хук | Возвращает |
|---|---|
| `usePluginApi()` | полный `PluginApi` (бросает ошибку вне контекста плагина) |
| `useMoonraker()` | `api.moonraker()` — handle **активного** принтера на момент вызова |
| `useI18n()` | `api.i18n` |
| `useWidget()` | то же, что `usePluginApi()` (для виджетов) |

> `useMoonraker()` возвращает handle активного принтера на момент вызова и
> не переключается сам. Для реакции на смену принтера подпишитесь на
> `api.onPrinterChange` и переподпишите свои подписки (или используйте
> `api.moonrakerFor(printerId)` с явным принтером).

### Сборка

Remote-плагин собирается в **один самодостаточный ES-модуль** (Vite, lib-mode).
Правила, которые легко нарушить:

```ts
// vite.config.ts плагина
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { '@sdk': '/path/to/tessera/plugin-sdk/src' } },
  // 1. ES-библиотеки не заменяют process.env.NODE_ENV сами → в браузере
  //    будет ReferenceError, если не определить явно.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      // 3. Имя файла должно совпадать с "entry" в manifest.json.
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    // 2. НЕ выносить зависимости в external: «голые» импорты
    //    (import 'svelte') браузер не резолвит.
    rollupOptions: { external: [] },
  },
});
```

1. Определить `process.env.NODE_ENV`.
2. Ничего не делать `external` — всё вкладывается в бандл.
3. Имя выходного файла = `manifest.entry`.

Результат (`dist/index.js` + `manifest.json`) копируется в `extensions/<имя>/`.

Плагин на другом фреймворке собирается так же; требования те же: один ES-модуль,
CE зарегистрированы при импорте, зависимости внутри бандла.

---

## 4. Контракт Custom Element

Хост создаёт элемент и **до** добавления в DOM выставляет два свойства:

```ts
const el = document.createElement(tag);
el.api = pluginApi;      // PluginApi плагина-владельца
el.params = params;      // Record<string, string>
hostContainer.appendChild(el);
```

Параметры дополнительно дублируются в `dataset` элемента
(`params.chipId` → `data-chip-id`).

### Что гарантирует хост

- `api` и `params` выставлены к моменту `connectedCallback`.
- `api` стабилен, пока не сменится манифест плагина. Если хост заменяет `api`
  или тег — элемент **пересоздаётся**, а не получает новый `api` на лету.
- `params` могут обновляться на живом элементе (например, меняется
  query-строка страницы): хост просто присваивает `el.params = новыйОбъект`
  и обновляет `dataset`. Событие об этом не диспатчится.
- Все `params` — строки (`Record<string, string>`). Структурированные данные
  передаются как JSON-строка (например, `placed` у picker'а чипов).

### Что делает плагин

- Реагирует на смену `params`, реализовав сеттер `params` (как в примере выше).
  Враппер `defineMpuElement` **не** пробрасывает такие изменения в Svelte-компонент
  реактивно — см. [Подводные камни](#9-подводные-камни).
- Освобождает подписки в `disconnectedCallback`. Хост может размонтировать
  элемент в любой момент (смена маршрута, закрытие fleet, переключение вкладки).
- Не рассчитывает, что элемент живёт всё время: стейт, который должен
  пережить размонтирование, хранится на уровне модуля (module-state) или в
  `api.settings`.

### Какие `params` получает каждая поверхность

| Поверхность | Элемент | `params` |
|---|---|---|
| Страница (`pages[].element`) | страница | query-параметры маршрута (`#/p/<printer>/<page>?file=a.gcode` → `{ file: 'a.gcode' }`) |
| Виджет (`widgets[].element`) | тело виджета | query-параметры маршрута дашборда (`edit`, `preview`, …) |
| Шапка виджета (`widgets[].headerElement`) | кнопки в шапке | `{}` |
| Баннер (`banners[]`) | баннер | `{ mode: 'expanded' \| 'collapsed', route: 'dashboard' \| 'plugin-page' \| 'settings' }` |
| Оверлей (`overlays[]`) | оверлей | `{}` |
| Чип (`chips[].element`) | чип | `{ chipId, chipLabel?, edit: '1' \| '0' }` |
| Picker чипа (`chips[].pickerElement`) | каталог предметов | `{ edit: '1', placed: '<JSON-массив id>' }` |
| Fleet-панель (`printerPanels[]`) | карточка принтера | `{ printerId }` |
| Hotkey (`hotkeys[]`) | — (функция, не элемент) | см. [hotkeys.md](hotkeys.md) |

Подробнее по каждой поверхности — в [surfaces.md](surfaces.md).

---

## 5. Манифест

```ts
interface PluginManifest {
  id: string;            // обязательно, уникальный
  name: string;          // обязательно, отображаемое имя
  version: string;       // обязательно, строка (сравнивается как строка!)
  entry: string;         // обязательно, путь к ES-модулю относительно манифеста

  pages?: PageContribution[];
  widgets?: WidgetContribution[];
  overlays?: OverlayContribution[];
  banners?: BannerContribution[];
  chips?: ChipContribution[];
  printerPanels?: PrinterPanelContribution[];
  hotkeys?: HotkeyContribution[];
  guards?: GuardContribution[];

  rightPanel?: RightPanelContribution; // принимается ТОЛЬКО от '@core/system'

  locales?: string[];                  // декларация, не сами переводы
  defaultSettings?: Record<string, unknown>; // см. подводные камни
}
```

Хост проверяет только четыре обязательных поля (`id`, `name`, `version`,
`entry` — непустые строки). Остальное санитайзится при загрузке: **невалидный
вклад отбрасывается с предупреждением в консоль**, плагин при этом загружается.
Что считается невалидным:

| Вклад | Обязательные непустые строки |
|---|---|
| `overlays[]`, `banners[]`, `printerPanels[]` | `id`, `element` |
| `chips[]` | `type`, `provider`, `titleKey`, `element`, `pickerElement` |
| `hotkeys[]` | `id`, `keys`, `handler`; `scope` ∈ `global`/`dashboard`/`plugin`; `keys` должен разбираться |
| `pages[]`, `widgets[]` | не валидируются структурно (но без `element` ничего не отрисуется) |

Если значение `overlays`/`banners`/`chips`/`printerPanels`/`hotkeys` — не
массив, оно сбрасывается.

### Идентификатор плагина

- Любая непустая строка. У core-плагинов — `@core/…`; для сторонних используйте
  собственный префикс (`acme/hello`), чтобы не пересечься с core.
- По `id` хранятся настройки плагина, привязаны гарды и hotkeys, строятся
  ключи настроек (`mpu:v2:plugin-settings:<printerId>:<pluginId>`).
- Смена `id` = новый плагин: настройки старого не перенесутся.

### Иконки страниц

Поле `icon` у страницы — имя встроенной иконки хоста (`dashboard`, `settings`,
`printer`, `globe`, `sun`, `moon`, `plus`, `keyboard`, …; для неизвестного имени
показывается иконка «файл»). Своя иконка задаётся двумя способами:

- `iconSvg` прямо в манифесте — строка с SVG-разметкой;
- экспорт модуля `pageIcons: Record<string, string>` — загрузчик подставит
  `pageIcons[page.icon]` в `iconSvg`, если тот не задан.

### Уникальность id страниц

Страница ищется по `id` **среди всех плагинов**, а видимость страницы
хранится по голому `id`. Две страницы с одинаковым `id` у разных плагинов
конфликтуют. Используйте префикс плагина: `acme-hello`, а не `hello`.

### Версионирование

`version` — произвольная строка. Каталог сравнивает версию **на равенство**
(`installedVersion !== catalogVersion` → «доступно обновление»), а не по semver.
Увеличивайте версию при каждом релизе.

---

## 6. Жизненный цикл плагина

1. **Старт хоста.** Для всех включённых remote-плагинов (`mpu:v2:plugins`):
   `fetch(manifestUrl)` → валидация → `import(entry)` (URL резолвится относительно
   манифеста) → слияние `locales` в i18n хоста → санитайз вкладов →
   регистрация в реестре → регистрация гардов. Сбой одного плагина логируется
   и **не блокирует** остальные.
2. **Работа.** Модуль импортирован один раз за сессию. CE создаются хостом по
   мере появления поверхностей на экране (страница открыта, виджет на дашборде,
   баннер в потоке, …) и уничтожаются при уходе с них.
3. **Выключение** (Settings → Plugins → выключатель): вклады и гарды снимаются
   из реестра; уже смонтированные элементы уходят вместе с поверхностями.
   Модуль остаётся в памяти браузера.
4. **Удаление:** то же + запись удаляется из `mpu:v2:plugins`.
5. **Update:** «горячая» перезагрузка манифеста без F5 (`reloadRemotePlugin`):
   удаление + повторная установка с теми же настройками.

Плагины с постоянными поверхностями (оверлеи, баннеры, чипы, fleet-панели,
hotkeys) в принципе не требуют «активации по посещению страницы»: модуль
загружается на старте, и их вклады работают сразу.

### Чего не происходит при Update

- **Код модуля не перезагружается.** `import()` кэшируется браузером по URL.
  Если файл `index.js` изменился, а имя нет, до F5 работает старый код.
  Для быстрой итерации используйте хешированные имена файлов или F5.
- **Custom Elements не переопределяются.** `customElements.define` на занятый
  тег бросает ошибку, а переопределить элемент нельзя в принципе. Именно
  поэтому регистрацию нужно оборачивать в `if (!customElements.get(tag))`.
- **Строки локализации не удаляются** при удалении плагина до F5.

---

## 7. Контекст приложения вокруг плагина

Что полезно знать при проектировании:

- **Несколько принтеров.** Хост держит вкладки принтеров; в каждый момент один
  принтер *активный*. Переключение вкладки **не рвёт** соединения: прокси
  остаются жить. Плагин, которому нужен конкретный принтер независимо от
  вкладки (fleet-режим), использует `moonrakerFor(id)` / `settingsFor(id)`.
- **Область применения плагина.** В записи плагина (`mpu:v2:plugins`) есть
  `printerIds`: пустой список — плагин на всех принтерах; непустой — только на
  перечисленных. Хост учитывает это **только для чипов и hotkeys**; страницы,
  виджеты, баннеры, оверлеи и fleet-панели по `printerIds` не фильтруются.
- **Тема и язык меняются на лету.** Подпишитесь на `onThemeChange` /
  `onLocaleChange` или читайте CSS-переменные (меняются сами) и перерисуйте
  тексты по событию языка.
- **RTL.** Хост ставит `dir` на `<html>`; используйте логические CSS-свойства
  (`margin-inline-start` вместо `margin-left`).
- **Offline.** Если активный принтер недоступен, хост показывает поверх
  интерфейса оверлей соединения; ваши элементы при этом остаются смонтированными.
  Запросы в это время отклоняются (`Moonraker connection is not open`),
  подписки восстановятся после переподключения.
- **Klipper не обязательно готов.** Moonraker может работать при `klippy not
  ready`. Проверяйте `printer.info.state` и показывайте заглушку, а не ошибку.

---

## 8. Отладка и разработка

### Рабочий цикл

1. Собрать плагин, положить `manifest.json` + `index.js` в `extensions/<имя>/`.
2. `node tools/extensions-sync.cjs` — пересобрать `extensions/index.json`
   (нужно при первом добавлении плагина и при смене его версии/имени).
3. Settings → Plugins → **Refresh** → **Install** / **Update**.
4. При изменении кода — **F5** (см. «Чего не происходит при Update»).

В dev-режиме (`npm run dev`) каталог `extensions/` раздаётся middleware
Vite с теми же URL, что в проде (`/extensions/...`) и без кэша для `.json`/`.js`.

### Подключение по URL (Advanced)

Settings → Plugins → **Add by URL (advanced)** — прямая установка по адресу
манифеста, например `http://localhost:5174/manifest.json` с dev-сервера
плагина. Хост покажет предупреждение о доверии, запись получит бейдж *external*.

Для плагина с **другого origin** сервер должен отдавать CORS-заголовки
(`Access-Control-Allow-Origin`) и для манифеста, и для модуля — это ограничение
браузера, которое хост обойти не может. Плагины из `extensions/` (тот же origin)
CORS не требуют.

### Что смотреть в консоли

- `[plugin-loader] Plugin "…" has invalid <вид> contribution` — вклад отброшен
  санитайзером.
- `[plugin-loader] Failed to load plugin from …` — не загрузился манифест или
  модуль.
- `[guard-agent] …: handler export "…" not found` — в манифесте указан гард, но
  модуль не экспортирует функцию с таким именем.
- `[hotkeys] Conflict on "…"` — конфликт горячих клавиш (обе отключены).
- `[hotkeys] …: handler export "…" not found` — то же для hotkeys.
- `Element not registered: <tag>` на месте поверхности — вклад объявлен, но
  модуль не вызвал `customElements.define` для этого тега.

### Панель About / Debug

Settings → About / Debug показывает зарегистрированные гарды, припаркованные
(замороженные) цепочки и все горячие клавиши с признаком «отключена: конфликт».

---

## 9. Подводные камни

Собрано из реального поведения кода:

1. **`params` и Svelte-враппер.** `defineMpuElement` передаёт в компонент
   `params` как обычное значение, снятое в момент чтения; присваивание
   `el.params = …` на живом элементе **не вызывает перерисовку** Svelte-компонента.
   Если страница должна реагировать на смену query (например, `?file=`),
   реализуйте собственный CE с сеттером `params` либо читайте
   `window.location.hash` / подписывайтесь на `hashchange`.
2. **`api.settings.onChange` вызывает колбэк как `cb('', всеНастройкиПлагина)`.**
   Первый аргумент всегда пустая строка, второй — **весь** объект настроек
   текущего принтера, а не одно значение. Сравнивайте нужные ключи сами.
3. **Без активного принтера** `api.printer` = `{ id: '', name: '', url: '' }`,
   `api.moonraker()` бросает синхронное исключение, `api.settings.get` возвращает
   `undefined`, а `set` молча ничего не делает.
4. **`onPrinterChange` вызывается только для непустого принтера**; сброс активного
   принтера колбэк не получает.
5. **`defaultSettings` из манифеста сейчас хостом не применяются.** Для
   значений по умолчанию пишите `api.settings.get<T>(key) ?? defaultValue`.
6. **`moonraker().request()` может висеть минуты:** запрос, который перехватил
   гард с `freeze`, ждёт решения пользователя (до 10 минут). Не вешайте на
   него короткие таймауты и не считайте, что «долго» = «сломалось».
7. **`subscribe()` и `poll()` гардами не охраняются**, только `request()`.
   Прямой HTTP (`httpBaseUrl`) тоже вне конвейера.
8. **Повторный идентичный `request()` при активной парковке** отклоняется с
   `already_pending` — это не ошибка, а сигнал «диалог уже показан».
9. **Теги CE глобальны и необратимы.** Занятый тег переопределить нельзя;
   плагин, не проверивший `customElements.get`, падает при повторной загрузке.
10. **`version` — строка и сравнивается на равенство**, не по semver.
11. **`banners[].scope`** присутствует в типе, но хостом не применяется:
    баннер рендерится на всех маршрутах. Фильтруйте по `params.route` сами.
12. **Дашборд может синхронизироваться между принтерами.** Тумблер
    `dashboard` в `mpu:v2:settingsSync` переключает хранение раскладки в общий
    `mpu:v2:settings:GLOBAL` (по умолчанию выключен).

---

## 10. Чек-лист перед релизом

- [ ] В манифесте `id`, `name`, `version`, `entry`; все `element` существуют.
- [ ] Каждый тег CE зарегистрирован с проверкой `customElements.get`.
- [ ] Префикс плагина у тегов CE, `id` страниц, `id` hotkeys, ключей настроек.
- [ ] Все подписки (`subscribe`, `onNotify`, `poll`, `on*Change`) снимаются в
      `disconnectedCallback`.
- [ ] Элемент корректно переживает размонтирование и повторное монтирование.
- [ ] Нет цветов в hex: только CSS-переменные темы; светлая и тёмная темы проверены.
- [ ] Все строки идут через `api.i18n.t`; есть как минимум `en`.
- [ ] Поведение при `klippy not ready` и при offline проверено.
- [ ] Действия с побочным эффектом идут через `request()` (чтобы гарды сработали).
- [ ] Версия увеличена; `tools/extensions-sync.cjs` выполнен.
- [ ] Сборка: `process.env.NODE_ENV` определён, ничего не `external`, имя файла
      = `manifest.entry`.
