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

  // гарды
  guards: { resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void };
}

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

Колбэк с новым активным принтером. **Не вызывается**, когда активный принтер
сброшен (`null`). Не вызывается сразу при подписке — начальное значение читайте
из `api.printer`.

### `onPrintersChange(cb)` → `unsubscribe`

Любое изменение реестра: добавление, переименование/смена URL, удаление,
импорт. Колбэк получает весь актуальный список.

---

## Moonraker

### `moonraker()`

Handle активного принтера. **Бросает синхронное исключение**, если активного
принтера нет. Сам handle — стабильный объект, но он каждый вызов резолвит
текущий активный принтер заново: после смены вкладки ваши подписки надо
пересоздать (подписки не «переезжают» между принтерами).

### `moonrakerFor(printerId)`

Полноценный handle (с гардами) любого принтера, независимо от активного.
Используйте в fleet-режиме и когда плагин работает с несколькими принтерами.

Семантика:

- принтер должен существовать, иначе исключение `unknown printerId`;
- объект handle **стабилен** между вызовами (кэш на плагин) — можно держать в
  module-state;
- handle привязан к `printerId`, но `url` резолвит лениво → переживает смену URL
  в Settings и пересоздание соединения;
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

Плагин этого не видит: API одинаков, хост сам выбирает пространство имён.

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
  пустую функцию.
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

- Значения по умолчанию задавайте на чтении: `api.settings.get('limit') ?? 50`
  (`manifest.defaultSettings` хостом сейчас не применяется).
- Ключи лучше называть с префиксом области (`columns:page:gcodes`).
- Храните компактные значения. Всё лежит в `localStorage` (лимит браузера
  ~5 МБ на origin).
- Не храните секреты: настройки попадают в экспорт Settings → About / Debug.

---

## Окружение

### `i18n`

```ts
api.i18n.t('hello.title');
api.i18n.t('hello.greeting', { name: 'Voron' });  // "Привет, {name}" → "Привет, Voron"
api.i18n.locale;                                  // 'ru'
```

Ключ резолвится сначала в словаре плагина, затем в словаре хоста (`common.*`,
`settings.*`, …). Если ключ нигде не найден, `t` возвращает **сам ключ**.
Подстановки — `{имя}`, значения `string | number`. Подробности — в
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
