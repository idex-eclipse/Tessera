# Settings and storage

Tessera has no backend: all settings live in the browser's `localStorage` and are
tied to the origin and the device. The schema is versioned with the `mpu:v2:` prefix.

## localStorage keys

| Key | Content |
|---|---|
| `mpu:v2:printers` | `[{ id, name, url }]` — the printer registry |
| `mpu:v2:activePrinter` | the active printer's `id` |
| `mpu:v2:plugins` | remote plugins: `[{ manifestUrl, enabled, printerIds, source, installedVersion }]` |
| `mpu:v2:ui` | device UI: theme, language, `dir`, panel sizes, background, accent, fleet, hotkey overrides |
| `mpu:v2:editor-colors` | config editor syntax colors: `{ v: 1, light: { <token>: '#rrggbb' }, dark: { … } }` — only the tokens the user changed; applied as CSS variables `--tok-<token>` (editor header → settings button) |
| `mpu:v2:settings:<printerId>` | printer settings: page visibility, widget providers, dashboard layout, chips |
| `mpu:v2:settings:GLOBAL` | the same, shared by all printers (if dashboard sync is on) |
| `mpu:v2:plugin-settings:<printerId>:<pluginId>` | a plugin's settings for a printer (`api.settings`) |
| `mpu:v2:plugin-settings:GLOBAL:<pluginId>` | a plugin's settings shared across the device (sync on) |
| `mpu:v2:settingsSync` | `{ plugins: { <pluginId>: boolean }, dashboard: boolean }` — sync flags |
| `mpu:v2:auth:<printerId>` | the Moonraker authorization token for a printer |

Core plugins are **not written** to `mpu:v2:plugins`: they are built into the host
bundle.

### `mpu:v2:plugins`

| Field | Description |
|---|---|
| `manifestUrl` | the manifest URL (absolute or relative to the host's origin) |
| `enabled` | whether the plugin is enabled |
| `printerIds` | empty — on all printers; otherwise only on those listed (applies to chips and hotkeys) |
| `source` | `'catalog'` or `'url'` — where it was installed from |
| `installedVersion` | the version at install time (for the "update available" badge) |

### `mpu:v2:ui`

```ts
interface UiState {
  theme: 'light' | 'dark';
  locale: string;
  dir: 'ltr' | 'rtl';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelWidth: number;
  bgImage: string | null;          // data URL of the user's background
  accent: string | null;           // accent color, '#rrggbb'
  fleetOpen?: boolean;
  fleetPanels: { pluginId: string; contributionId: string; visible: boolean }[];
  fleetPanelsCustomized: boolean;
  hotkeyOverrides: Record<string, string | null>;   // "<pluginId>:<id>" → combination | null
}
```

### `mpu:v2:settings:<printerId>`

```ts
interface PrinterSettingsState {
  pages: Record<string, boolean>;               // page visibility (by page id); no key = visible
  widgetProviders: Record<string, string>;      // type → provider (written when providers > 1)
  dashboardLayout: DashboardWidgetLayoutItem[]; // { instanceId, type, provider, x, y, w, h }
  dashboardLayoutCustomized?: boolean;          // false → a "virtual" default layout
  quickChips: QuickChipLayoutItem[];            // { instanceId, type, provider, id, label? }
  quickChipsCustomized?: boolean;
}
```

Until the user changes the layout, the host shows the *default* set (it is not
written to storage and adapts to the installed plugins); the first change fixes the
layout and sets the `…Customized` flag.

---

## Plugin settings (`api.settings`)

For a plugin this is simply a "key → JSON value" store (see
[plugin-api.md](plugin-api.md#settings)). Useful to know about storage:

- One JSON object per "printer + plugin" pair is stored in `localStorage`. Values
  must be JSON-serializable.
- Writing is synchronous; changes immediately notify `onChange` subscribers
  (including other instances of your plugin on other surfaces).
- The host keeps an in-memory cache; the cache key, like the storage key, accounts
  for the sync mode.

### Synchronization between printers (sync)

Settings → Plugins: each plugin has a **sync** toggle (off by default).

| Mode | Where the settings live |
|---|---|
| sync off | `mpu:v2:plugin-settings:<printerId>:<pluginId>` — separate per printer |
| sync on | `mpu:v2:plugin-settings:GLOBAL:<pluginId>` — one set for all printers on the device |

The plugin knows nothing about the mode: the API is the same. On switching, data is
carried over like this (the switch is performed on the **active** printer, and the
transfer concerns its set):

- **turning on** copies the active printer's settings into the shared set, but only
  if the shared set is still empty (existing shared settings are not overwritten);
- **turning off** writes the shared set into the active printer's set (overwriting
  it); the other printers' sets stay as they were before sync was enabled.

`onChange` subscribers get the update immediately, without a page reload.

Consequence for developers: **anything you write to `api.settings` may end up shared
across all printers** (table columns, sortings, user prefs). Do not store things
there that must be unique per printer (calibrations, a specific camera's URL), or
provide keys that include the printer identifier.

A separate `dashboard` flag in `mpu:v2:settingsSync` switches the dashboard layout
and chips storage to the shared `mpu:v2:settings:GLOBAL`.

### Recommendations

- Keys with an area prefix: `columns:page:gcodes`, `sort:widget:history`.
- Version the value format if it may change (`{ v: 2, … }`), and be able to read the
  old one.
- Do not put large data in settings (images, logs): this is `localStorage`
  (about 5 MB per origin for all keys together).
- Set defaults on read: `get(k) ?? default`.

---

## Export and import

Settings → About / Debug:

- **Export** saves **all** `mpu:v2:*` keys to JSON, including `mpu:v2:auth:*`
  (Moonraker authorization tokens!). Do not send an export to outsiders.
- **Import** writes the `mpu:v2:*` keys from the file into `localStorage` and
  reloads the page; foreign keys are skipped.

## Incompatible schema

On start the host looks for keys of old schemas (`mpu:v1:*` or `mpu:*` without
`v2`). If it finds any, it shows a "settings format changed" dialog: the user
exports the old data or resets it. There is no automatic migration — you will not
get old plugin settings back without configuring them again.

## What the host does not keep in localStorage

Nothing. Printer data (files, history, temperatures) lives in Moonraker/Klipper; the
host does not duplicate it and does not read it for its own UI. The fleet search
index (tags and the name of the file being printed, published by fleet panels) is
kept in memory only and is never persisted.
