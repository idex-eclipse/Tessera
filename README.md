<p align="center">
  <strong>English</strong> · <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="host/public/logo.svg" width="128" alt="Isometric tesseract" />
</p>

<h1 align="center" id="top">Tessera</h1>

<p align="center">
  <strong>Modular web UI for Klipper / Moonraker 3D printers.</strong><br/>
  A plugin-based dashboard: the host orchestrates, plugins contribute tiles,<br/>
  and everything you see is a mosaic of independent, glanceable surfaces.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" /></a>
  <img alt="Svelte 5" src="https://img.shields.io/badge/svelte-5-ff3e00.svg" />
  <img alt="Vite" src="https://img.shields.io/badge/vite-5-646cff.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6.svg" />
  <img alt="No backend" src="https://img.shields.io/badge/backend-none-informational.svg" />
  <img alt="Version" src="https://img.shields.io/badge/version-0.3.0-green.svg" />
</p>

---

> *Read this first: I'm not a programmer, and not a frontend developer. Tessera was
> fully built with AI. Expect rough edges, unconventional choices, and the
> occasional bug I haven't met yet. Issues and pull requests are genuinely welcome; if
> something looks strange, there is usually a documented reason a couple of files away.*

---

## Table of Contents

- [Tessera](#top)
- [Features](#features)
  - [Dashboard & widgets](#dashboard-widgets)
  - [Quick-access chip strip](#quick-access-chip-strip)
  - [Calibration suite](#calibration-suite)
  - [Files, editor, preview](#files-editor-preview)
  - [System & notifications](#system-notifications)
  - [Console](#console)
  - [Multi-printer & personalization](#multi-printer-personalization)
  - [Hotkeys](#hotkeys)
- [Requirements](#requirements)
- [Installation](#installation)
  - [One-liner (Armbian / Debian)](#installer-one-liner)
  - [Manual / development](#manual-development)
  - [First launch](#first-launch)
- [For developers](#for-developers)
  - [Documentation](#documentation)
  - [Architecture in one paragraph](#architecture)
  - [Plugin model](#plugin-model)
  - [Guards](#guards)
  - [Hotkeys API](#hotkeys-api)
  - [Remote plugins & delivery](#remote-plugins-delivery)
  - [Where settings live](#where-settings-live)
  - [Project structure](#project-structure)
- [Licensing](#licensing)
- [Acknowledgments](#acknowledgments)

---

Tessera is a browser-only control panel for Klipper printers. It talks to Moonraker directly over a single WebSocket per printer, keeps all your preferences in `localStorage`, and ships **no backend of its own** — the printer host runs Klipper and Moonraker, Tessera just renders them beautifully.

The UI is built from **plugins**: the host provides the shell (printer tabs, sidebar, dashboard grid, settings, theming, notification surfaces) and every functional block — temperature graphs, macros, calibration wizards, file tables — is a plugin contribution. Third-party plugins are first-class citizens: they are loaded as Custom Elements and can be written in **any framework**.

<a id="features"></a>
## Features

<a id="dashboard-widgets"></a>
### Dashboard & widgets

A drag-and-drop grid of autonomous widgets, arranged per printer:

- **Temperature** — live multi-heater chart (temp / target / power), per-sensor chips, click-to-isolate series
- **Status** — print progress, layer & ETA, pause / resume / cancel, speed & flow factors
- **Macros** — buttons with automatic parameter forms parsed from your macro bodies (defaults pre-filled, required fields flagged)
- **Tools** — jog cross/rows, extrude & retract, force move, motors off, IDEX carriage modes (PRIMARY / COPY / MIRROR / experimental DIRECT-mode from [Dmitry Butyugin's fork of Klipper for IDEX printers](https://github.com/dmbutyugin/klipper/tree/generic-cartesian)), active-tool awareness, plus one-tap **QGL** / **Z-tilt** buttons when those commands are available
- **Limits** — velocity, acceleration and square-corner velocity on the fly
- **Outputs** — fan sliders and output-pin control (PWM and digital), plus read-only indicators for Klipper-managed auto-fans (heater_fan / controller_fan / temperature_fan)
- **Camera** — live MJPEG/HLS views, multiple streams
- **Filament** — runout sensor status and enable/disable
- **Job queue** — reorder, start, manage queued prints

Every widget is data-autonomous: it subscribes to the proxy itself, so two widgets never share a hidden channel, and a broken plugin cannot take down the rest of the UI.

<a id="quick-access-chip-strip"></a>
### Quick-access chip strip

A persistent strip under the banners keeps the most urgent controls one tap away on **every page** — mid-print, on the jobs screen, in settings:

- **Temperature chips** — current value, target badge, heating/cooling trend, tap-to-set popover with presets
- **Macro chips** — run instantly, or open the parameter form
- **Output chips** — fan/pin state with spinning-fan feedback; preset buttons (0/25/50/75/100 %) + fine slider
- **Tuning chips** — pressure advance, retraction, flow and speed factor, with a live preview of the exact G-code that will be sent
- **Live Z chip** — step-adjust the running Z-offset (0.01–0.1 mm), bake it into the probe, save to config
- **Filament chips** — detected / empty / off at a glance, toggle from the popover
- **Power chips** — Moonraker power devices, **tap the chip itself to toggle** (lights, printer power, enclosure fan) — works even when Klipper is not ready, and respects server-side `locked_while_printing`

Chips survive navigation and printer switches. In dashboard edit mode you add them from per-provider accordion pickers, drag them to reorder, and remove them with explicit controls; removed or renamed devices show an explicit *unavailable* state instead of silently decaying. Touch and stylus reordering are supported through the same host-wide drag-and-drop polyfill used by other editable surfaces.

<p align="left">
  <img src="docs/screenshots/Dashboard.png" alt="Dashboard" width="40%"/>
  <img src="docs/screenshots/Dashboard2.png" alt="Dashboard" width="40%"/>
</p>

<a id="calibration-suite"></a>
### Calibration suite

One page, four tabs, one consistent panel language — every action shows a read-only preview of the G-code it will run, and **sends exactly that preview**:

- **Input shaper** — `TEST_RESONANCES` / `SHAPER_CALIBRATE` with live fitted/recommended readouts, a runs table with apply-to-config, and an optional shell-command pipeline that renders resonance PNG graphs straight into your config folder
- **Belt tension** — auto-detected from kinematics (CoreXY / Delta / generic cartesian), comparative graph in a single run
- **Probe & Z offset** — auto-detected probe type (eddy current / probe / bltouch / endstop), calibration wizard, accuracy runs table, manual-probe overlay, multi-chip eddy selection
- **Heaters (PID)** — autotune with live temperature/power chart, Kp/Ki/Kd cards, and a deviation monitor that alerts when a tuned heater drifts from target
- **Bed mesh** — sector-based 2D widget with average deviation per cell, uniform X/Y scale, axis rulers, click-to-zoom and right-click-to-zoom-out; full mesh tooling includes 3D surface visualization with vertical exaggeration, profile management, Z-tilt / QGL / screws-tilt tools, and TEST_Z refinement overlay

Long-running calibrations survive tab switches and printer switching — activity is tracked from Moonraker's g-code store, so a tune started in another client is visible here too.

<p align="left">
  <img src="docs/screenshots/Calib1.png" alt="Probe section" width="40%"/>
  <img src="docs/screenshots/Calib2.png" alt="Heater section" width="40%"/>
</p>

<a id="files-editor-preview"></a>
### Files, editor, preview

- **Universal file table** across jobs / config / logs: extended G-code metadata (filament, time, thumbnails, printed/queued status), column manager with drag-to-reorder, per-printer sort & columns, context menus
- **3MF inspector** — open OrcaSlicer / Bambu-lineage projects in the browser: inspect plates, slice summaries and filament slots, preview thumbnails, and **extract the embedded G-code** for printing (raw `.3mf` is never uploaded to Moonraker)
- **Config & G-code editor** — fullscreen editor with Klipper-config and G-code syntax highlighting, Jinja highlighting, section TOC, own find/replace (layout-independent hotkeys), line numbers, auto-pairs, and *Save & Restart* for `.cfg` / `moonraker.conf`
- **G-code preview** — 2D and 3D viewers with live print-progress overlay, layer scrubbing, **follow-print** mode, and **exclude object** controls. The 3D viewer renders extrusion as solid filaments rather than plain lines, while travel moves stay as thin guides. Exclude-object UI appears when Klipper actually reports print objects — i.e. during an active print — and every exclusion is irreversible and confirmation-guarded.

<p align="left">
  <img src="docs/screenshots/3MF.png" alt="3MF upload dialog" width="40%"/>
</p>

<a id="system-notifications"></a>
### System & notifications

- **Right panel** (always available): emergency stop, service restarts, power devices, host shutdown/reboot, upload-and-print, Moonraker accounts
- **Notification center** — toasts + a filterable side panel, aggregated across all configured printers with per-printer badges; fed by Klipper responses, shutdowns, **TMC driver flags** (over-temperature / stall, edge-detected), guard denials, and plugin notifications (`M118 MPU_NOTIFY …` convention)
- **Machine page** — CPU / memory / network stats, live load charts, MCU inventory and versions, update manager with commit history and rollback
- **Klipper state banner** — distinct from connection status: firmware errors and startup are shown where they belong

<a id="console"></a>
### Console

A view over Moonraker's g-code store with command autocomplete (including **macro-parameter mode**: type `MACRO ` and get `NAME=` suggestions with types and defaults), a built-in G/M-code catalog with parameter signatures, regex message filters, and reverse/autoscroll preferences.

<p align="left">
  <img src="docs/screenshots/Console.png" alt="Console" width="40%"/>
</p>

<a id="multi-printer-personalization"></a>
### Multi-printer & personalization

- **Printer tabs** with per-printer dashboard layout, chip strip, widget providers, page visibility and plugin settings
- **Warm switching** — per-printer hook cores are kept alive across tab changes and fleet drawer cycles, so returning to a printer restores live data without a cold resubscribe flash
- **Fleet mode** — tap the grid button below the tabs to slide open a drawer showing every printer's camera, print status, tool position, and temperatures in a live card grid. Each card is read-only and talks to its own printer; tap **Activate** to jump to that printer's dashboard. Panels are plugin-contributed (`printerPanels` in the manifest), so third-party plugins can add their own fleet cards.
- **Fleet panel editor** — the drawer header includes an **Edit panels** action: reorder fleet panels with drag-and-drop and hide/show them per device. The layout is stored device-globally and applied consistently across printer cards.
- **Offline overlay** — infrastructure-only (never reads business data); you can switch printers without dismissing it
- **Settings sync** — opt-in per plugin, device-global
- **Themes** — light & dark, every color a CSS variable; accent customization and custom background images are supported
- **i18n** — English & Russian, RTL-ready layout

<a id="hotkeys"></a>
### Hotkeys

Keyboard navigation plus shortcuts contributed by plugins, all remappable in **Settings → Hotkeys**:

- **Navigation** — `F` toggles fleet mode, `Ctrl+1` … `Ctrl+9` jump to the printer with that number, `Ctrl+←` / `Ctrl+→` cycle through printers
- **Plugin shortcuts** — a plugin declares them in its manifest with a scope: *global* (everywhere), *dashboard* (only on the dashboard) or *plugin* (only on that plugin's own page)
- **Layout-independent** — letters and digits match the physical key, so `Ctrl+K` works on a Russian layout too; modifiers are `Ctrl`, `Alt`, `Shift`, `Cmd`/`Meta`, and `Mod` means Cmd on macOS and Ctrl elsewhere
- **Conflict-safe** — if two shortcuts collide, **both are disabled** with a console warning and a mark in Settings (the same key is fine for *dashboard* + *plugin*, or for two different plugins' own pages)
- **Typing-safe** — bare keys and `Shift+key` never fire while you type in a field; `Ctrl`/`Alt`/`Cmd` combos do
- **Yours to change** — rebind, disable or reset any shortcut (host or plugin); overrides are stored device-wide

Some combinations are claimed by the browser or OS before the page sees them (for example `Ctrl+1…9` tab switching in some browsers, or `Ctrl+←/→` Spaces switching on macOS) — rebind those in Settings.

<a id="requirements"></a>
## Requirements

- **Klipper** + **Moonraker** on the printer host (recent versions; Moonraker with file, update and device-power APIs)
- A modern evergreen browser (Custom Elements, ES modules, `DecompressionStream` for 3MF)
- Node.js ≥ 18 only if you build from source (the installer handles this)

Optional companions:

| Component | Enables |
|---|---|
| `gcode_shell_command` Klipper extension | shaper / belt PNG graphs (install manually via kiauh) |
| crowsnest / mjpegstreamer / ustreamer | camera widgets |
| Spoolman (via Moonraker) | filament-spool plugin (separate remote plugin, in development) |

<a id="installation"></a>
## Installation

<a id="installer-one-liner"></a>
### One-liner (Armbian / Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/idex-eclipse/tessera/main/deploy/install.sh \
  -o /tmp/tessera-install.sh && bash /tmp/tessera-install.sh
```

The installer is **idempotent** — re-running it updates everything in place. It will:

1. install system dependencies (`git`, `curl`, `nginx`) and Node.js 20 if missing;
2. clone (or update) the repo into `~/tessera` and build the frontend;
3. write an nginx site (`sites-available/tessera` + symlink in `sites-enabled`) modeled on the kiauh/fluidd pattern: SPA fallback, no-cache `index.html`, gzip, unlimited upload size, `location /extensions/` for plugin provisioning, and reverse-proxies `/websocket` + `/printer|api|access|machine|server/` to Moonraker — so the UI is **same-origin with Moonraker and needs no `moonraker.conf` changes**;
4. create `tessera-shell.cfg` (shaper/belt graph shell commands) in your Klipper config dir and include it in `printer.cfg` **only if** the `gcode_shell_command` extension is detected — otherwise it prints the manual kiauh install instructions and leaves the include out, so a missing extension can never brick your config on restart;
5. remind you to `FIRMWARE_RESTART` when ready.

<details>
<summary><strong>Installer configuration (env vars / prompts)</strong></summary>

| Variable | Default | Purpose |
|---|---|---|
| `TESSERA_DIR` | `~/tessera` | clone + build + extensions directory |
| `TESSERA_PORT` | `8000` | nginx port for the UI (prompted, re-asked on conflict) |
| `TESSERA_REPO` / `TESSERA_BRANCH` | repo / `main` | forks and dev channels |
| `TESSERA_MOONRAKER` | `127.0.0.1:7125` | Moonraker upstream for the proxy |
| `TESSERA_KLIPPER_CFG` | `~/printer_data/config` | Klipper config dir (multi-instance kiauh aware) |
| `TESSERA_KLIPPER_DIR` | `~/klipper` | used to detect `gcode_shell_command` |
| `TESSERA_SKIP_NGINX=1` | off | bring your own reverse proxy |
| `TESSERA_SKIP_KLIPPER_CFG=1` | off | web UI only, touch no Klipper config |
| `TESSERA_NO_PROMPT=1` | off | fully non-interactive (CI) |

Uninstall: remove the `sites-enabled/tessera` symlink, the `[include tessera-shell.cfg]`
line from `printer.cfg`, and `~/tessera`.

</details>

<a id="manual-development"></a>
### Manual / development

```bash
git clone https://github.com/idex-eclipse/tessera.git
cd tessera
npm install
npm run dev        # vite dev server + /extensions/ middleware
npm run build      # production bundle → host/dist
npm run typecheck  # tsc --noEmit
npm run svelte-check
npm run test       # vitest
```

Serve `host/dist` with any static server and reverse-proxy Moonraker's API and
WebSocket to the same origin (see `deploy/install.sh` for the reference nginx
config).

<a id="first-launch"></a>
### First launch

1. Open `http://<printer-host>:8000`.
2. Click **[+]** in the printer tabs and enter the Moonraker URL (`http://127.0.0.1:7125` on the same machine).
3. Tessera connects and lights up only the widgets, chips and pages your printer actually has — feature detection is per printer.

<a id="for-developers"></a>
## For developers

<a id="documentation"></a>
### Documentation

Full developer documentation lives in [`docs/en`](docs/en/README.md) (Russian: [`docs/ru`](docs/ru/README.md)):

| | |
|---|---|
| [Plugin development guide](docs/en/plugin-development.md) | manifest, Custom Element contract, build rules, lifecycle, pitfalls |
| [Surfaces](docs/en/surfaces.md) | pages, widgets, banners, overlays, chips, fleet panels, hotkeys |
| [PluginApi](docs/en/plugin-api.md) | the full API reference |
| [Moonraker proxy](docs/en/moonraker-proxy.md) | requests, subscriptions, cache, polling, errors, auth |
| [Guards](docs/en/guards.md) · [Hotkeys](docs/en/hotkeys.md) | pre-flight request checks · keyboard shortcuts |
| [Settings](docs/en/settings.md) · [i18n & theming](docs/en/i18n-and-theming.md) · [Deployment](docs/en/deployment.md) | storage, translations & CSS variables, installing plugins |
| [Architecture](docs/en/architecture.md) | how the host is put together |

<a id="architecture"></a>
### Architecture in one paragraph

The **host** is a deliberately dumb orchestrator: printer tabs, sidebar, dashboard grid, settings, theme, locale, and the persistent surfaces (banners, chip strip, overlays, right panel). It never parses Moonraker's protocol and never reads business data to draw its own chrome. **MoonrakerProxy** pools one WebSocket per printer with snapshot caching, subscription de-duplication and poll-on-demand. **GuardAgent** wraps every plugin `request()` in a declarative pre-flight chain and is target-printer aware, so fleet/multi-printer actions are checked against the printer being addressed. **Plugins** are autonomous contributions — pages, widgets, chips, overlays, banners, printer panels — that subscribe to the proxy themselves and never talk to each other. Per-printer data hooks are pooled through a **core-keeper**: cores are created lazily, reference-counted, and kept alive after consumers unmount, so plugin state survives navigation and fleet drawer cycles. The **SDK** is a thin hook layer. All contribution kinds (pages, widgets, overlays, banners, chips, printer panels, hotkeys) go through one registry table, a single per-plugin API cache serves every surface, and a **HotkeyManager** resolves keyboard shortcuts across host and plugins. There is no backend, no shared state bus, and no plugin-to-plugin channel, by design.

<a id="plugin-model"></a>
### Plugin model

Plugins contribute through a manifest:

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
  hotkeys?: HotkeyContribution[];    // keyboard shortcuts: global / dashboard / plugin-page scope
  guards?: GuardContribution[];      // pre-flight request interception
  locales?: string[];
  defaultSettings?: Record<string, unknown>;
}
```

Surfaces are rendered as **Custom Elements**; the host injects the plugin API and params as properties (`api`, `params`). Core plugins use Svelte 5 runes via a context auto-wrapper; **remote plugins can be written in any framework** — the contract is CE + property injection (battle-tested with a React 18 plugin).

The plugin API gives you:

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
api.printers               // printer registry (read-only); onPrintersChange
api.onPrinterChange / onLocaleChange / onThemeChange
```

**Printer panels** (`printerPanels`) are Custom Elements that render once per printer while fleet mode is open. The host injects `params.printerId`; the panel reads its data through `api.moonrakerFor(printerId)` and persists preferences through `api.settingsFor(printerId)`. Each panel instance is isolated — unmounting one card does not affect others, and closing the drawer tears down all subscriptions cleanly.

The fleet drawer can reorder and hide these panels per device. The host keeps the DOM in stable registration order and changes visual order with CSS `order`, so panels are not remounted when the user drags them. This preserves Custom Element internal state and avoids zero-height collapse artifacts.

Core `@core/widgets` ships four fleet panels today:

- camera
- print status
- tool position
- temperatures

Third-party plugins can contribute their own fleet panels using the same
contract.

<a id="guards"></a>
### Guards

Guards are declarative matchers on the request **method string** (e.g. `printer.gcode.script`, `printer.print.start`). The host builds a chain from all matching guards minus the initiator's own (anti-recursion), walks it sequentially, and each handler returns `allow`, `deny` (with attribution) or `freeze` — a parked request the guarding plugin resumes via token after showing its own overlay. Handlers receive the target printer id, so multi-printer and fleet actions can be validated against the printer actually being addressed. Timeouts are fail-closed (10 s decision, 10 min park) and surface in the notification center. Guards never mutate requests, have no priorities beyond registration order, and are a **pre-flight check of local actions, not a security boundary** — prints started from other clients are invisible to them by design.

<a id="hotkeys-api"></a>
### Hotkeys API

Shortcuts are declarative, like guards:

```json
{ "hotkeys": [ { "id": "acme-refresh", "scope": "plugin", "keys": "Alt+R",
                 "handler": "refreshHandler", "titleKey": "acme.hotkey.refresh" } ] }
```

`handler` names an export of the plugin module with the signature `(api, event) => void | Promise<void>`. `scope` is `global`, `dashboard` or `plugin`. The host owns the listener, scope resolution, conflict detection (colliding shortcuts are disabled together) and the user's rebinding UI; the plugin just reacts. See the [hotkeys reference](docs/en/hotkeys.md).

<a id="remote-plugins-delivery"></a>
### Remote plugins & delivery

Four layers, no network auto-updates — **files on disk are the source of truth**
(analogous to Klipper extras):

1. **Provisioning** — `extensions/<id>/` on the host (dev: vite middleware; prod: nginx `location /extensions/`);
2. **Discovery** — same-origin catalog `/extensions/index.json`, regenerated by `tools/extensions-sync.cjs`; plus an advanced *Add by URL* mode with a trust confirmation and an `external` badge;
3. **Loading** — fetch manifest → resolve entry against the manifest origin → `import()` → merge locales → sanitize contributions;
4. **Enablement** — per-printer enable, version badges, hot *Update* without reload.

Remote plugin build rules (vite lib-mode): define `process.env.NODE_ENV`, keep runtime dependencies bundled (bare imports don't resolve in browser `import()`), and keep `manifest.entry` in sync with the built filename.

<a id="where-settings-live"></a>
### Where settings live

Everything is `localStorage` under a versioned prefix (`mpu:v2:*`): printers, active printer, installed plugins, UI prefs (including fleet-mode state, fleet panel order/visibility, accent color, background image and hotkey overrides), per-printer dashboard/page/chip layout, and plugin settings (per printer or device-global). Schema changes show an export-or-reset dialog — there are no silent migrations.

<a id="project-structure"></a>
<details>
<summary><strong>Project structure</strong></summary>

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
│   │                #   3MF inspector, uPlot core, core-keeper) — never a data bus
│   ├── widgets-core/  # temperature, status, macros, tools, limits, outputs,
│   │                  #   camera, filament, job-queue + their chips + fleet panels
│   ├── calibrations/  # shaper / belts / probe / heaters / mesh + livez chip
│   ├── system/        # right panel, banner, notifications, machine page, power chip
│   └── console · jobs · history · config · gcode-preview
├── extensions/      # remote-plugin provisioning folder (index.json generated)
├── tools/           # extensions-sync.cjs
├── deploy/          # install.sh, reference nginx config
└── docs/            # developer documentation (en/, ru/)
```

</details>

<a id="licensing"></a>
## Licensing

- **GPL-3.0**. Forks and distributions (appliance images, pre-loaded boxes) must stay open. This matches the Klipper/Moonraker ecosystem.

<a id="acknowledgments"></a>
## Acknowledgments

[Klipper](https://www.klipper3d.org/) and [Moonraker](https://github.com/Arksine/moonraker) firmware/API ecosystems; [Mainsail](https://mainsail.xyz/) and [Fluidd](https://fluidd.xyz/) for UX inspiration; [Svelte](https://svelte.dev/), [Vite](https://vitejs.dev/), [uPlot](https://github.com/leeoniya/uPlot) and [three.js](https://threejs.org/) under the hood.

---

<p align="center">
  <em>Tessera — modular UI for modular printers.</em>
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.ru.md">Русский</a>
</p>