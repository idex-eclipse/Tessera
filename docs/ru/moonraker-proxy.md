# MoonrakerProxy и `MoonrakerProxyHandle`

Плагины не открывают WebSocket сами. Хост держит **пул прокси** — по одному
соединению на каждый Moonraker (нормализованный origin принтера) — и выдаёт
плагину **handle**: `api.moonraker()` для активного принтера или
`api.moonrakerFor(printerId)` для любого.
`api.moonraker()` устарел в plugin API 1.0; новые плагины должны передавать ID принтера явно.

Что даёт прокси:

- один WebSocket на принтер, общий для всех плагинов;
- **snapshot-кэш**: новый подписчик мгновенно получает текущее состояние;
- **TTL-кэш** для безопасных чтений с инвалидацией по событиям;
- объединение подписок разных плагинов в один набор объектов;
- фоновое переподключение с экспоненциальной паузой;
- **poll-on-demand** для данных, которые Moonraker сам не присылает;
- единая точка для авторизации (401 → оверлей входа).

Переключение вкладки принтера соединений **не рвёт**, и при обрыве сокета прокси
сохраняется. Смена URL в Settings и кнопка Retry в оверлее заменяют прокси, и все
регистрации на старом теряются (см. [Состояние соединения](#состояние-соединения)).

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
| Нет активного принтера (для сохранённого handle из `moonraker()`) | `Error` | `[plugin-api] No active printer for moonraker()` |
| Прокси заменён, пока запрос был в полёте | `Error` | `Moonraker proxy disposed` |

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
только последующие дельты. Подписчики с `immediate` получают полный снимок заново после
каждого переподключения.

### Объединение подписок

Все подписки всех плагинов сводятся в одно **объединение объектов и полей** и
отправляются Moonraker'у как единый набор. Объект снимается с подписки, когда
отписался последний подписчик, кроме объектов базовой подписки (см. ниже). Дублирующиеся
подписки разных плагинов бесплатны.

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
ключевые объекты принтера и отдельные их поля (`extruder*`, `heater_bed`, `toolhead`,
`dual_carriage`, `print_stats`, `display_status`, `virtual_sdcard`, `gcode_move`,
`webhooks`, `motion_report`, `idle_timeout`, `extruder_stepper`, `firmware_retraction`,
`save_variables`, `heater_generic *`), чтобы snapshot-кэш был
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

`params` отдаются «как есть» (чаще всего массив). Часто используемые события:

| Событие | Когда |
|---|---|
| `notify_gcode_response` | вывод G-code консоли |
| `notify_klippy_ready` / `notify_klippy_shutdown` / `notify_klippy_disconnected` | жизненный цикл Klipper |
| `notify_filelist_changed` | изменились файлы |
| `notify_history_changed` | изменилась история |
| `notify_config_changed` | изменился конфиг |
| `notify_active_spool_set` | Spoolman: сменилась активная катушка |
| `notify_proc_stat_update` | статистика хоста примерно раз в секунду: CPU / память / температура, сеть, `websocket_connections` (и `throttled_state`, если хост его сообщает) |
| `notify_cpu_throttled` | изменилось состояние троттлинга / пониженного напряжения хоста (`[{ bits, flags }]`; только Raspberry Pi) |
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
- не более одного запроса «в полёте» на `method+params`; первый тик — сразу при
  регистрации и при (пере)подключении сокета;
- отклоняются только методы из списка «Никогда не кэшируются», с предупреждением в
  консоль, и `poll` возвращает пустую функцию. Остальные методы с побочным эффектом не
  распознаются, поэтому никогда их не поллите;
- `poll` обходит GuardAgent (это внутреннее обновление, только чтения).

## `klippyStream(method, params, onData, onStatus?, onAck?)`

Декларация «мне нужен bulk-поток Klipper». Такие данные (например `load_cell/dump_force`
— отсчёты датчика усилия или `motion_report/dump_trapq`) обычный `/websocket` Moonraker не отдаёт: только raw-мост
`/klippysocket`. Плагин сокетов не открывает: сокет (один на принтер) открывает и ведёт
прокси на том же origin, что и основной сокет, с тем же токеном. Возвращает функцию отмены.

```ts
const stop = api.moonraker().klippyStream(
  'load_cell/dump_force',
  { sensor: 'my_cell' },
  (batch) => {
    // { data: [[time, force_g | null, counts, tare | null], …] }
  },
  (status) => { /* 'connecting' | 'live' | 'unavailable' */ },
);
// …
stop();
```

Правила:

- мост **только для чтения по политике**: хост пропускает любой метод вебхуков Klipper, кроме
  чёрного списка эндпоинтов ядра, меняющих состояние принтера: `emergency_stop`,
  `register_remote_method`, `gcode/script`, `gcode/restart`, `gcode/firmware_restart` и всё
  под `pause_resume/`. Имя хост сначала нормализует (регистр, пробелы по краям, управляющие
  символы, в том числе разделитель кадра ETX, Unicode NFKC) и отправляет уже нормализованную
  строку, поэтому `Emergency_Stop` или `emergency_stop\u0003` тоже отклоняются. Имя — один или
  два сегмента из `[a-z0-9_]`. Отклонённый вызов, params не в виде простого объекта или со своим
  `response_template` дают предупреждение в консоль, `klippyStream` возвращает пустую функцию.
  Чёрный список покрывает ядро Klipper: сторонний модуль `extras` может зарегистрировать
  собственный записывающий эндпоинт, о котором хост не знает;
- примеры потоков: `load_cell/dump_force` (`{ sensor }`), `load_cell_probe/dump_taps`
  (`{ sensor }`, сообщения `{ tap: { time: number[], force: number[] } }` — по одному касанию
  пробы), `motion_report/dump_trapq` и `motion_report/dump_stepper` (`{ name }`),
  `adxl345/dump_adxl345`, `angle/dump_angle`, `ldc1612/dump_ldc1612` (`{ sensor }`),
  `tmc/stallguard_dump` (`{ name }`) и `objects/subscribe` (статус-объекты, сообщения
  `{ eventtime, status }`);
- сокет открывается с первой подписки; подписки с одинаковым `method+params` делят один
  поток Klipper;
- у Klipper нет отписки: поток идёт, пока открыт сокет. С последней отменой сокет
  закрывается; если отменена одна из нескольких групп, сокет пересоздаётся и остальные
  подписываются заново. **Отменяйте подписку, когда данные не нужны** (график скрыт, ушли с
  вкладки): непрерывный поток каждого отсчёта нагружает Klipper;
- `onStatus` вызывается сразу с текущим состоянием и при каждом изменении. `unavailable` —
  моста нет (в nginx нет `location /klippysocket`, mixed content, Moonraker старый) или
  Klipper отклонил подписку (нет такого `load_cell`). Прокси повторяет подключение сам
  (1 с → 2 с → … до 30 с) и подписывается заново; плагину достаточно показать запасной
  вариант (например, `subscribe` на статус-объект);
- ключ в params: `API_Server.md` Klipper описывает `{ sensor: '<имя>' }`, но часть версий
  Klipper отвечает «Missing Argument [load_cell]» и ждёт `load_cell` (`load_cell_probe` для
  `load_cell_probe/dump_taps`). Хост передаёт params как есть: плагин пробует сначала
  документированный ключ, а при статусе `unavailable` — старый (плагин calibrations делает это
  в `load-cell/stream-keys.ts`);
- `onAck` (необязательный, `pluginApi: "0.12"`) получает `result` ответа Klipper на подписку:
  у `objects/subscribe` это `{ eventtime, status }` — начальное состояние без разрыва до
  первого обновления; у dump-потоков — `{ header: [...] }`. Вызывается при каждой
  (пере)подписке, а слушателю, который подключился к уже идущему потоку, — сразу сохранённым
  ответом;
- `klippyStream` обходит GuardAgent (только чтение);
- работает с `pluginApi: "0.9"` и новее: плагину, которому он обязателен, пишите `"0.9"`.
  Хосты старше `"0.12"` принимают только `load_cell/dump_force` (и `load_cell_probe/dump_taps`
  с `"0.11"`) и отклоняют остальные методы, поэтому плагин, который их использует, пишет `"0.12"`.

## `klippyRequest(method, params?, options?)`

Разовый запрос с ответом по тому же мосту `/klippysocket` (`pluginApi: "0.12"`):
`objects/list`, `info` и другие чтения, до которых обычный `request()` не дотягивается. Правила
метода и params и чёрный список те же, что у `klippyStream`; отклонённый вызов — rejected
promise (а не предупреждение в консоль).

```ts
const { objects } = (await api.moonraker().klippyRequest('objects/list')) as { objects: string[] };
const info = await api.moonraker().klippyRequest('info', {}, { timeoutMs: 5000 });
```

- resolves значением `result` Klipper; rejected с текстом `error.message`, если Klipper
  ответил ошибкой, по таймауту (`timeoutMs`, по умолчанию 10 с), при обрыве соединения с
  мостом или `dispose` прокси. Повторов нет;
- сокет открывается по требованию и делит соединение с потоками. Если он больше никому не
  нужен, закрывается примерно через 2 с после последнего ответа (серия запросов использует одно
  соединение). Отмена одной группы потока при работающих других пересоздаёт сокет, и запросы,
  бывшие на нём в полёте, отклоняются;
- `klippyRequest` обходит GuardAgent (только чтение).

---

## Состояние соединения

```ts
api.moonraker().readyState;                 // 'connecting' | 'open' | 'closed'

const off = api.moonraker().onConnectionStatusChange((status) => { … });
const offReady = api.moonraker().onReady(() => initialLoad());
```

- `readyState` — состояние сокета (не Klipper!). `'closed'` — между попытками
  переподключения тоже.
- `onConnectionStatusChange` — на каждый переход, но не при подписке. Handle удалённого
  принтера вызывает его один раз с `'closed'`, а его `httpBaseUrl` равен `''`.
- `onReady(cb)` — вызывается **при каждом открытии сокета**, и сразу (через
  microtask), если подписались, когда сокет уже открыт. Подходит для
  «перезагрузить всё после (пере)подключения».
- Переподключение — автоматическое, с экспоненциальной паузой (1 с → 2 с → 4 с …
  до 30 с). Offline **не валит загрузку** хоста.
- Подписки, оформленные до разрыва, после восстановления соединения
  отправляются заново (желаемое состояние помнит прокси).
- Смена URL в Settings и кнопка **Retry** в оверлее — другое дело: они заменяют прокси, и
  регистрации `subscribe`, `onNotify`, `onReady`, `onConnectionStatusChange` и `poll` на
  старом сбрасываются. Ваш handle затем работает с новым прокси, но только для последующих
  вызовов. Для активного принтера о смене URL сообщает `onPrinterChange`; Retry события не
  даёт.
- Показывать пользователю «нет связи» самому не нужно: хост рисует
  offline-overlay. Но ваш элемент должен не падать от отклонённых `request`.

### Klipper не готов

Moonraker может быть доступен при `klippy is not ready`. Тогда `printer.info`
возвращает `state: 'startup' | 'shutdown' | 'error'`, а большинство
`printer.*` запросов и подписок не работают. Читайте `printer.info` и
`notify_klippy_ready`, показывайте заглушку «Klippy not ready» вместо ошибок.

---

## HTTP мимо WebSocket: `httpBaseUrl` и `authToken`

Бинарные операции (загрузка и скачивание файлов, превью, снимки камер) идут по
обычному HTTP к Moonraker, **мимо прокси, кэша и гардов**:

```ts
const base = api.moonraker().httpBaseUrl;           // например http://printer.local:7125
const encoded = path.split('/').map(encodeURIComponent).join('/');   // слэши сохраняются
const thumb = `${base}/server/files/gcodes/${encoded}`;
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

1. Собственная проверка прокси получает `401` или `403`, сокет закрывается с кодом `4001`
   или `4003`, либо JSON-RPC-запрос падает с ошибкой авторизации → прокси помечает «нужна
   авторизация» → хост показывает оверлей входа. `401` на ваш собственный `fetch` его не
   показывает.
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
