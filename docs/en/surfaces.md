# Surfaces (plugin contributions) reference

A "surface" is a place in the host's UI where a plugin can mount its Custom
Element. The host owns the place itself (layout, z-order, showing/hiding the
container); the plugin owns the content.

| Surface | Manifest | Where it lives | Who decides whether to show it | Remote |
|---|---|---|---|---|
| [Page](#1-pages) | `pages[]` | the main area, a sidebar entry | the user (Settings → Pages) | yes |
| [Widget](#2-widgets) | `widgets[]` | the dashboard grid | the user (dashboard layout) | yes |
| [Banner](#3-banners) | `banners[]` | top of main, in flow | the **plugin** | yes |
| [Collapsed banner](#collapsed-view) | `collapsedBanners[]` | the row of a collapsed banner | the **plugin** | yes |
| [Overlay](#4-overlays) | `overlays[]` | above main and the right panel | the **plugin** | yes |
| [Chip](#5-quick-access-chips) | `chips[]` | the strip under the banners | the user (edit mode) | yes |
| [Fleet panel](#6-fleet-panels) | `printerPanels[]` | a printer card in fleet mode | the user (panel editor) | yes |
| [Hotkey](#7-hotkeys) | `hotkeys[]` | global | the user (Settings → Hotkeys) | yes |
| Right panel | `rightPanel` | the column on the right | — | **no** (`@core/system` only) |
| [Extension](#10-extension-points) | `extensions[]` | a point of another plugin | the owner places it; mode and the user decide | yes |

Layers, top to bottom:

```
auth overlay          — 900, login prompt (host only)
toasts                — 550, notification center (host only)
notification center   — 450, the list beside the right panel (host only)
host dialogs          — 300, confirmations and settings dialogs
printer tabs menu     — 250
fleet mode            — 200, full-screen drawer
offline-overlay       — 100, connection status (host only)
plugin overlays       — 60, modal windows
side panels, narrow   — 40, menu and right panel over the content
right panel           — 30, the column on the right
edit toolbar, narrow  — 10, pinned while the page scrolls
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
   when it disappears. Release subscriptions in `disconnectedCallback`. **When the
   `params` object changes the host replaces the element with a new one**, so state
   held inside it is lost: a banner on a change of `mode`, `route` or `narrow`, a chip
   on `edit` or `narrow`, a widget body on the route query or `narrow`. Keep what must
   survive in settings or at module level.
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

**Layout.** A page occupies main below the banners and chips and scrolls there; on a
narrow screen main scrolls as a whole, banners and chips included. The
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
| `headerElement` | a CE the host puts in the card header to the right of the title (buttons, toggles), or on a second line when it does not fit; `params` = `{}` |
| `defaultSize` | size in grid cells when added; 4×3 by default |
| `minSize` | minimum size on resize; 2×2 by default |

### type and provider

A widget is a **`type` + `provider`** pair. Several plugins can offer different
providers for one `type`; the user chooses the provider in the widget card (the
switch appears only if there is more than one provider). If no choice was made,
the first registered one is used. To *replace* a built-in widget, register the same
`type` with your own `provider`.

The choice applies only to the default dashboard. A customized layout stores the
`provider` of each placed widget, so there the switch changes nothing: remove the
widget and add it again with the other provider.

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
example `preview: <file>` on a preview deep link) plus `narrow` (see
[Narrow screens](#9-narrow-screens)). In edit mode the host shows placeholder cards
instead, so the body and `headerElement` are not mounted.

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
  - `mode` — `'expanded'` or `'collapsed'`: `'collapsed'` while the host shows the
    [collapsed view](#collapsed-view) instead of this banner. On a wide screen also
    while scrolled down (threshold 32px, back to `'expanded'` at the top), although
    the banner stays on screen then;
  - `route` — `'dashboard'` | `'plugin-page'` | `'settings'`;
  - `narrow` — `'true'` | `'false'`, see [Narrow screens](#9-narrow-screens).
- The `scope` field is declared in the type but is not applied by the host —
  filter by `params.route` yourself.
- **Manual control.** A banner can request the expanded or collapsed state with
  bubbling events:

  ```js
  this.dispatchEvent(new CustomEvent('mpu:banner-expand',   { bubbles: true, composed: true }));
  this.dispatchEvent(new CustomEvent('mpu:banner-collapse', { bubbles: true, composed: true }));
  ```

  `expand` shows this banner in full even when the host would collapse it, like a tap
  on its collapsed row; `collapse` returns it to what the host decides. This does not
  affect other banners. On a wide screen they also hold `mode`, which is shared by all
  banners: after `expand` until the user scrolls back to the top, after `collapse`
  until the next `expand`.
- A banner **does not duplicate** the offline overlay: a banner is the state of
  Klipper/the plugin, the offline overlay is the connection to Moonraker.

### When the host collapses banners

The host tries to keep banners visible and removes them step by step, measuring against
the height of main. Each step applies only if the previous one was not enough:

| Step | Condition | Result |
|---|---|---|
| 1 | a banner is taller than 35% | that banner is collapsed |
| 2 | the banners together take more than 40% | **all** of them are collapsed, so the styles do not diverge |
| 3 | the collapsed rows take more than 25% (two or more banners) | all of them go under a closed "Banners (N)" accordion |

On a narrow screen banners are always collapsed by default, and two or more are always
under the accordion (see [Narrow screens](#9-narrow-screens)).

A tap on a collapsed row expands only that banner; a thin button attached to its bottom
edge collapses it back. For that the host removes the bottom margin and bottom corner
radius of the element's root, so keep your banner's frame on the root. The state changes are animated, so a banner must not rely on its height being
final the moment it is shown.

### Collapsed view

```json
{
  "banners": [ { "id": "acme-warn", "element": "acme-warn-banner" } ],
  "collapsedBanners": [
    { "id": "acme-warn-collapsed", "banner": "acme-warn", "element": "acme-warn-banner-collapsed" }
  ]
}
```

While a banner is collapsed, the host shows a row with its collapsed view instead.
`banner` is the `id` of a banner of the same plugin; a contribution pointing to an unknown
banner is dropped with a warning.

- `params = { route, narrow }`. Like the banner, the element is always mounted.
- It is shown only while its banner has a non-zero height; render *nothing* when
  there is nothing to report.
- It is **display-only**: one line, no chrome of its own (the row provides it). A click
  bubbles up to the host and expands the banner; call `stopPropagation()` if you
  really need a control of your own.
- A banner without a collapsed view gets a row with the plugin's name.

---

## 4. Overlays

```json
{ "overlays": [ { "id": "acme-dialog", "element": "acme-dialog-overlay" } ] }
```

An overlay is a floating window (usually modal) above main and the right panel,
below fleet mode, the offline overlay and host dialogs. The typical case: a dialog the plugin opens based on
printer state (for example, confirming a manual probing step).

**How an overlay differs from an ordinary pop-up window.** A pop-up window (a
popover, or a dialog inside a page or widget) can only be shown by the plugin on
its own page, while its element is mounted. An overlay is a persistent surface: its
element is always mounted, so the plugin can show the window **on any page**
(unless a higher layer covers it) — for example, the manual-probing dialog appears even if the
user is on the console page at that moment. If a window only needs to exist inside
your own page, you do not need an overlay.

A side effect: since an overlay is always mounted, it is also a good place to start
background plugin logic that must live independently of pages (for example,
tracking the state of all printers for guards — see [guards.md](guards.md)).
Declare hotkeys for an overlay's actions with `scope: 'global'`
(see [hotkeys.md](hotkeys.md)).

How it works:

- The host mounts a **permanent layer** `position: fixed; inset: 0` with
  `z-index: var(--z-plugin-overlays, 60)`. The layer and its item wrapper have
  `pointer-events: none`, while **everything inside the wrapper, your element and its
  descendants, gets `pointer-events: auto`**.
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
      "pickerElement": "acme-gauge-picker"
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
- When the chips take more than 25% of the height of main on a wide screen, the host
  folds them into a closed "Quick access" accordion (never in edit mode). Unlike on a
  narrow screen, scrolling does not close it.
- Reveal the action with a **popover**, not by expanding the chip in place
  (otherwise the strip reflows). Open it **downward** by default (the strip sits under the
  banners and the header): `shouldOpenAbove()` and `shouldAlignToEnd()` from
  `plugins/shared/popover-align.ts` decide the side and the alignment (LTR/RTL).
  On a narrow screen the strip scrolls and clips its content, so the popover must be
  `position: fixed`: `placeChipPopover()` from the same file takes the chip's rectangle
  and the estimated popover size, and returns a CSS style string for it.
- When `edit === '1'` (dashboard edit mode) the host draws its own affordances
  (frame, "+", close buttons, order buttons, drag-and-drop). The chip must not perform
  actions in this mode.
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

The breakpoint is **768px** (`NARROW_BREAKPOINT` in `ui-store`), measured in two places:

- The side panels follow the *window*: narrow at a width ≤ 768px (`ui.isNarrow`).
- Banners, chips and widgets follow the *work area*: narrow when its content box is
  under 768px (`core/narrow-width.ts`). The padding of main and the open sidebars
  count, so a wide window can still be "narrow" for them.

Narrow mode means a *small area*, not a touch device: mouse, keyboard and hotkeys keep
working exactly as on desktop.

### `params.narrow`

Banners, collapsed views, chips, widget bodies and the right panel receive
`params.narrow` = `'true'` | `'false'` — a string, like the other `params`. Pages,
overlays, fleet panels, `headerElement` and pickers do not. When the value changes the
host replaces the element (see the [general rules](#general-rules-for-all-surfaces)),
so a new element always starts with the current value and `narrow` needs no live
tracking. It is a convenience flag: what fits inside your own surface depends on its
size, so use container queries for that (see below).

### What the host does by itself

- **Side panels** (menu and right panel) open over the content at full width under
  the header; at most one is open. The right panel always receives
  `collapsed: 'false'`; the saved "collapsed" state and width are ignored.
- **Mounting.** A side panel is mounted only while it is open. Anything that must
  work with the panel closed (background sources, hotkey handlers) must live in
  an always-mounted surface (an overlay) and must not depend on the panel's DOM.
  The notification center and its toasts are not such code: they belong to the host
  and are always mounted (see [`api.notifications`](plugin-api.md#notifications)).
  The `R` and `L` hotkeys toggle the right panel and the left menu: on a wide
  screen they collapse/expand them, on a narrow one they open/close the overlay.
- **Banners** are [collapsed](#collapsed-view) by default, even a single one; two or more
  are always under a closed "Banners (N)" accordion. A banner counts as visible when its
  height is non-zero, so keep rendering *nothing* when there is nothing to report.
- **Chips** are folded into a "Quick access" accordion (collapsed by default, open
  in edit mode). Open, they form a horizontally scrolling two-row strip. The chip height
  is unchanged (80px).
- **Collapsing on scroll.** Scrolling down (threshold 32px) collapses both banners and
  chips; only a tap on them expands them again, scrolling back to the top does not.
  Scrolling of page-level inner containers counts too, but not of small lists inside
  widgets or scrolling without user input (such as a console log following new lines).

### Adapting inside a plugin

Prefer container queries over `@media`: a page or widget may be narrow on a wide screen.
Make the surface root a container
(`:global(mpu-x) { display:block; container-type:inline-size }`) and query it:
`@container (max-width: 720px)` — stack columns, `480px` — compact. A dialog that is
`position: fixed` is not inside any container: make its panel one. Tables that must not
scroll sideways: `plugins/shared/responsive/card-table.css` turns a `table.card-table`
(with `data-label` on each `td`) into cards below 520px. Touch targets: use
`@media (pointer: coarse)`, not the window width. Core plugins have ready helpers, see
[plugin-development.md](plugin-development.md#shared-helpers).

### Editing the dashboard

Edit mode is opened from Settings → Edit layout (`#/dashboard?edit=1`). The toolbar sits
above the chip strip: on a wide screen it is outside the scrolling area, on a narrow one
it stays pinned. Changes are written at once, so **Save** only leaves the mode, and
**Discard changes** returns the widget layout and the quick chips to their state on
entry. Undo and redo cover both (see [hotkeys.md](hotkeys.md)).

- On a wide dashboard a card is dragged and resized from its edges. On touch, dragging
  starts with a long press (400 ms), so a swipe still scrolls the page.
- On a narrow dashboard cards are not dragged. Next to each card there is a ruler and
  up/down buttons, on the right of the card and on the left in RTL. The ruler's thumb
  changes the height row by row, from the widget's `minSize.h` to 16 rows.
- There is one layout for both modes, so the first up/down press stacks it into one
  column and overwrites the wide arrangement. Undo or discard brings it back.
- In edit mode every chip has order buttons on any device, and drag-and-drop works too.

### The Settings page

In the mobile mode (window ≤ 768px) or when the page itself is narrower than 560px, the
page shows the list of tabs, and a chosen tab replaces it and gets a back button
(`#/settings` is the list, `#/settings/<id>` is the tab). Otherwise the list sits beside
the tab, and `#/settings` opens General.

---

## 10. Extension points

A plugin can be **extended by other plugins**. The owner declares *extension points* —
what may be added to it, of which kind and in which mode — and places them wherever it
wants in its own pages, widgets or banners. An extension plugin declares *contributions*
to points of other plugins (or its own). The host keeps the registry, checks versions,
resolves conflicts and mounts each contribution **with the extension's own api**. Plugins
still never talk to each other directly.

```json
{
  "extensionPoints": [
    { "id": "tabs",   "kind": "tab", "mode": "append",      "version": 1, "titleKey": "acme.ext.tabs" },
    { "id": "shaper", "kind": "tab", "mode": "alternative", "version": 1, "titleKey": "acme.ext.shaper" }
  ]
}
```

```json
{
  "extensions": [
    { "point": "@core/calibrations#shaper", "kind": "tab", "version": 1,
      "id": "shaketune", "titleKey": "st.title", "element": "st-shaper",
      "available": "hasShakeTune" }
  ]
}
```

| Point field | Description |
|---|---|
| `id` | unique within the plugin, no `#` or `/`; the address is `<ownerPluginId>#<id>` |
| `kind` | `tab` \| `panel` \| `element` \| `action` — the contract of a contribution |
| `mode` | `append` (default) \| `alternative` \| `replacement`; `action` is append only |
| `version` | positive integer, the major version of the params/context contract |
| `max` | append only: how many contributions the point shows (unlimited by default) |
| `default` | alternative only: `extension` (default — the first available contribution) or `original` |
| `titleKey` | the point's name in host dialogs and Settings → Plugins |

| Contribution field | Description |
|---|---|
| `point` | `<ownerPluginId>#<pointId>` |
| `kind`, `version` | must equal those of the point; otherwise the contribution is rejected |
| `id`, `titleKey` | unique within the plugin (no `/`); the title is shown on tabs, panels and menus |
| `element` | CE tag for `tab`, `panel`, `element` |
| `headerElement` | `panel` only: CE in the panel header |
| `handler` | `action` only: module export `(api, context) => void \| Promise<void>` |
| `icon` | `action`: icon name for the menu item |
| `available` | module export `(api, params) => boolean \| Promise<boolean>`; none — always available |
| `order` | ordering among the point's contributions (lower first, default 0) |

### Kinds

| kind | The owner draws | The extension gives |
|---|---|---|
| `tab` | the tab button and the place for its body | `element` — the whole tab content |
| `panel` | the place; the host draws a panel shell (title + `headerElement` + body) | `element`, optional `headerElement` |
| `element` | a place in the flow, no chrome | `element`; renders *nothing* when there is nothing to show |
| `action` | a button or menu item from `api.extensions.list()` | `handler(api, context)`; context schema is documented with the point |

### Modes

| mode | Contributions | Owner's original | Choice |
|---|---|---|---|
| `append` | up to `max` | stays | — |
| `alternative` | any number | one of the variants | the user: right-click → host popover |
| `replacement` | exactly one | not rendered | none |

- **alternative**: right-click, a long press on touch (500 ms) or the ContextMenu key on
  the point opens the host's popover with "Original" and every available contribution. The
  choice is stored per printer (like the widget provider choice) and duplicated in
  Settings → Plugins. The host only reacts when the inner content did not call
  `preventDefault()` on `contextmenu`.
- **replacement**: put such points on large elements of your surfaces (widget body
  sections, page panels, a banner body). If the contribution is unavailable, the original is
  shown. Do not make emergency or print controls (E-stop, start/pause/cancel) replaceable.

### Availability, versions, sleeping

- `available` is called with the extension's api when the point is rendered, and again on
  `notify_klippy_ready`, `notify_config_changed` and reconnect. The host never reads the data.
- A version or kind mismatch rejects the contribution (console warning + Settings → Plugins).
- A contribution to a point whose owner is not loaded or disabled is *sleeping*, not an
  error: it binds as soon as the owner appears.
- The set of points is part of the **owner's version**, not of the
  [plugin API](plugin-development.md#plugin-api-version): a new point or point version
  raises the owner's `version` (built-in plugins included). An extension states the owner
  version it needs in [`dependencies`](plugin-development.md#dependencies)
  (`{ "@core/calibrations": "3.0.0" }`, a minimum). If the loaded owner is older, all
  contributions of that extension to the owner are rejected, and Settings → Plugins says
  what to update (Tessera for `@core/*`, otherwise the owner); `tessera-ext` refuses to
  install it on such a Tessera, or updates the owner from the registry.
- If the owner is loaded, satisfies `dependencies` (or there is no entry) but has no such
  point, the contribution is rejected the same way: the owner is older than it needs.

### Conflicts

A conflict is more applicable contributions than the point's capacity (`replacement`: 1,
`append`: `max`). It is detected statically (loaded + enabled + applies to the printer,
`available` is ignored). The host shows a dialog to pick the winners or keep the original;
**until it is resolved, all conflicting contributions of that point are disabled**.
"Later" postpones the dialog for the session; Settings → Plugins keeps a "Resolve" button.
A resolution is stored device-wide and is asked again when the set of candidates changes.

### Owner API

```ts
api.extensions.list(pointId, params?)        // active contributions (ExtensionRef[])
api.extensions.resolve(pointId, params?)     // { mode, original, active, options, conflict }
api.extensions.onChange(cb)                  // → unsubscribe
api.extensions.mount(container, ref, params?)// → { update(params), destroy() }
api.extensions.invoke(ref, context?)         // action
api.extensions.choice(pointId) / setChoice(pointId, ref | null)
api.extensions.openChooser(pointId, anchorEl | { x, y }, params?)
```

Render the original only when `resolve(pointId).original` is true. Svelte owners use the
SDK wrapper, which does all of the above:

```svelte
<script>
  import { ExtensionPoint } from '@sdk/svelte';
</script>

<ExtensionPoint point="shaper">
  {#snippet original()}<ShaperContent />{/snippet}
</ExtensionPoint>
<ExtensionPoint point="tabs" only={activeTabRef} />
```

### Other rules

- Hotkeys of an extension with `scope: 'plugin'` also work where its contribution is
  mounted; the page owner's hotkeys win on the same combination.
- Guards are not inherited: an extension declares guards for its own commands.
- Deep links to an extension tab: `?section=<extPluginId>/<id>`, resolved by the owner.
- Dependencies: the owners of the points an extension uses are its dependencies, with
  the minimal versions from `dependencies`. `tessera-ext install` installs or updates
  them from the registry (`requires` and `dependencies` in `registry.json`); `remove`
  refuses to remove a plugin others depend on without `--force`. `@core/*` come with
  Tessera: their versions are in `host/dist/core-plugins.json` of the build.
- Popups, menus and lightboxes of a contribution must live in the browser's **top layer**
  (`<dialog>.showModal()` or the Popover API: `popover="auto"` + `popovertarget`). A
  contribution is mounted inside the owner's page: its panels often have
  `overflow: hidden` and the page can be a size container (`container-type`), which
  clips an in-flow menu and turns `position: fixed` into "fixed to the container". The
  Shake&Tune plugin (Lit, `tessera-ext`) is the reference: its help is a `[popover]`
  positioned from JS, its graph lightbox a `<dialog>`.

### Points of the built-in plugins

`@core/calibrations` (all `version: 1`, no params; a contribution gets only its own api).
"Since" is the owner version to put in `dependencies`:

| Point | kind | mode | Since | Where |
|---|---|---|---|---|
| `tabs` | tab | append | 2.1.0 | page: extra tabs |
| `shaper` | tab | alternative | 2.1.0 | page: the whole Input Shaper tab |
| `panel-mesh-map`, `panel-mesh-profiles`, `panel-mesh-tools` | panel | replacement | 3.0.0 | Mesh tab: the bed map, profiles and tools panels |
| `panel-probe`, `panel-heaters` | panel | replacement | 3.0.0 | the Probe and Heaters tabs |
| `panel-shaper`, `panel-belts`, `panel-graphs` | panel | alternative | 3.0.0 | Input Shaper tab panels (they complement each other and Klipper's own calibration, so the user chooses, the original is not hidden for good) |
| `panels-mesh`, `panels-probe`, `panels-heaters`, `panels-shaper` | panel | append | 3.0.0 | extra panels at the end of the respective tab |
| `widget-livez`, `widget-probe`, `widget-pid` | element | replacement | 3.0.0 | bodies of the Calibrations widget tabs |
| `widget-tabs` | tab | append | 3.0.0 | extra tabs of the Calibrations widget |
| `widget-bed-mesh` | element | replacement | 3.0.0 | the whole content of the bed-mesh widget (its header stays) |
| `overlay-test-z`, `overlay-screws-tilt` | element | replacement | 3.0.0 | the whole overlay (backdrop and dialog); the plugin still decides **when** it is shown |

A replacement of `overlay-test-z` takes over the manual probe Accept/Abort controls: it
must provide them itself.
