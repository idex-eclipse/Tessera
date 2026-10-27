# MoonrakerProxy и `MoonrakerProxyHandle`

Плагины не открывают WebSocket сами. Хост держит **пул прокси** — по одному
соединению на каждый Moonraker (нормализованный origin принтера) — и выдаёт
плагину **handle**: `api.moonraker()` для активного принтера или
`api.moonrakerFor(printerId)` для любого.

Что даёт прокси:

- один WebSocket на принтер, общий для всех плагинов;
- **snapshot-кэш**: новый подписчик мгновенно получает текущее состояние;
- **TTL-кэш** для безопасных чтений с инвалидацией по событиям;
- объединение подписок разных плагинов в один набор объектов;
- фоновое переподключение с экспоненциальной паузой;
- **poll-on-demand** для данных, которые Moonraker сам не присылает;
- единая точка для авторизации (401 → оверлей входа).

Переключение вкладки принтера соединений **не рвёт**; прокси живёт, пока принтер
есть в реестре.

---

## Интерфейс handle

```ts
interface MoonrakerProxyHandle {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;

  subscribe(
    objects: Record<string, string[]>,
    callback: (delta: any) => void,
    options?: { immediate?: boolean },
  ): () => void;

  onNotify(event: string, callback: (params: any) => void): () => void;

  poll(method: string, params: unknown, intervalMs: number): () => void;

  readonly httpBaseUrl: string;
  readonly readyState: 'connecting' | 'open' | 'closed';
  readonly authToken: string | null;

  onReady(callback: () => void): () => void;
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): () => void;
}
```

---

## `request(method, params?)`

JSON-RPC вызов Moonraker по WebSocket. Возвращает `result` ответа.

```ts
const info = await api.moonraker().request<{ state: string }>('printer.info');

await api.moonraker().request('printer.gcode.script', { script: 'G28' });
```

Путь запроса:

```
плагин → GuardAgent (preflight) → кэш → WebSocket → Moonraker
```

### Ошибки

`request` возвращает Promise, который отклоняется одним из:

| Причина | Тип | Признак |
|---|---|---|
| Moonraker вернул JSON-RPC error | `MoonrakerRequestError` | `error.name === 'MoonrakerRequestError'`, `error.message`, `error.code`, `error.data` |
| Соединение не открыто | `Error` | `message: 'Moonraker connection is not open'` |
| Соединение оборвалось, пока запрос был в полёте | `Error` | `message: 'Moonraker connection closed'` |
| Ошибка отправки в сокет | `Error` | как есть |
| Гард наложил вето | `GuardError` | `error.rejection.code === 'denied_by_guard'` |
| Гард не ответил / парковка истекла | `GuardError` | `'guard_timeout'` |
| Идентичный запрос уже ждёт решения | `GuardError` | `'already_pending'` |
| Принтер удалён (для `moonrakerFor`) | `Error` | `printer '…' is not configured` |

```ts
try {
  await api.moonraker().request('printer.print.start', { filename });
} catch (e) {
  const r = (e as { rejection?: { code: string; pluginId?: string; reasonKey?: string } }).rejection;
  if (r?.code === 'denied_by_guard') showDenied(api.i18n.t(r.reasonKey ?? 'guards.denied'));
  else if (r?.code === 'already_pending') return;      // диалог уже открыт
  else showError(e);
}
```

> **Запрос может висеть долго.** Если гард ответил `freeze`, `request` ждёт
> решения пользователя — до 10 минут. Не ставьте на него короткие таймауты.

Тайм-аута у самого JSON-RPC-запроса к Moonraker в прокси нет: ответ приходит или
отклоняется при разрыве соединения (висящие запросы отклоняются при закрытии
сокета).

### Что кэшируется

Ответы кэшируются **прозрачно**: код плагина один и тот же, но повторный
идентичный `request` может не уходить в сеть.

**Snapshot-кэш** — живёт, пока открыт сокет (сбрасывается при `notify_klippy_*`):

- `server.info`, `printer.info`.

**TTL-кэш** (метод + параметры → значение, с инвалидацией по уведомлению):

| Метод | TTL | Сбрасывается по |
|---|---|---|
| `server.files.list` | 10 с | `notify_filelist_changed` |
| `server.files.get_directory` | 10 с | `notify_filelist_changed` |
| `server.files.metadata` | 10 с | `notify_filelist_changed` |
| `server.history.list` | 10 с | `notify_history_changed` |
| `printer.configfile.*` | 30 с | `notify_config_changed` |

**Никогда не кэшируются:**

`printer.gcode.script`, `printer.emergency_stop`, `printer.restart`,
`printer.firmware_restart`, `printer.objects.(un)subscribe`,
`server.files.upload|delete_file|move|copy|post_directory|delete_directory`,
всё `server.webcams.*` и любые `server.files.(upload|delete|move|copy|post)*`.

Если на метод идёт `poll()`, значения кладутся в тот же кэш с
`TTL = max(правилоTTL, интервал × 2)`.

Практический вывод: **для чтения «свежего» значения лучше подписка** (`subscribe`),
а не повторный `request`. Для данных, которых нет в status-объектах и которые
нужно обновлять периодически, используйте `poll()`.

---

## `subscribe(objects, callback, options?)`

Подписка на status-объекты Klipper (`printer.objects.subscribe`).

```ts
const off = api.moonraker().subscribe(
  { extruder: ['temperature', 'target'], heater_bed: ['temperature', 'target'] },
  (delta) => {
    // delta: { extruder?: { temperature?: number, target?: number }, heater_bed?: {...} }
    if (delta.extruder?.temperature !== undefined) setHotend(delta.extruder.temperature);
  },
);
// off() — отписка
```

### Формат `objects`

`{ "<имя объекта>": ["поле", …] }`. Имя объекта — как в Klipper, включая
пробелы: `'heater_generic chamber'`, `'temperature_sensor mcu'`, `'gcode_macro T0'`.
Пустой массив полей (`[]`) означает *все* поля объекта.

### Формат `delta`

`{ "<объект>": { "<поле>": значение } }`. Приходят **только изменившиеся поля** и
только тех объектов/полей, на которые вы подписаны. Дельта — не полное состояние:
сохраняйте последнее известное значение у себя.

### Первый вызов

По умолчанию (`immediate: true`) новый подписчик получает **снимок** уже
известных значений своих объектов из snapshot-кэша. Если ваша подписка не
добавляет новых полей к общему объединению (их уже кто-то запросил, например
baseline прокси), снимок приходит почти сразу; если добавляет — после ответа
Moonraker на `printer.objects.subscribe`. Значения, которых ещё нет в кэше,
приходят обычными дельтами. С `{ immediate: false }` снимок не отправляется —
только последующие дельты.

### Объединение подписок

Все подписки всех плагинов сводятся в одно **объединение объектов и полей** и
отправляются Moonraker'у как единый набор. Объект снимается с подписки, когда
отписался последний подписчик. Дублирующиеся подписки разных плагинов бесплатны.

### Что надо помнить

- Подписки привязаны к **ProxyInstance** принтера. После `moonraker()` →
  смены вкладки handle указывает на другой принтер; ваши подписки на прежний
  остаются у прежнего. Переподписывайтесь в `onPrinterChange`.
- Подписка на объект, которого нет в Klipper (опечатка, не настроен модуль),
  не вызывает ошибки — просто не приходит данных.
- Объект `spoolman` — **не** Klipper-объект; подписка на него не работает (он
  берётся через Moonraker-эндпоинты, см. `server.spoolman.*`).
- Колбэк вызывается в `try/catch` прокси: исключение в нём логируется и
  не ломает другие подписки.
- Не подписывайтесь на тяжёлые объекты «на всякий случай»: `[]` (все поля) у
  `motion_report` или `bed_mesh` создаёт лишний трафик для всех плагинов.

### Базовая подписка прокси

Независимо от плагинов, прокси держит собственную **baseline-подписку** на
ключевые объекты принтера (`extruder*`, `heater_bed`, `toolhead`, `print_stats`,
`display_status`, `virtual_sdcard`, `gcode_move`, `webhooks`, `bed_mesh`,
`motion_report`, `idle_timeout`, `heater_generic *`), чтобы snapshot-кэш был
тёплым. Поэтому первая подписка на эти объекты обычно отвечает мгновенно.
Список обновляется при открытии сокета, `notify_klippy_ready/started` и
`notify_config_changed`.

---

## `onNotify(event, callback)`

Подписка на произвольные JSON-RPC уведомления Moonraker по имени метода:

```ts
api.moonraker().onNotify('notify_gcode_response', (params) => {
  const line = Array.isArray(params) ? params[0] : params;   // Moonraker шлёт массив строк
});
api.moonraker().onNotify('notify_filelist_changed', () => reload());
```

`params` отдаются «как есть» (чаще всего массив). Многие уведомления оборачивают данные
в массив из одного элемента: `notify_webcams_changed` приходит как `[{ webcams: [...] }]`,
а не сам список. Разворачивайте `params[0]` и терпимо относитесь к неожиданной форме
(перезапросите данные, а не считайте их «пустыми»). Часто используемые события:

| Событие | Когда |
|---|---|
| `notify_gcode_response` | вывод G-code консоли |
| `notify_klippy_ready` / `notify_klippy_shutdown` / `notify_klippy_disconnected` | жизненный цикл Klipper |
| `notify_filelist_changed` | изменились файлы |
| `notify_history_changed` | изменилась история |
| `notify_config_changed` | изменился конфиг |
| `notify_active_spool_set` | Spoolman: сменилась активная катушка |
| `notify_status_update` | служебное: дельты status-объектов (для этого есть `subscribe`) |

Вместо `notify_status_update` пользуйтесь `subscribe` — он отфильтрует нужные
объекты и выдаст начальный снимок.

---

## `poll(method, params, intervalMs)`

Декларация «мне нужны свежие данные этого метода». Прокси периодически сам
вызывает метод и обновляет кэш, который читает `request()`. Возвращает
функцию отмены.

```ts
const stop = api.moonraker().poll('server.history.totals', undefined, 5000);
// …
const totals = await api.moonraker().request('server.history.totals'); // из кэша
stop();
```

Правила:

- минимальный интервал — 250 мс;
- несколько регистраций одного `method+params` объединяются: интервал берётся
  **минимальный**, отсчёт — по счётчику ссылок; поллинг останавливается с
  последней отменой;
- не более одного запроса «в полёте» на метод; первый тик — сразу при
  регистрации и при (пере)подключении сокета;
- **методы с побочным эффектом отклоняются** (см. список «Никогда не
  кэшируются») с предупреждением в консоль, `poll` возвращает пустую функцию;
- `poll` обходит GuardAgent (это внутреннее обновление, только чтения).

---

## Состояние соединения

```ts
api.moonraker().readyState;                 // 'connecting' | 'open' | 'closed'

const off = api.moonraker().onConnectionStatusChange((status) => { … });
const offReady = api.moonraker().onReady(() => initialLoad());
```

- `readyState` — состояние сокета (не Klipper!). `'closed'` — между попытками
  переподключения тоже.
- `onConnectionStatusChange` — на каждый переход.
- `onReady(cb)` — вызывается **при каждом открытии сокета**, и сразу (через
  microtask), если подписались, когда сокет уже открыт. Подходит для
  «перезагрузить всё после (пере)подключения».
- Переподключение — автоматическое, с экспоненциальной паузой (1 с → 2 с → 4 с …
  до 30 с). Offline **не валит загрузку** хоста.
- Подписки, оформленные до разрыва, после восстановления соединения
  отправляются заново (желаемое состояние помнит прокси).
- Показывать пользователю «нет связи» самому не нужно: хост рисует
  offline-overlay. Но ваш элемент должен не падать от отклонённых `request`.

### Klipper не готов

Moonraker может быть доступен при `klippy not ready`. Тогда `printer.info`
возвращает `state: 'startup' | 'shutdown' | 'error'`, а большинство
`printer.*` запросов и подписок не работают. Читайте `printer.info` и
`notify_klippy_ready`, показывайте заглушку «Klippy not ready» вместо ошибок.

---

## HTTP мимо WebSocket: `httpBaseUrl` и `authToken`

Бинарные операции (загрузка и скачивание файлов, превью, снимки камер) идут по
обычному HTTP к Moonraker, **мимо прокси, кэша и гардов**:

```ts
const base = api.moonraker().httpBaseUrl;           // например http://printer.local:7125
const thumb = `${base}/server/files/gcodes/${encodeURIComponent(path)}`;
```

Заголовки для авторизованного Moonraker:

```ts
const token = api.moonraker().authToken;            // string | null
fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
```

Правила:

- **Загрузка файлов** — `POST {httpBaseUrl}/server/files/upload`, `FormData`.
  После успеха Moonraker пришлёт `notify_filelist_changed`, кэш файлов
  инвалидируется.
- **Чтение содержимого файлов** (редактор и пр.) — `fetch(..., { cache: 'no-store' })`.
  Иначе браузер вернёт устаревшее тело после сохранения.
- Прямой HTTP **не проходит гарды**. Если действие должно быть защищено
  (например, старт печати), используйте `request('printer.print.start')`, а не
  прямой HTTP.

---

## Авторизация

Пароль не попадает в плагины. Хост сам ведёт вход:

1. Moonraker отвечает `401` (на WebSocket-запрос или HTTP) → прокси помечает
   «нужна авторизация» → хост показывает оверлей входа.
2. После входа токен сохраняется для принтера и передаётся прокси; ваш handle
   начинает отдавать его в `authToken`.
3. Выход инициирует правая панель; плагины могут сообщить хосту о выходе
   событием `window` `mpu:auth-logout` (`detail: { printerId }`) — это
   инфраструктурный сигнал, не шина плагинов.

Плагину достаточно использовать `httpBaseUrl` + `authToken` для HTTP и
`request` для RPC.

---

## Рекомендации

- Один `subscribe` с несколькими объектами лучше нескольких подписок.
- Отписывайтесь при размонтировании: незакрытые подписки держат объекты в
  объединении и нагружают соединение.
- Не дёргайте `request` в цикле и по таймеру: используйте `subscribe` или `poll`.
- Не вешайте `request('printer.gcode.script', …)` на события, которые могут
  повторяться: если запрос заморожен гардом, идентичные повторы отклоняются как
  `already_pending`.
- Для нескольких принтеров держите по handle на принтер (`moonrakerFor`) и
  освобождайте при удалении принтера (`onPrintersChange`).
