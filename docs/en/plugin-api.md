# PluginApi reference

`PluginApi` is the only object through which a plugin talks to the host. The host
puts it into the `api` property of each of the plugin's Custom Elements. Types
are in [`plugin-sdk/src/types.ts`](../../plugin-sdk/src/types.ts).

All getters read the current state on every access (printer, theme, language),
so you can keep the `api` object for as long as you like.

```ts
interface PluginApi {
  readonly pluginId: string;
  readonly manifest: PluginManifest;

  // printers
  readonly printer: PrinterInfo;            // active (sugar)
  readonly printers: PrinterInfo[];         // the whole registry, read-only
  setActivePrinter(id: string | null): void;
  onPrinterChange(cb: (printer: PrinterInfo) => void): () => void;
  onPrintersChange(cb: (printers: PrinterInfo[]) => void): () => void;

  // Moonraker
  moonraker(): MoonrakerProxyHandle;                   // active printer
  moonrakerFor(printerId: string): MoonrakerProxyHandle;

  // settings
  settings: PluginSettingsApi;                         // active printer
  settingsFor(printerId: string): PluginSettingsApi;

  // environment
  i18n: { t(key, params?): string; readonly locale: string };
  readonly theme: { current: 'light' | 'dark' };
  onLocaleChange(cb: (locale: string, dir: 'ltr' | 'rtl') => void): () => void;
  onThemeChange(cb: (theme: 'light' | 'dark') => void): () => void;

  // guards
  guards: { resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void };
}

interface PrinterInfo { id: string; name: string; url: string }
```

---

## Identification

| Member | Description |
|---|---|
| `pluginId` | your plugin's `manifest.id` |
| `manifest` | the prepared (sanitized) manifest. Invalid contributions are already removed; `component` has already been replaced by `element` |

---

## Printers

### `printer`

The active printer: `{ id, name, url }`. A getter: it returns a fresh object each
time. **With no active printer** — `{ id: '', name: '', url: '' }`.

### `printers`

The whole printer registry (a read-only copy). Order = tab order.

### `setActivePrinter(id)`

Changes the active printer in the host (switches the tab). The page address
(hash) is not rewritten by the host in this case; clicking a printer tab, unlike
this call, navigates to that printer's dashboard. `null` clears the active printer.

### `onPrinterChange(cb)` → `unsubscribe`

The callback receives the new active printer. It is **not called** when the active
printer is cleared (`null`). It is not called immediately on subscription — read
the initial value from `api.printer`.

### `onPrintersChange(cb)` → `unsubscribe`

Any registry change: add, rename/URL change, removal, import. The callback
receives the whole current list.

---

## Moonraker

### `moonraker()`

The handle of the active printer. **Throws synchronously** if there is no active
printer. The handle itself is a stable object, but it resolves the current active
printer anew on every call: after a tab switch your subscriptions must be
re-created (subscriptions do not "move" between printers).

### `moonrakerFor(printerId)`

A full-featured handle (with guards) of any printer, regardless of the active one.
Use it in fleet mode and whenever a plugin works with several printers.

Semantics:

- the printer must exist, otherwise an `unknown printerId` exception is thrown;
- the handle object is **stable** between calls (cached per plugin) — you can keep
  it in module state;
- the handle is bound to `printerId` but resolves `url` lazily → it survives a URL
  change in Settings and connection re-creation;
- after the printer is **removed** the handle is inert: `request` is rejected,
  `subscribe`/`onNotify`/`poll` are no-ops, `readyState === 'closed'`. The
  connection is not brought up again.

The complete description of `MoonrakerProxyHandle` is in [moonraker-proxy.md](moonraker-proxy.md).

---

## Settings

A plugin's settings are arbitrary JSON values under string keys in `localStorage`
(see [settings.md](settings.md)). There are two storage modes, controlled by the
user (the plugin's sync toggle):

- **sync off (default)** — separate settings per printer;
- **sync on** — one set of settings for all printers on the device.

The plugin does not see this: the API is the same, the host picks the namespace.

```ts
interface PluginSettingsApi {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  onChange(cb: (key: string, value: unknown) => void): () => void;
}
```

### `settings` and `settingsFor(printerId)`

- `settings` — the **active** printer's settings. With no active printer `get`
  returns `undefined`, `set` does nothing, `onChange` returns an empty function.
- `settingsFor(id)` — a specific printer's settings; a non-existent `id` →
  exception; the object is stable.

### `onChange` specifics

The callback is invoked as **`cb('', allSettings)`**: the key is always an empty
string and the value is the **whole** settings object of the plugin. The host does
not tell you which key changed.

```ts
api.settings.onChange((_key, all) => {
  const next = (all as Record<string, unknown>).theme;
  if (next !== current) { /* ... */ }
});
```

### In practice

- Set defaults on read: `api.settings.get('limit') ?? 50`
  (`manifest.defaultSettings` is currently not applied by the host).
- Name keys with an area prefix (`columns:page:gcodes`).
- Store compact values. Everything sits in `localStorage` (the browser limit is
  about 5 MB per origin).
- Do not store secrets: settings end up in the Settings → About / Debug export.

---

## Environment

### `i18n`

```ts
api.i18n.t('hello.title');
api.i18n.t('hello.greeting', { name: 'Voron' });  // "Hello, {name}" → "Hello, Voron"
api.i18n.locale;                                  // 'ru'
```

A key is resolved first in the plugin's dictionary, then in the host's dictionary
(`common.*`, `settings.*`, …). If the key is found nowhere, `t` returns **the key
itself**. Substitutions are `{name}`, with `string | number` values. Details are in
[i18n-and-theming.md](i18n-and-theming.md).

### `onLocaleChange(cb)` → `unsubscribe`

`cb(locale, dir)` on a language change. `dir` is `'ltr'` or `'rtl'`.

### `theme`

`api.theme.current` is `'light' | 'dark'` (a getter). CSS variables are almost
always enough for styling; you need the theme if you draw in `canvas`/WebGL and
resolve colors yourself.

### `onThemeChange(cb)` → `unsubscribe`

`cb(theme)` on a theme change. A change of the user's *accent color* does not
raise an event — read `--accent` through `getComputedStyle` when drawing.

---

## Guards

### `guards.resume(token, decision, reasonKey?)`

Called by a guard plugin **after** its handler returned `{ action: 'freeze' }` and
the user made a decision:

- `'accept'` — the chain continues from the next guard; if there are no more
  guards, the request goes to Moonraker;
- `'deny'` — the request is rejected with your guard's attribution (`reasonKey`
  becomes part of the reason).

`token` is the one the handler received as its second argument. An unknown or
expired token is ignored (the host writes a console warning). More in
[guards.md](guards.md).

---

## Typical patterns

### Subscribe and re-subscribe when the printer changes

```ts
let unsubscribe = () => {};

function bind() {
  unsubscribe();
  if (!api.printer.id) return;                       // no active printer
  unsubscribe = api.moonraker().subscribe(
    { extruder: ['temperature', 'target'] },
    (delta) => render(delta.extruder),
  );
}

bind();
const offPrinter = api.onPrinterChange(bind);

// in disconnectedCallback:
unsubscribe(); offPrinter();
```

### Working with a specific printer (fleet)

```ts
const handle = api.moonrakerFor(printerId);
const off = handle.subscribe({ print_stats: ['state', 'filename'] }, render);
```

### Reacting to a printer removal

```ts
api.onPrintersChange((printers) => {
  if (!printers.some((p) => p.id === myPrinterId)) teardown();
});
```
