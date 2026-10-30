# Surfaces (plugin contributions) reference

A "surface" is a place in the host's UI where a plugin can mount its Custom
Element. The host owns the place itself (layout, z-order, showing/hiding the
container); the plugin owns the content.

| Surface | Manifest | Where it lives | Who decides whether to show it | Remote |
|---|---|---|---|---|
| [Page](#1-pages) | `pages[]` | the main area, a sidebar entry | the user (Settings → Pages) | yes |
| [Widget](#2-widgets) | `widgets[]` | the dashboard grid | the user (dashboard layout) | yes |
| [Banner](#3-banners) | `banners[]` | top of main, in flow | the **plugin** | yes |
| [Overlay](#4-overlays) | `overlays[]` | above main and the right panel | the **plugin** | yes |
| [Chip](#5-quick-access-chips) | `chips[]` | the strip under the banners | the user (edit mode) | yes |
| [Fleet panel](#6-fleet-panels) | `printerPanels[]` | a printer card in fleet mode | the user (panel editor) | yes |
| [Hotkey](#7-hotkeys) | `hotkeys[]` | global | the user (Settings → Hotkeys) | yes |
| Right panel | `rightPanel` | the column on the right | — | **no** (`@core/system` only) |

Layers, top to bottom:

```
offline-overlay       — connection status (host only)
plugin overlays       — modal windows
right panel           — the column on the right
banners               — in flow at the top of main (push content down)
chip strip            — in flow under the banners
main content          — dashboard / plugin page / Settings
```

## General rules for all surfaces

1. **One contribution — one Custom Element.** The `element` field is the tag the
   plugin registered in its module.
2. **The host passes `api` and `params`** as properties (see
   [plugin-development.md](plugin-development.md#4-the-custom-element-contract)).
3. **The host does not read business data.** Everything a surface shows, it gets
   from Moonraker itself. The only exception is the opaque fleet index (tags and
   search text that fleet panels publish; the host never interprets them — see
   [architecture.md](architecture.md#fleet-index)).
4. **A single visual language** — the panel (see
   [i18n-and-theming.md](i18n-and-theming.md#panel-language)).
5. The host mounts the element when the surface appears on screen and unmounts it
   when it disappears. Release subscriptions in `disconnectedCallback`.
6. For pages and widgets, `id`/`type` are global names — use a plugin prefix.

---

## 1. Pages

```json
{
  "pages": [
    { "id": "acme-hello", "titleKey": "hello.title", "icon": "file",
      "element": "acme-hello-page" }
  ]
}
```

| Field | Description |
|---|---|
| `id` | page identifier; **globally unique** (see below) |
| `titleKey` | i18n key of the name in the sidebar |
| `icon` | name of a built-in host icon (the "file" icon by default) |
| `iconSvg` | a custom icon: an SVG string. You may omit it from the manifest and export `pageIcons: Record<string,string>` from the module instead — the loader substitutes `pageIcons[icon]` |
| `element` | the page's CE tag |

**Route:** `#/p/<printerId>/<pageId>?<query>`. The page receives the query as
`params` (`?file=a.gcode` → `params.file`). This is how deep links work: another
plugin (or the user) can send someone to your page with
`#/p/<printer>/<pageId>?file=…`.

**Visibility.** The pages of all registered plugins appear in the sidebar. The
user can hide a page for a specific printer in Settings → Pages. A page is visible
by default.

**The page title** is not drawn by the host: the name is set by the sidebar entry;
inside the page use panel headers.

**Layout.** A page occupies the whole main area and scrolls together with it. The
recommended structure is a vertical stack of panels. A grid of several
independently scrolling panels is acceptable if they form one working surface
(example: the console — log + command reference).

**Identifier.** A page is looked up by `id` among *all* plugins and visibility is
stored by the bare `id`: two plugins with the same page `id` conflict.

---

## 2. Widgets

```json
{
  "widgets": [
    {
      "type": "acme-gauge",
      "provider": "acme/hello",
      "titleKey": "hello.gauge",
      "element": "acme-gauge-widget",
      "headerElement": "acme-gauge-header",
      "defaultSize": { "w": 4, "h": 3 },
      "minSize": { "w": 2, "h": 2 }
    }
  ]
}
```

| Field | Description |
|---|---|
| `type` | the widget kind (`temperature-graph`, `camera`, …) |
| `provider` | the concrete implementation; usually `manifest.id` |
| `titleKey` | i18n key of the title; **the title is drawn by the host** in the card header |
| `element` | the widget body CE |
| `headerElement` | a CE the host puts in the card header to the right of the title (buttons, toggles); `params` = `{}` |
| `defaultSize` | size in grid cells when added; 4×3 by default |
| `minSize` | minimum size on resize; 2×2 by default |

### type and provider

A widget is a **`type` + `provider`** pair. Several plugins can offer different
providers for one `type`; the user chooses the provider in the widget card (the
switch appears only if there is more than one provider). If no choice was made,
the first registered one is used. To *replace* a built-in widget, register the same
`type` with your own `provider`.

The types from which the host assembles the default dashboard:
`tools`, `temperature-graph`, `console`, `outputs`, `jobs-table`,
`gcode-preview`, `bed-mesh`, `camera`, `macros`.

### Grid

12 columns, row height `--grid-row-height` (80px); when the dashboard itself is
narrower than 768px (not the window: the sidebar and right panel count) the grid
becomes a single column, and a widget still occupies its `h` rows, so its height
is always definite. The layout is stored per printer
(`dashboardLayout`) and edited in `#/dashboard?edit=1` mode.

### Parameters

The widget body receives `params` = the dashboard route's query parameters (for
example `edit: '1'` in edit mode, `preview: <file>` on a preview deep link)
plus `narrow` (see [Narrow screens](#9-narrow-screens)).

### Widget design

A widget is a smaller page: the same panel visual language, higher content
density, secondary things hidden, actions in the header (via `headerElement`) or
moved into a menu / opening the full page.

---

## 3. Banners

```json
{ "banners": [ { "id": "acme-warn", "element": "acme-warn-banner" } ] }
```

A banner is a block in the flow at the top of main. Banners of all plugins stack
in registration order and **push** the content down (they do not cover it).

- **The plugin decides visibility.** The host always mounts the element; when
  there is nothing to report, the element must render *nothing* (empty content
  without height).
- `params = { mode, route, narrow }`:
  - `mode` — `'expanded'` or `'collapsed'`; the host collapses banners on scroll
    down (threshold 32px) and expands them when scrolling back to the top;
  - `route` — `'dashboard'` | `'plugin-page'` | `'settings'`;
  - `narrow` — `'true'` | `'false'`, see [Narrow screens](#9-narrow-screens).
- The `scope` field is declared in the type but is not applied by the host —
  filter by `params.route` yourself.
- **Manual control.** A banner can request the expanded or collapsed state with
  bubbling events (it is enough for the event to bubble up to main):

  ```js
  this.dispatchEvent(new CustomEvent('mpu:banner-expand',   { bubbles: true, composed: true }));
  this.dispatchEvent(new CustomEvent('mpu:banner-collapse', { bubbles: true, composed: true }));
  ```

  After `expand` the host keeps the expanded state until the user scrolls back to
  the top; after `collapse`, until the next `expand`.
- A banner **does not duplicate** the offline overlay: a banner is the state of
  Klipper/the plugin, the offline overlay is the connection to Moonraker.

---

## 4. Overlays

```json
{ "overlays": [ { "id": "acme-dialog", "element": "acme-dialog-overlay" } ] }
```

An overlay is a floating window (usually modal) above main and the right panel,
below the offline overlay. The typical case: a dialog the plugin opens based on
printer state (for example, confirming a manual probing step).

**How an overlay differs from an ordinary pop-up window.** A pop-up window (a
popover, or a dialog inside a page or widget) can only be shown by the plugin on
its own page, while its element is mounted. An overlay is a persistent surface: its
element is always mounted, so the plugin can show the window **on any page and
anywhere in the UI** — for example, the manual-probing dialog appears even if the
user is on the console page at that moment. If a window only needs to exist inside
your own page, you do not need an overlay.

A side effect: since an overlay is always mounted, it is also a good place to start
background plugin logic that must live independently of pages (for example,
tracking the state of all printers for guards — see [guards.md](guards.md)).
Declare hotkeys for an overlay's actions with `scope: 'global'`
(see [hotkeys.md](hotkeys.md)).

How it works:

- The host mounts a **permanent layer** `position: fixed; inset: 0` with
  `z-index: var(--z-plugin-overlays, 60)`. The layer itself and the element wrapper
  have `pointer-events: none`, while **all descendants of your element get
  `pointer-events: auto`**.
- The element is always mounted (params `{}`); showing/hiding the content is the
  **plugin's own** job. When the window is closed the element must render nothing
  (otherwise its descendants would intercept clicks on the UI under the layer).
- For a modal window, make your own `position: fixed` backdrop and dialog inside the
  element, with a `z-index` within your layer.
- An overlay is for pop-up windows, not for persistent content.

A typical skeleton:

```js
class AcmeDialog extends HTMLElement {
  #open = false;
  connectedCallback() {
    this.#off = this.api.moonraker().subscribe({ manual_probe: ['is_active'] }, (d) => {
      this.#open = d.manual_probe?.is_active === true;
      this.#render();
    });
  }
  #render() {
    this.innerHTML = this.#open
      ? `<div class="backdrop"><div class="dialog">…</div></div>`
      : '';                                 // closed → empty
  }
}
```

---

## 5. Quick-access chips

A chip is a miniature glanceable element of the strip under the banners: a state +
one action. The strip is a "mosaic" of chips arranged by the user.

```json
{
  "chips": [
    {
      "type": "gauge",
      "provider": "acme/hello",
      "titleKey": "hello.chip.gauge",
      "element": "acme-gauge-chip",
      "pickerElement": "acme-gauge-picker",
      "icon": "file"
    }
  ]
}
```

| Field | Description |
|---|---|
| `type` | chip type inside the plugin (`temperature`, `macro`, …) |
| `provider` | usually `manifest.id` |
| `titleKey` | section title in the add dialog |
| `element` | the chip's own CE |
| `pickerElement` | the CE catalog of available items for the add dialog |

### Model

The host stores **placement descriptors only** (`mpu:v2:settings:<printerId>`, key
`quickChips`): `{ instanceId, type, provider, id, label? }`. `id` is the key of
an "item" inside your plugin (sensor name, macro, device); the host does not
interpret it. What items exist and how they look is up to the plugin.

### Chip (`element`)

- `params = { chipId, chipLabel?, edit: '1' | '0', narrow: 'true' | 'false' }`. `chipId` is
  that same item `id`; `chipLabel` is the user's label.
- The chip root stretches to the full slot height (**80px**), width follows
  content; limit it on the plugin side (`max-width` + `text-overflow: ellipsis`).
- Reveal the action with a **popover**, not by expanding the chip in place
  (otherwise the strip reflows). Open it **downward** by default (the strip sits under the
  banners and the header): `shouldOpenAbove()` and `shouldAlignToEnd()` from
  `plugins/shared/popover-align.ts` decide the side and the alignment (LTR/RTL).
- When `edit === '1'` (dashboard edit mode) the host draws its own affordances
  (frame, "+", close buttons, drag-and-drop). The chip must not perform actions in
  this mode.
- No item (a sensor disappeared) → draw the *missing* state: a dashed border and
  muted text.
- A chip's actions are an ordinary `api.moonraker().request()`, so guards see them.

### Picker (`pickerElement`)

- `params = { edit: '1', placed: '<JSON array of ids>' }` — `placed` contains the
  `id`s of already-placed items of **this type and provider**; the picker may hide
  or dim them.
- The picker lists the available items and reports a choice with a bubbling event:

  ```js
  el.dispatchEvent(new CustomEvent('mpu:chip-pick', {
    bubbles: true, composed: true,
    detail: { id: 'extruder', label: 'Hotend' },   // label is optional
  }));
  ```

  The host takes `type` and `provider` from the section wrapper, not from the
  event. The event is consumed by the add dialog; this is not a plugin bus.

### Other

- A plugin with a disabled/removed provider leaves a "ghost" *provider missing*
  tile in the strip; in view mode a strip consisting only of ghosts is hidden.
- Chips are shown only for plugins that apply to the active printer (the plugin
  record's `printerIds`).
- The default chip set is a host decision: `temperature` for `extruder` and
  `heater_bed` from `@core/widgets`, `livez` from `@core/calibrations`; third-party
  plugins are not part of it.

---

## 6. Fleet panels

Fleet mode is a full-screen host drawer with a grid of cards for all printers.

```json
{ "printerPanels": [ { "id": "acme-state", "element": "acme-state-panel",
                       "titleKey": "hello.fleet.state" } ] }
```

- The element is created **one instance per configured printer**.
  `params = { printerId }`. The `params` object is stable between re-renders —
  otherwise the CE would be re-created.
- Read your printer's data through `api.moonrakerFor(params.printerId)` and
  settings through `api.settingsFor(params.printerId)`.
- `api.moonraker()` and `api.settings` are **not suitable** here: they are about
  the *active* printer, and fleet does not change the active printer.
- Panels stack inside the card in registration order. The user can reorder and
  hide panels ("Edit panels" in the fleet header); `titleKey` is used as the name
  in that editor.
- Making panels **read-only** is recommended: actions on non-active printers are
  not recommended yet (guards of plugins unaware of the target printer would
  decide based on the active one — see
  [guards.md](guards.md#target-scoped-guards)).
- To take part in the fleet **search and filters**, publish an index from the panel
  with `api.fleet.publish(params.printerId, { tags, searchText })` (in an
  `$effect`/`connectedCallback`) and call `api.fleet.retract(params.printerId)` when
  the panel is removed. See [plugin-api.md](plugin-api.md#fleet).
- Closing fleet = unmounting: subscriptions and streams are released. Cache what is
  expensive to re-create (at module level).
- The panel height follows its content; the host draws the card header (printer
  name, connection status, "Activate").

---

## 7. Hotkeys

Details are in [hotkeys.md](hotkeys.md). In short:

```json
{ "hotkeys": [ { "id": "acme-refresh", "scope": "plugin",
                 "keys": "Alt+R", "handler": "refreshHandler",
                 "titleKey": "hello.hotkey.refresh" } ] }
```

Scopes: `global` (everywhere), `dashboard` (dashboard only), `plugin` (only on the
owning plugin's page). The handler is a module export
`(api, event) => void | Promise<void>`.

---

## 8. Right panel (for reference)

A unique slot. The host accepts `rightPanel` **only** from `@core/system`; from any
other plugin the contribution is rejected with a console warning. Remote plugins
cannot use the right panel.

---

## 9. Narrow screens

The host switches to "narrow" mode at a width ≤ **768px** (a single breakpoint,
`NARROW_BREAKPOINT` in `ui-store`). The side panels follow the *window* width
(`ui.isNarrow`); banners, chips and widgets follow the width of the *work area*
(main/dashboard), so a wide window with both sidebars open can still be "narrow" for
them. Every plugin surface the host mounts itself (banners, chips, widget body, right
panel) receives
`params.narrow` = `'true'` | `'false'` — a string, like the other `params`.
The value is fixed when the element is mounted; on a window resize the host only
updates the element's `data-narrow` attribute (component props are not reactive).
To react live, use `matchMedia('(max-width: 768px)')` or container queries on
your own container: `narrow` is a convenience flag, not a replacement. Narrow
mode means a *small window*, not a touch device: mouse, keyboard and hotkeys
keep working exactly as on desktop.

What the host does by itself in narrow mode:

- **Adapting inside a plugin.** Prefer container queries over `@media`: a page or
  widget may be narrow on a wide screen. Make the surface root a container
  (`:global(mpu-x) { display:block; container-type:inline-size }`) and query it:
  `@container (max-width: 720px)` — stack columns, `480px` — compact. A dialog that
  is `position: fixed` is not inside any container: make its panel one. Tables that
  must not scroll sideways: `plugins/shared/responsive/card-table.css` turns a
  `table.card-table` (with `data-label` on each `td`) into cards below 520px.
  Touch targets: use `@media (pointer: coarse)`, not the window width.
- **Side panels** (menu and right panel) open over the content at full width under
  the header; at most one is open. The right panel always receives
  `collapsed: 'false'`; the saved "collapsed" state and width are ignored.
- **Mounting.** A side panel is mounted only while it is open. Anything that must
  work with the panel closed (notifications, toasts, hotkey handlers) must live in
  an always-mounted surface (an overlay) and must not depend on the panel's DOM.
  The `R` and `L` hotkeys toggle the right panel and the left menu: on a wide
  screen they collapse/expand them, on a narrow one they open/close the overlay.
- **Banners.** If several banners are visible at once, the host groups them under
  a "Notifications: N" row. A banner counts as visible when its height is non-zero,
  so keep rendering *nothing* when there is nothing to report. Tapping the row
  sends the same `mpu:banner-expand` / `mpu:banner-collapse` events.
- **Chips** are folded into a "Quick access" accordion (collapsed by default, open
  in edit mode); on touch the order is changed with buttons, not drag-and-drop.
  The chip height is unchanged (80px).
