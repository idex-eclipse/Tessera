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

  // fleet search and filters
  readonly fleet: {
    publish(printerId: string, entry: FleetIndexEntry): void;
    retract(printerId: string): void;
  };

  // notification center (write only, 0.10)
  readonly notifications: { push(n: NotificationInput): void };

  // proxy to the plugin's external services from manifest.services (0.13)
  readonly services: PluginServicesApi;

  // guards
  guards: { resume(token: string, decision: 'accept' | 'deny', reasonKey?: string): void };
}

interface NotificationInput {
  severity: 'critical' | 'error' | 'info';
  text: string;          // already translated
  label?: string;        // short source caption, translated; defaults to the plugin name
  printerId?: string;    // defaults to the active printer
}

interface FleetTag { id: string; labelKey: string; icon?: string; order?: number }
interface FleetIndexEntry { tags: FleetTag[]; searchText: string }

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

The callback receives the new active printer. It also fires when the active
printer's URL changes, with the same `id`. It is **not called** when the active
printer is cleared (`null`) or renamed (use `onPrintersChange` for renames). It is
not called immediately on subscription — read the initial value from `api.printer`.

### `onPrintersChange(cb)` → `unsubscribe`

Any registry change: add, rename/URL change, removal, import. The callback
receives the whole current list.

---

## Moonraker

### `moonraker()`

The handle of the active printer. **Throws synchronously** if there is no active
printer. The handle itself is a stable object, but it resolves the current active
printer anew on every call: after a tab switch your subscriptions must be
re-created (subscriptions do not "move" between printers). If a kept handle is used
with no active printer, `request` rejects and the other members throw.

### `moonrakerFor(printerId)`

A full-featured handle (with guards) of any printer, regardless of the active one.
Use it in fleet mode and whenever a plugin works with several printers.

Semantics:

- the printer must exist, otherwise an `unknown printerId` exception is thrown;
- the handle object is **stable** between calls (cached per plugin) — you can keep
  it in module state;
- the handle is bound to `printerId` but resolves `url` lazily → the handle object
  survives a URL change in Settings and the Retry button. **Registrations do not:**
  both replace the connection, and `subscribe`, `onNotify`, `onReady` and `poll` made
  earlier stop working, with no event about it. A URL change reaches you through
  `onPrinterChange` for the active printer (see
  [moonraker-proxy.md](moonraker-proxy.md#connection-state));
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

The API is the same in both modes, the host picks the namespace. Re-subscribe
`onChange` after a switch, see [settings.md](settings.md).

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
  `get` and `set` follow the active printer, while `onChange` stays bound to the
  printer that was active at subscribe time: re-subscribe in `onPrinterChange`.
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
- Do not compare the `key` argument of `onChange`: it is always `''`. Re-read the keys you
  care about. Built-in plugins use `useSetting` / `watchSettings`
  ([plugin-development.md](plugin-development.md#reading-settings-reactively-core-plugins)).
- Name keys with an area prefix (`columns:page:gcodes`).
- Store compact values. Everything sits in `localStorage` (the browser limit is
  about 5 MB per origin).
- Do not store secrets: settings end up in the Settings → About / Debug export
  (only the host's own authorization tokens are left out of it). A token or API key of an
  external service belongs in [`api.services`](#services): it is kept on the printer and
  never returns to the browser.

---

## Fleet

<a id="fleet"></a>

`api.fleet` lets a **fleet panel** (see [surfaces.md](surfaces.md#6-fleet-panels))
feed the search box and filter buttons of fleet mode. It is a plugin → host data
channel (the other one is [`api.notifications`](#notifications), write only; the rest are signals: `mpu:banner-expand`, `mpu:banner-collapse`,
`mpu:auth-logout`); the host stores the values and never interprets them.

```ts
api.fleet.publish(printerId, {
  tags: [{ id: 'printing', labelKey: 'acme.filter.printing', icon: 'print', order: 0 }],
  searchText: 'benchy.gcode',
});
api.fleet.retract(printerId);   // when the panel goes away
```

- `tags` — one filter button per distinct `id` across all printers, with a counter.
  The label is `i18n.t(labelKey)`; `icon` is a name from the shared icon set (on
  narrow screens only the icon is shown); `order` sorts the buttons. Selected tags
  are OR-ed; with the search text they are AND-ed.
- `searchText` — matched as a case-insensitive substring. The host already matches
  the printer name itself, so put only extra text here (for example the file being
  printed).
- `publish` replaces the previous record of **your plugin** for that printer;
  identical records are ignored, so it is cheap to call from an effect. Unknown
  printers are ignored. Limits: 16 tags, 512 characters of text.
- Do not publish what is not useful for search or filtering — the index is shared,
  not a storage.

---

## Notifications

<a id="notifications"></a>

`api.notifications` puts a message into the **host notification center**: a toast, a
badge on the bell above the right panel's "Collapse menu" button, and an entry in the
list. It is available with `pluginApi: "0.10"` and newer.

```ts
api.notifications.push({
  severity: 'error',                                   // 'critical' | 'error' | 'info'
  text: api.i18n.t('acme.heater.drift', { heater }),   // already translated
  label: api.i18n.t('acme.heater.source'),             // optional
});
```

- Only writing exists. A plugin cannot read, list or subscribe to notifications: the
  center is not a channel between plugins. The author is set by the host, so the
  entry is signed with your plugin's name when there is no `label`.
- `text` is translated by the caller at the moment of the call and is not retranslated
  when the language changes. Newlines become spaces; over 240 characters it is cut
  with `…`. An empty text is dropped.
- `label` is a short caption of the source (at most 40 characters), for plugins
  that report several kinds of events.
- `printerId` attributes the message to a printer; by default it is the active one.
  A background monitor that watches several printers must pass it explicitly.
- The same text from the same plugin for the same printer within 100 ms is shown
  once. The user can filter messages by regular expression and enable a sound for
  `critical`; both apply to all plugins.
- Do not use it for chatter: every call adds a toast and a history entry. Report what
  the user must notice (an alarm, a failure), not progress.

### From Klipper macros: `M118 MPU_NOTIFY`

A Klipper macro, which is not a plugin, can raise a notification too:

```
M118 MPU_NOTIFY <critical|error|info> <text>
```

Klipper echoes `M118` as `echo: MPU_NOTIFY …` in `notify_gcode_response`, and
`@core/system` turns that line into a notification (the caption is "Klipper macro").
The severity is case-insensitive, and the text is the rest of the line. This is an
input from outside the browser and works only while `@core/system` is enabled and the
printer is connected. A plugin should use `api.notifications.push`, not this route.

---

## Services

<a id="services"></a>

`api.services` reaches an **external HTTP service** of the plugin (Obico, a camera
server, a cloud API) through a proxy on the printer. It is available with
`pluginApi: "0.13"` and newer. Use it when the browser cannot call the service itself:

- the service sends no CORS headers, so a request from the Tessera page fails;
- the page is served over HTTPS and the service speaks plain `http://` (mixed content);
- the request needs a secret (token, API key) that should not live in the browser.

The proxy is part of the `tessera-ext` service of this Tessera host
([deployment.md](deployment.md#the-tessera-ext-service-installing-from-the-ui)). It is shared by
all printers of the host and is authorized with the Moonraker of the printer that serves the
host, like installing plugins.

**1. Declare the service in the manifest.** The proxy reads the declaration from the
*installed* manifest; a request can never change the header or the paths.

```json
"pluginApi": "0.13",
"services": [
  { "name": "obico", "authHeader": "X-Api-Key", "allowPaths": ["api/v1/", "media/"] }
]
```

| Field | Meaning |
|---|---|
| `name` | unique within the plugin, `[a-z0-9][a-z0-9-]{0,31}` |
| `authHeader` | header that carries the secret (`X-Api-Key`, `Authorization`, …); none — the service takes no secret. Headers the proxy owns (`Host`, `Cookie`, `Content-Type`, `Accept`, …) are refused |
| `authPrefix` | text before the secret, e.g. `"Bearer "`; default none |
| `allowPaths` | 1–20 path prefixes the proxy forwards, relative to the service address, no leading `/`, no `..` |

An invalid declaration is ignored as a whole: the service then does not exist for the proxy.

**2. Let the user set the address and the secret** (your settings UI):

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

- The address is `http(s)://host[:port][/base]`, without a login, query or fragment; private
  addresses are allowed (a self-hosted service lives in the LAN). The trailing `/` is removed.
- The secret is printable ASCII, at most 4096 characters. It is **write only**: `status` tells
  whether one is saved, never its value. `configure` without `secret` keeps the saved one, `''`
  clears it. Show an empty password field with "saved" next to it instead of the value.
- The user can do the same in a terminal: `tessera-ext service set <plugin> <name> <url>`.

**3. Make requests:**

```ts
const res = await api.services.fetch('obico', 'api/v1/printers/');
if (res.ok) printers = await res.json();

await api.services.fetch('obico', `api/v1/printers/${id}/`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action_on_failure: 'PAUSE' }),
});
```

- `path` is relative to the service address: no leading slash, already percent-encoded, may
  carry `?query`. It must start with one of `allowPaths`.
- The answer of the service comes back as a `Response` **whatever its status** (a 404 of the
  service is a 404 `Response`). Redirects are not followed: the proxy refuses them, so check
  trailing slashes in your paths.
- Only `Accept`, `Accept-Language` and `Content-Type` reach the service; the proxy adds the
  secret. The Moonraker token, cookies and other headers never leave the printer.
- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. Request body up to 1 MiB, answer up to
  16 MiB, 30 s timeout. Answers are served with `Content-Security-Policy: sandbox`: show images
  from them through `URL.createObjectURL(await res.blob())`; `<img src>` to the proxy does not
  work, every request needs the plugin header the host adds.

**Errors.** When the proxy itself refuses or is missing, the promise rejects with a
`ServiceError` (recognise it by `name === 'ServiceError'`; plugins import SDK types only):

| `status` | Meaning |
|---|---|
| `0`, `unavailable: true` | this Tessera has no proxy: dev server, `tessera-ext` service turned off, a Tessera older than 0.13 |
| `401` | not logged in to the host's Moonraker |
| `403` | the path is outside `allowPaths` |
| `404` | the service is not declared, or the plugin is not installed through `tessera-ext` (plugins added by URL have no proxy) |
| `409` | the service is not set up yet: ask the user for the address |
| `502` | the service is unreachable, redirected, or answered more than 16 MiB |
| `503` | the host was installed before 0.13: the proxy cannot save settings until `tessera update` |

The plugin id only keeps services of different plugins apart: all plugins run in the same
page, so this is not an isolation boundary between them.

---

## Environment

### `i18n`

```ts
api.i18n.t('hello.title');
api.i18n.t('hello.greeting', { name: 'Voron' });  // "Hello, {name}" → "Hello, Voron"
api.i18n.locale;                                  // 'ru'
```

All dictionaries, the host's and every plugin's, merge into one catalog per locale,
and the last registered value of a key wins, so prefix your keys. A key is looked up
in the locale, its base language, then `en`. If the key is found nowhere, `t` returns
**the key itself**. Substitutions are `{name}`, with `string | number` values. Details are in
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

## Extensions

`api.extensions` is the owner side of [extension points](surfaces.md#10-extension-points):
`list`, `resolve`, `onChange`, `mount`, `invoke`, `choice` / `setChoice`, `openChooser`.
Every `pointId` is an id of a point declared by **your** plugin. A contribution mounted
through `mount` gets the extension's own api, not yours. Svelte owners use
`ExtensionPoint` from `@sdk/svelte`.

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
