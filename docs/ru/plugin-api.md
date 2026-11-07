# Справочник PluginApi

`PluginApi` — единственный объект, через который плагин общается с хостом.
Хост кладёт его в свойство `api` каждого Custom Element плагина. Типы — в
[`plugin-sdk/src/types.ts`](../../plugin-sdk/src/types.ts).

Все геттеры читают актуальное состояние при каждом обращении (принтер, тема,
язык), поэтому объект `api` можно держать долго.

```ts
interface PluginApi {
  readonly pluginId: string;
  readonly manifest: PluginManifest;

  // принтеры
  readonly printer: PrinterInfo;            // активный (сахар)
  readonly printers: PrinterInfo[];         // весь реестр, read-only
  setActivePrinter(id: string | null): void;
  onPrinterChange(cb: (printer: PrinterInfo) => void): () => void;
  onPrintersChange(cb: (printers: PrinterInfo[]) => void): () => void;

  // Moonraker
  moonraker(): MoonrakerProxyHandle;                   // активный принтер
  moonrakerFor(printerId: string): MoonrakerProxyHandle;

  // настройки
  settings: PluginSettingsApi;                         // активный принтер
  settingsFor(printerId: string): PluginSettingsApi;

  // окружение
  i18n: { t(key, params?): string; readonly locale: string };
  readonly theme: { current: 'light' | 'dark' };
  onLocaleChange(cb: (locale: string, dir: 'ltr' | 'rtl') => void): () => void;
  onThemeChange(cb: (theme: 'light' | 'dark') => void): () => void;

  // поиск и фильтры fleet
  readonly fleet: {
    publish(printerId: string, entry: FleetIndexEntry): void;
    retract(printerId: string): void;
  };

  // центр уведомлений (только запись, 0.10)
  readonly notifications: { push(n: NotificationInput): void };

  // прокси к внешним сервисам плагина из manifest.services (0.13)
  readonly services: PluginServicesApi;

  // гарды
  guards: { resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void };
}

interface NotificationInput {
  severity: 'critical' | 'error' | 'info';
  text: string;          // уже переведён
  label?: string;        // короткая подпись источника, переведённая; по умолчанию — имя плагина
  printerId?: string;    // по умолчанию активный принтер
}

interface FleetTag { id: string; labelKey: string; icon?: string; order?: number }
interface FleetIndexEntry { tags: FleetTag[]; searchText: string }

interface PrinterInfo { id: string; name: string; url: string }
```

---

## Идентификация

| Член | Описание |
|---|---|
| `pluginId` | `manifest.id` вашего плагина |
| `manifest` | подготовленный (санитайзенный) манифест. Невалидные вклады уже удалены; `component` уже заменён на `element` |

---

## Принтеры

### `printer`

Активный принтер: `{ id, name, url }`. Геттер: каждый раз возвращает свежий
объект. **Без активного принтера** — `{ id: '', name: '', url: '' }`.

### `printers`

Весь реестр принтеров (read-only копия). Порядок = порядок вкладок.

### `setActivePrinter(id)`

Меняет активный принтер в хосте (переключает вкладку). Адрес страницы (hash)
при этом хостом не переписывается; клик по вкладке принтера, в отличие от
этого вызова, ведёт на дашборд принтера. `null` сбрасывает активный принтер.

### `onPrinterChange(cb)` → `unsubscribe`

Колбэк с новым активным принтером. Срабатывает и при смене URL активного принтера,
с тем же `id`. **Не вызывается**, когда активный принтер сброшен (`null`) или
переименован (для переименования используйте `onPrintersChange`). Не вызывается сразу
при подписке — начальное значение читайте из `api.printer`.

### `onPrintersChange(cb)` → `unsubscribe`

Любое изменение реестра: добавление, переименование/смена URL, удаление,
импорт. Колбэк получает весь актуальный список.

---

## Moonraker

### `moonraker()`

Handle активного принтера. **Бросает синхронное исключение**, если активного
принтера нет. Сам handle — стабильный объект, но он каждый вызов резолвит
текущий активный принтер заново: после смены вкладки ваши подписки надо
пересоздать (подписки не «переезжают» между принтерами). Если сохранённым handle
пользуются без активного принтера, `request` отклоняется, а остальные члены бросают
исключение.

### `moonrakerFor(printerId)`

Полноценный handle (с гардами) любого принтера, независимо от активного.
Используйте в fleet-режиме и когда плагин работает с несколькими принтерами.

Семантика:

- принтер должен существовать, иначе исключение `unknown printerId`;
- объект handle **стабилен** между вызовами (кэш на плагин) — можно держать в
  module-state;
- handle привязан к `printerId`, но `url` резолвит лениво → сам объект handle
  переживает смену URL в Settings и кнопку Retry. **Регистрации — нет:** оба действия
  заменяют соединение, и сделанные ранее `subscribe`, `onNotify`, `onReady` и `poll`
  перестают работать, без какого-либо события. О смене URL активного принтера сообщит
  `onPrinterChange` (см. [moonraker-proxy.md](moonraker-proxy.md#состояние-соединения));
- после **удаления** принтера handle инертен: `request` отклоняется,
  `subscribe`/`onNotify`/`poll` — no-op, `readyState === 'closed'`. Соединение
  заново не поднимается.

Полное описание `MoonrakerProxyHandle` — в [moonraker-proxy.md](moonraker-proxy.md).

---

## Настройки

Настройки плагина — произвольные JSON-значения по строковым ключам в
`localStorage` (см. [settings.md](settings.md)). Есть два режима хранения,
которыми управляет пользователь (тумблер sync у плагина):

- **sync выключен (по умолчанию)** — свои настройки на каждый принтер;
- **sync включён** — одни настройки на все принтеры устройства.

API в обоих режимах одинаков, хост сам выбирает пространство имён. После переключения
подпишитесь на `onChange` заново, см. [settings.md](settings.md).

```ts
interface PluginSettingsApi {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  onChange(cb: (key: string, value: unknown) => void): () => void;
}
```

### `settings` и `settingsFor(printerId)`

- `settings` — настройки **активного** принтера. Без активного принтера
  `get` возвращает `undefined`, `set` ничего не делает, `onChange` возвращает
  пустую функцию. `get` и `set` следуют за активным принтером, а `onChange` остаётся
  привязан к принтеру, активному при подписке: подписывайтесь заново в `onPrinterChange`.
- `settingsFor(id)` — настройки конкретного принтера; несуществующий `id` →
  исключение; объект стабилен.

### Особенности `onChange`

Колбэк вызывается как **`cb('', allSettings)`**: ключ всегда пустая строка, а
значение — **весь** объект настроек плагина. Какой именно ключ изменился,
хост не сообщает.

```ts
api.settings.onChange((_key, all) => {
  const next = (all as Record<string, unknown>).theme;
  if (next !== current) { /* ... */ }
});
```

### Практика

- Не сравнивайте аргумент `key` в `onChange`: он всегда `''`. Перечитывайте нужные ключи.
  Встроенные плагины используют `useSetting` / `watchSettings`
  ([plugin-development.md](plugin-development.md#реактивное-чтение-настроек-core-плагины)).
- Значения по умолчанию задавайте на чтении: `api.settings.get('limit') ?? 50`
  (`manifest.defaultSettings` хостом сейчас не применяется).
- Ключи лучше называть с префиксом области (`columns:page:gcodes`).
- Храните компактные значения. Всё лежит в `localStorage` (лимит браузера
  ~5 МБ на origin).
- Не храните секреты: настройки попадают в экспорт Settings → About / Debug
  (из него исключены только собственные токены авторизации хоста). Токену или API-ключу
  внешнего сервиса место в [`api.services`](#services): он хранится на принтере и в браузер
  не возвращается.

---

## Fleet

<a id="fleet"></a>

`api.fleet` позволяет **fleet-панели** (см. [surfaces.md](surfaces.md#6-fleet-панели))
наполнять строку поиска и кнопки фильтров fleet-режима. Это канал данных плагин →
хост (второй — [`api.notifications`](#notifications), только запись; остальные — сигналы: `mpu:banner-expand`, `mpu:banner-collapse`,
`mpu:auth-logout`); хост хранит значения и никогда их не интерпретирует.

```ts
api.fleet.publish(printerId, {
  tags: [{ id: 'printing', labelKey: 'acme.filter.printing', icon: 'print', order: 0 }],
  searchText: 'benchy.gcode',
});
api.fleet.retract(printerId);   // когда панель убирается
```

- `tags` — одна кнопка фильтра на каждый уникальный `id` среди всех принтеров, со
  счётчиком. Подпись — `i18n.t(labelKey)`; `icon` — имя из общего набора иконок (на
  узких экранах показывается только иконка); `order` сортирует кнопки. Выбранные
  теги объединяются по OR; с текстом поиска — по AND.
- `searchText` — сопоставляется как подстрока без учёта регистра. Имя принтера хост
  сопоставляет сам, поэтому кладите сюда только дополнительный текст (например,
  печатаемый файл).
- `publish` заменяет прежнюю запись **вашего плагина** для этого принтера;
  одинаковые записи игнорируются, так что вызывать из эффекта дёшево. Неизвестные
  принтеры игнорируются. Лимиты: 16 тегов, 512 символов текста.
- Не публикуйте то, что бесполезно для поиска и фильтров: индекс общий, это не
  хранилище.

---

## Уведомления

<a id="notifications"></a>

`api.notifications` кладёт сообщение в **центр уведомлений хоста**: тост, бейдж на
колокольчике над кнопкой «Свернуть меню» правой панели и запись в списке. Доступно с
`pluginApi: "0.10"` и новее.

```ts
api.notifications.push({
  severity: 'error',                                   // 'critical' | 'error' | 'info'
  text: api.i18n.t('acme.heater.drift', { heater }),   // уже переведён
  label: api.i18n.t('acme.heater.source'),             // необязательно
});
```

- Есть только запись. Плагин не может читать, перечислять уведомления или
  подписываться на них: центр — не канал между плагинами. Автора проставляет хост,
  поэтому без `label` запись подписана названием вашего плагина.
- `text` переводит вызывающий в момент вызова; при смене языка он не
  переводится заново. Переводы строк заменяются пробелами; длиннее 240 символов
  обрезается с `…`. Пустой текст отбрасывается.
- `label` — короткая подпись источника (не длиннее 40 символов) для плагинов,
  сообщающих о нескольких видах событий.
- `printerId` привязывает сообщение к принтеру; по умолчанию это активный. Фоновый
  монитор, следящий за несколькими принтерами, обязан передавать его явно.
- Одинаковый текст от одного плагина для одного принтера в пределах 100 мс
  показывается один раз. Пользователь может фильтровать сообщения регулярным
  выражением и включить звук для `critical`; оба действуют на все плагины.
- Не используйте для болтовни: каждый вызов добавляет тост и запись в историю.
  Сообщайте о том, что пользователь обязан заметить (авария, сбой), а не о прогрессе.

### Из макросов Klipper: `M118 MPU_NOTIFY`

Уведомление может поднять и макрос Klipper, который плагином не является:

```
M118 MPU_NOTIFY <critical|error|info> <текст>
```

Klipper отдаёт `M118` как `echo: MPU_NOTIFY …` в `notify_gcode_response`, а
`@core/system` превращает эту строку в уведомление (подпись — «Макрос Klipper»).
Важность не зависит от регистра, текст — остаток строки. Это вход извне браузера: он
работает только пока включён `@core/system` и принтер подключён. Плагину следует
использовать `api.notifications.push`, а не этот путь.

---

## Сервисы

<a id="services"></a>

`api.services` обращается к **внешнему HTTP-сервису** плагина (Obico, сервер камер, облачный
API) через прокси на принтере. Доступно с `pluginApi: "0.13"`. Нужно, когда браузер не может
обратиться к сервису сам:

- сервис не отдаёт CORS-заголовки, и запрос со страницы Tessera падает;
- страница открыта по HTTPS, а сервис работает по `http://` (mixed content);
- запросу нужен секрет (токен, API-ключ), которому не место в браузере.

Прокси — часть службы `tessera-ext` этого хоста Tessera
([deployment.md](deployment.md#служба-tessera-ext-установка-из-ui)). Он общий для всех принтеров
хоста, права проверяет Moonraker принтера, который обслуживает хост, как и при установке
плагинов.

**1. Объявите сервис в манифесте.** Прокси читает объявление из *установленного* манифеста;
запрос не может поменять ни заголовок, ни пути.

```json
"pluginApi": "0.13",
"services": [
  { "name": "obico", "authHeader": "X-Api-Key", "allowPaths": ["api/v1/", "media/"] }
]
```

| Поле | Значение |
|---|---|
| `name` | уникально в плагине, `[a-z0-9][a-z0-9-]{0,31}` |
| `authHeader` | заголовок, в котором уходит секрет (`X-Api-Key`, `Authorization`, …); нет — сервис без секрета. Заголовки, которыми управляет прокси (`Host`, `Cookie`, `Content-Type`, `Accept`, …), не принимаются |
| `authPrefix` | текст перед секретом, например `"Bearer "`; по умолчанию нет |
| `allowPaths` | 1–20 префиксов путей, которые прокси пропускает: относительно адреса сервиса, без `/` в начале, без `..` |

Некорректное объявление отбрасывается целиком: для прокси такого сервиса нет.

**2. Дайте пользователю задать адрес и секрет** (в своём интерфейсе настроек):

```ts
interface PluginServicesApi {
  status(name: string): Promise<ServiceStatus>;
  configure(name: string, config: { url: string; secret?: string }): Promise<ServiceStatus>;
  remove(name: string): Promise<void>;
  fetch(name: string, path: string, init?: ServiceRequestInit): Promise<Response>;
}
interface ServiceStatus { name: string; configured: boolean; url: string | null; hasSecret: boolean }

await api.services.configure('obico', { url: 'http://192.168.1.20:3334', secret: token });
const { configured, hasSecret } = await api.services.status('obico');
```

- Адрес — `http(s)://host[:port][/base]` без логина, query и fragment; частные адреса
  разрешены (свой сервер живёт в локальной сети). Завершающий `/` отбрасывается.
- Секрет — печатный ASCII, не длиннее 4096 символов. Он **только записывается**: `status`
  сообщает, сохранён ли он, но не его значение. `configure` без `secret` оставляет сохранённый,
  `''` стирает. Вместо значения показывайте пустое поле пароля и пометку «сохранён».
- То же пользователь может сделать в терминале: `tessera-ext service set <plugin> <name> <url>`.

**3. Делайте запросы:**

```ts
const res = await api.services.fetch('obico', 'api/v1/printers/');
if (res.ok) printers = await res.json();

await api.services.fetch('obico', `api/v1/printers/${id}/`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action_on_failure: 'PAUSE' }),
});
```

- `path` — относительно адреса сервиса: без `/` в начале, уже закодированный, может содержать
  `?query`. Должен начинаться с одного из `allowPaths`.
- Ответ сервиса приходит как `Response` **с любым статусом** (404 сервиса — это `Response`
  со статусом 404). Перенаправления не выполняются, прокси их отклоняет: проверяйте
  завершающие `/` в путях.
- До сервиса доходят только `Accept`, `Accept-Language` и `Content-Type`; секрет добавляет
  прокси. Токен Moonraker, cookies и прочие заголовки принтер не покидают.
- Методы: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. Тело запроса до 1 МиБ, ответ до 16 МиБ,
  таймаут 30 с. Ответы отдаются с `Content-Security-Policy: sandbox`: картинки из них
  показывайте через `URL.createObjectURL(await res.blob())`; `<img src>` на прокси не
  сработает, каждому запросу нужен заголовок плагина, который добавляет хост.

**Ошибки.** Когда отказывает сам прокси или его нет, промис отклоняется с `ServiceError`
(узнавайте по `name === 'ServiceError'`: плагины импортируют из SDK только типы):

| `status` | Значение |
|---|---|
| `0`, `unavailable: true` | у этой Tessera нет прокси: dev-сервер, выключенная служба `tessera-ext`, Tessera старше 0.13 |
| `401` | нет входа в Moonraker хоста |
| `403` | путь вне `allowPaths` |
| `404` | сервис не объявлен или плагин установлен не через `tessera-ext` (у плагинов по URL прокси нет) |
| `409` | сервис ещё не настроен: попросите у пользователя адрес |
| `502` | сервис недоступен, перенаправил запрос или ответил больше 16 МиБ |
| `503` | хост установлен до 0.13: прокси не может сохранить настройки до `tessera update` |

Id плагина только разводит сервисы разных плагинов: все плагины работают в одной странице,
поэтому изоляцией между ними это не является.

---

## Окружение

### `i18n`

```ts
api.i18n.t('hello.title');
api.i18n.t('hello.greeting', { name: 'Voron' });  // "Привет, {name}" → "Привет, Voron"
api.i18n.locale;                                  // 'ru'
```

Словари хоста и всех плагинов сливаются в один каталог на локаль, и побеждает последнее
зарегистрированное значение ключа, поэтому используйте префикс. Ключ ищется в локали, затем
в её базовом языке, затем в `en`. Если ключ нигде не найден, `t` возвращает **сам ключ**.
Подстановки — `{name}` (имя только латиницей), значения `string | number`. Подробности — в
[i18n-and-theming.md](i18n-and-theming.md).

### `onLocaleChange(cb)` → `unsubscribe`

`cb(locale, dir)` при смене языка. `dir` — `'ltr'` или `'rtl'`.

### `theme`

`api.theme.current` — `'light' | 'dark'` (геттер). Для оформления почти всегда
достаточно CSS-переменных; тема нужна, если вы рисуете в `canvas`/WebGL и
сами резолвите цвета.

### `onThemeChange(cb)` → `unsubscribe`

`cb(theme)` при смене темы. Смена *акцентного цвета* пользователем не
порождает события — читайте `--accent` через `getComputedStyle` при отрисовке.

---

## Гарды

### `guards.resume(token, decision, reasonKey?)`

Вызывается плагином-гардом **после** того, как его обработчик вернул
`{ action: 'freeze' }` и пользователь принял решение:

- `'accept'` — цепочка продолжается со следующего гарда; если гардов больше нет,
  запрос уходит в Moonraker;
- `'deny'` — запрос отклоняется с атрибуцией вашего гарда (`reasonKey` попадёт
  в причину).

`token` — тот, что обработчик получил вторым аргументом. Неизвестный или
просроченный токен игнорируется (хост пишет предупреждение в консоль). Подробнее — [guards.md](guards.md).

---

## Дополнения

`api.extensions` — сторона владельца [точек расширения](surfaces.md#10-точки-расширения):
`list`, `resolve`, `onChange`, `mount`, `invoke`, `choice` / `setChoice`, `openChooser`.
Каждый `pointId` — id точки, объявленной **вашим** плагином. Вклад, смонтированный через
`mount`, получает api дополнения, а не ваш. Владельцам на Svelte — `ExtensionPoint` из
`@sdk/svelte`.

## Типичные шаблоны

### Подписка с переподпиской при смене принтера

```ts
let unsubscribe = () => {};

function bind() {
  unsubscribe();
  if (!api.printer.id) return;                       // нет активного принтера
  unsubscribe = api.moonraker().subscribe(
    { extruder: ['temperature', 'target'] },
    (delta) => render(delta.extruder),
  );
}

bind();
const offPrinter = api.onPrinterChange(bind);

// в disconnectedCallback:
unsubscribe(); offPrinter();
```

### Работа с конкретным принтером (fleet)

```ts
const handle = api.moonrakerFor(printerId);
const off = handle.subscribe({ print_stats: ['state', 'filename'] }, render);
```

### Реакция на удаление принтера

```ts
api.onPrintersChange((printers) => {
  if (!printers.some((p) => p.id === myPrinterId)) teardown();
});
```
