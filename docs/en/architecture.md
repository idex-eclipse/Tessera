# Host architecture

Tessera is a web UI for printers running Klipper/Moonraker. The host is the UI
orchestrator; everything substantive (temperatures, files, cameras, console) is done
by **plugins**. There is no backend: the host is a static Svelte 5 (runes) + Vite +
TypeScript application that talks straight to Moonraker and keeps its settings in
`localStorage`.

## Roles

| Component | Role | What it does NOT do |
|---|---|---|
| **Host** | printer tabs, sidebar, plugin slot, dashboard grid, Settings, theme, language, persistent surfaces (banners, overlays, chips, right panel, fleet) | does not read temperatures/status for its own UI, does not parse the Moonraker protocol, does not store printer business data |
| **MoonrakerProxy** | the connection pool (one WebSocket per printer), snapshot/TTL cache, pub/sub, subscription dedup, poll | is not read by the host to render its own UI |
| **GuardAgent** | the preflight pipeline of `request()`: polls plugin guards | is not a bus; plugins do not talk to each other |
| **HotkeyManager** | listens to `keydown`, matches plugin and host hotkeys, resolves conflicts | does not make decisions for a plugin |
| **Plugin** | a self-contained contribution: pages, widgets, banners, overlays, chips, fleet panels, guards, hotkeys | does not talk to other plugins |
| **Plugin SDK** | a thin wrapper: `PluginApi`, types, `defineMpuElement`, Svelte hooks | — |

## Diagram

```
HOST
header   : [Printer A][Printer B][+]                          [language][theme]
sidebar  : Dashboard | plugin pages | Settings
main     : [banners (in flow)] + [chip strip (in flow)]
           + ( dashboard grid  |  plugin page  |  Settings )
right    : the @core/system right panel (collapsible)
overlays : plugin windows (above main and right, below the offline overlay)
fleet    : a full-screen drawer below the header, cards of all printers
offline  : the connection-state overlay (above everything)

pool: Map<printerUrl, MoonrakerProxy>      ← infrastructure, not host state
        │  api.moonraker() (WS: subscriptions + request + cache)   │ HTTP directly for files/previews
        ▼                                                           ▼
   Moonraker (WebSocket + HTTP)  →  Klipper
```

## Application startup

The entry point is [`host/src/main.ts`](../../host/src/main.ts):

1. The stores are created in this order: `settings` → `printerManager` → `registry` →
   `ui` → `i18n` → `loader` (+ `guardAgent`) → `router`.
2. The **core plugins** (`loader.registerCorePlugin(manifest, module)`) and their
   locales are registered. This is static code in the host bundle; they are not
   written to `localStorage`.
3. `await loader.loadEnabledPlugins()` — loads **remote plugins** from
   `mpu:v2:plugins`: `fetch` the manifest → `import(entry)` → merge locales →
   sanitize → registry → guards. A failure of one plugin does not block the others.
4. `App.svelte` is mounted. It creates the `AppContext` and the `HotkeyManager` (and
   starts it) and renders the shell.

Offline **does not break loading**: connections come up in the background.

### AppContext

An object with dependencies that `App.svelte` puts into the Svelte context:
`settings`, `printerManager`, `registry`, `ui`, `i18n`, `loader`, `router`,
`hotkeys`. Host components get it through `getAppContext()`. Plugins **do not see**
it: they have only `PluginApi`.

## The core layer ([`host/src/core/`](../../host/src/core))

| File | Responsible for |
|---|---|
| `types.ts` | the single source of storage types and public contracts (re-exports `plugin-sdk/src/types`) |
| `surfaces.ts` | the table of contribution kinds (`pages`, `widgets`, `overlays`, `banners`, `chips`, `printerPanels`, `hotkeys`, `rightPanel`): validators, labels, the "persistent surface" flag |
| `plugin-loader.svelte.ts` | loading/installing/removing/enabling remote plugins; normalizing and sanitizing contributions; registering guards |
| `plugin-registry.svelte.ts` | the contribution registry (`getPages/Widgets/Overlays/Banners/Chips/PrinterPanels/Hotkeys/RightPanel`) and the user's per-printer preferences |
| `plugin-api-factory.ts` | creating `PluginApi` for a plugin |
| `plugin-api-cache.ts` | the single `PluginApi` cache: one api per plugin until the manifest changes |
| `moonraker-proxy.ts` | the proxy pool, WebSocket, caches, subscriptions, polling |
| `guard-agent.ts` | the guard pipeline |
| `hotkeys.ts` | pure logic: parsing combinations, matching events, conflicts |
| `hotkey-manager.svelte.ts` | the `keydown` listener, context (route/page/fleet), overrides |
| `host-hotkeys.ts` | the host's navigation keys |
| `settings-store.svelte.ts` | `localStorage`: printers, plugins, ui, printer and plugin settings |
| `settings-sync.svelte.ts` | sync flags and settings migration between modes |
| `printer-manager.svelte.ts` | the printer registry, the active printer, attaching proxies |
| `router.svelte.ts` | the hash router |
| `ui-store.svelte.ts` | theme, accent, panel sizes, fleet, applying attributes to `<html>` |
| `host-i18n.svelte.ts` | dictionaries and `t()`, language change, RTL |
| `auth-store.svelte.ts` | Moonraker tokens, the sign-in overlay |
| `extensions-catalog.svelte.ts` | reading `/extensions/index.json` |
| `legacy-settings.ts` | detecting obsolete `localStorage` keys |
| `default-layout.ts`, `default-chips.ts`, `layout-utils.ts` | the default dashboard and chip strip composition |

### The contribution registry

A single store organized by surface kind; all lists hold `{ pluginId, contribution }`
pairs in registration order. The order matters: core plugins register before remote
ones, and remote ones in the order of the `mpu:v2:plugins` records. The registry does
two things:

1. answers "which contributions are registered";
2. stores the user's per-printer preferences: page visibility, widget provider
   choice, dashboard layout, chips.

There are no priorities or "best provider": **what to show is decided only by the
user** (or by the plugin — for banners and overlays).

### The plugin loader

For every manifest:

1. `prepareManifest` — copies the contributions so as not to mutate the original object;
2. `normalizeContribs` — for the legacy `component`/`headerComponent` fields wraps the
   module's Svelte export into a Custom Element (`mpu-auto-…`) and substitutes
   `iconSvg` from `pageIcons`;
3. `sanitizeSurfaceContributions` — drops invalid contributions per the `surfaces.ts`
   table with a warning; `rightPanel` is accepted only from `@core/system`;
4. `activate` — loader state + registry + guards (a single path for core, remote and
   install/enable alike).

### PluginApi and its cache

`getPluginApi(ctx, pluginId)` returns the same `PluginApi` for a plugin until its
manifest object changes (hot update). Stability matters: `PluginElementHost`
re-creates the Custom Element when `api` changes. For a not-yet-loaded plugin (pages,
widgets) an api with a stub manifest is allowed.

## Surfaces and their rendering

All surfaces are rendered the same way:
[`PluginElementHost`](../../host/src/components/plugin-element-host.svelte) creates an
element by tag, sets the `api` and `params` properties and adds it to the DOM.
[`PluginSurface`](../../host/src/components/PluginSurface.svelte) is a thin wrapper
that fetches `api` from the cache by itself.

| Host component | Surface |
|---|---|
| `PluginSlot` | a plugin page |
| `Dashboard` / `WidgetContainer` / `PluginWidgetRenderer` | widgets |
| `PluginBanners` | banners |
| `PluginOverlaysLayer` | overlays |
| `QuickAccessPanel` / `AddChipDialog` | chips |
| `FleetMode` | fleet panels |
| `AppRightPanel` | the right panel |

Details and the `params` contracts are in [surfaces.md](surfaces.md).

## Routing

A hash router. It supports deep links, F5 and back/forward.

| URL | Route |
|---|---|
| `#/` | the active printer's dashboard |
| `#/p/:printerId` | a printer's dashboard |
| `#/p/:printerId/:pageId?query` | a plugin page (query → `params`) |
| `#/settings[/section]` | Settings |

Changing the active printer from the hash is part of the router; a click on a printer
tab leads to that printer's dashboard.

## Multi-printer support

- The host has a printer registry; one of them is *active* (the tab).
- The proxies of all printers live at the same time; switching the tab does not drop them.
- Plugin API: `moonraker()` / `settings` — the active printer (sugar),
  `moonrakerFor(id)` / `settingsFor(id)` — any printer.
- **Fleet mode** is a drawer below the header that covers main, the sidebar and the
  right panel. Opening fleet does *not* change the active printer. A closed fleet is
  unmounted.
- The `fleetOpen` state persists between sessions.

## Connection state

- A status badge on the printer tab (from the proxy's `readyState`).
- The **offline overlay** is shown over the UI when the active printer is
  unreachable: status, a Retry button, the time of the last connection. The user can
  switch to another printer without closing the overlay. The overlay shows only
  infrastructure status and does not read printer data.
- The Klipper banner (in `@core/system`) is a separate thing: firmware state, not
  connection state.

## What is deliberately not in the host

- a shared bus between plugins, shared state, `emit/on`;
- granular permissions, capabilities, priority, "best provider";
- request mutation by guards and guard priorities;
- auto-updating remote plugins from the network;
- a backend/server for storing settings.

## Development

```bash
npm run dev            # Vite dev server (host + serving extensions/)
npm run build          # production build of the host into host/dist
npm run typecheck      # tsc --noEmit
npm run svelte-check   # checking .svelte files
npm test               # vitest (node environment)
```

Tests live next to the code (`__tests__/`, `*.test.ts`) and run in a node
environment. Svelte effects (`$effect`) do not run in it, so code that must be
testable without a DOM is moved into pure functions (example: `hotkeys.ts` + an
explicit `checkConflicts()` in the manager).

## Repository layout

```
host/            the host application (src/core, src/components, src/pages, src/i18n, src/styles)
plugin-sdk/      types, define-element, Svelte hooks
plugins/         core plugins (+ plugins/shared — shared UI bricks and parsers)
extensions/      the provisioning folder of remote plugins (+ index.json)
tools/           extensions-sync.cjs
deploy/          install.sh and the nginx configuration
docs/            this documentation (ru/ and en/)
```

`plugins/shared/*` is the shared code of the core plugins (file table, editor,
dialogs, parsers). It is **not** a data channel between plugins but UI bricks that the
core plugins import statically. A remote plugin does not use this code: it is
self-contained and carries its dependencies in its bundle.
