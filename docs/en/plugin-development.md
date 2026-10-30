# Developing remote plugins for Tessera

This is the main guide. It is written from the host's source code; wherever the
behaviour is not obvious or differs from what you would intuitively expect, it
says so explicitly (see [Pitfalls](#9-pitfalls)). The other documents go into
detail:

| Document | Topic |
|---|---|
| [architecture.md](architecture.md) | how the host works: roles, lifecycle, data flow |
| [surfaces.md](surfaces.md) | reference for every surface: pages, widgets, banners, overlays, chips, fleet panels, hotkeys |
| [plugin-api.md](plugin-api.md) | complete `PluginApi` reference |
| [moonraker-proxy.md](moonraker-proxy.md) | working with Moonraker: subscriptions, cache, polling, errors, auth |
| [guards.md](guards.md) | GuardAgent: preflight checks of requests |
| [hotkeys.md](hotkeys.md) | plugin and host hotkeys |
| [settings.md](settings.md) | settings, localStorage, synchronization |
| [i18n-and-theming.md](i18n-and-theming.md) | localization and the design system (CSS variables) |
| [deployment.md](deployment.md) | installing plugins on the server, catalog, caching |

---

## 1. What a plugin is

A plugin is a self-contained contribution to the UI. It consists of two parts:

1. **`manifest.json`** — a static description: identifier, version, entry point
   and a list of *contributions* (pages, widgets, banners, …).
2. **An ES module (`entry`)** — JavaScript that the host loads via `import()`.
   The module registers **Custom Elements** (CE) — one per contribution — and,
   if needed, exports `locales`, guard handlers and hotkey handlers.

The host knows nothing about the framework a plugin is written in. The contract
between them is a **Custom Element plus two properties** (`api` and `params`). A
plugin written in Svelte, React, Vue, Lit or plain JavaScript looks the same to
the host.

What a plugin **can** do:

- read printer state and call Moonraker methods (`api.moonraker()`);
- store its own settings (`api.settings`);
- show pages, dashboard widgets, banners, overlays, quick-access chips, fleet-mode panels;
- intercept other plugins' requests with guards (`allow`/`deny`/`freeze`);
- register hotkeys;
- translate its UI into the host's languages.

What a plugin **cannot** do (by design):

- exchange messages with other plugins — there is no bus and no shared state;
- take over the right panel (that slot belongs to `@core/system` only);
- modify requests that pass through guards (guards only allow, deny or freeze);
- read other plugins' settings.

If two plugins need shared data, each reads it from the primary source — from
Moonraker/Klipper (for example from `save_variables`) — rather than from each other.

---

## 2. Quick start: a minimal plugin without dependencies

To see how everything works, let's start with a page plugin in plain JavaScript.

Directory layout on the host's server (details in [deployment.md](deployment.md)):

```
extensions/
└── hello/
    ├── manifest.json
    └── index.js
```

**`extensions/hello/manifest.json`**

```json
{
  "id": "acme/hello",
  "name": "Hello",
  "version": "1.0.0",
  "entry": "index.js",
  "locales": ["en", "ru"],
  "pages": [
    {
      "id": "acme-hello",
      "titleKey": "hello.title",
      "icon": "file",
      "element": "acme-hello-page"
    }
  ]
}
```

**`extensions/hello/index.js`**

```js
export const locales = {
  en: { hello: { title: 'Hello', greeting: 'Active printer: {name}' } },
  ru: { hello: { title: 'Привет', greeting: 'Активный принтер: {name}' } },
};

class HelloPage extends HTMLElement {
  #api = null;
  #params = {};
  #off = [];

  // The host sets these properties BEFORE the element is attached to the DOM.
  set api(value) { this.#api = value; }
  get api() { return this.#api; }
  set params(value) { this.#params = value ?? {}; this.#render?.(); }
  get params() { return this.#params; }

  connectedCallback() {
    this.#render();
    // Live printer and language changes.
    this.#off.push(this.#api.onPrinterChange(() => this.#render()));
    this.#off.push(this.#api.onLocaleChange(() => this.#render()));
  }

  disconnectedCallback() {
    for (const off of this.#off) off();
    this.#off = [];
  }

  #render = () => {
    const { t } = this.#api.i18n;

    const title = document.createElement('strong');
    title.textContent = t('hello.title');

    const text = document.createElement('p');
    text.textContent = t('hello.greeting', { name: this.#api.printer.name });

    const panel = document.createElement('section');
    panel.style.cssText =
      'padding: var(--space-md); background: var(--bg-surface);' +
      'border: 1px solid var(--border-color); border-radius: var(--radius-md);';
    panel.append(title, text);

    // textContent/append, not innerHTML: the printer name is user-controlled.
    this.replaceChildren(panel);
  };
}

// The check is REQUIRED: define() on an already-taken tag throws.
if (!customElements.get('acme-hello-page')) {
  customElements.define('acme-hello-page', HelloPage);
}
```

Next:

```bash
node tools/extensions-sync.cjs        # regenerate extensions/index.json
```

Open **Settings → Plugins → Refresh**, press **Install** next to "Hello" — a
"Hello" page appears in the sidebar. Installing and updating are described in
[deployment.md](deployment.md).

What matters here:

- `entry` is resolved **relative to the manifest URL**, not the host or the printer.
- A CE tag lives in the browser's global namespace: use a plugin prefix
  (`acme-hello-page`), not `hello-page`.
- Strings are translated through `api.i18n.t`; the keys live in your module's `locales`.
- Data from Moonraker and user input (printer name, file names, console output)
  must be inserted as text (`textContent`), not through `innerHTML`.
- Colors and spacing are theme CSS variables (see [i18n-and-theming.md](i18n-and-theming.md)).

---

## 3. A Svelte 5 plugin (the recommended path)

The host's core plugins are written in Svelte 5 (runes). For a remote Svelte
plugin, use the same SDK (`plugin-sdk/`): it wraps a Svelte component into a
Custom Element and provides `api` through Svelte context.

```ts
// src/index.ts
import { defineMpuElement } from '@sdk/element/define-element';
import HelloPage from './HelloPage.svelte';

export const locales = { /* ... */ };

defineMpuElement('acme-hello-page', HelloPage);
```

```svelte
<!-- src/HelloPage.svelte -->
<script lang="ts">
  import { usePluginApi, useI18n } from '@sdk/svelte';

  let { params }: { params: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = useI18n();
</script>

<section class="panel">{i18n.t('hello.title')}: {api.printer.name}</section>
```

`defineMpuElement(tag, Component)`:

- creates a CE with `api` / `params` setters;
- mounts the component in `connectedCallback` (Svelte's `mount`) and unmounts it
  in `disconnectedCallback`;
- passes `params` to the component as a prop and puts `api` into context (`usePluginApi()`);
- is safe to call repeatedly: if the tag is already registered, it does nothing.

SDK hooks (`@sdk/svelte`):

| Hook | Returns |
|---|---|
| `usePluginApi()` | the full `PluginApi` (throws outside a plugin context) |
| `useMoonraker()` | `api.moonraker()` — the handle of the **active** printer at the time of the call |
| `useI18n()` | `api.i18n` |
| `useWidget()` | same as `usePluginApi()` (for widgets) |

> `useMoonraker()` returns the handle of the active printer at the moment of the
> call and does not switch by itself. To react to a printer change, subscribe to
> `api.onPrinterChange` and re-create your subscriptions (or use
> `api.moonrakerFor(printerId)` with an explicit printer).

### Build

A remote plugin is built into **one self-contained ES module** (Vite, lib mode).
Rules that are easy to break:

```ts
// the plugin's vite.config.ts
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { '@sdk': '/path/to/tessera/plugin-sdk/src' } },
  // 1. ES libraries do not replace process.env.NODE_ENV themselves → in the
  //    browser you get a ReferenceError unless you define it explicitly.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      // 3. The file name must match "entry" in manifest.json.
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    // 2. Do NOT make dependencies external: bare imports
    //    (import 'svelte') are not resolved by the browser.
    rollupOptions: { external: [] },
  },
});
```

1. Define `process.env.NODE_ENV`.
2. Make nothing `external` — everything is bundled in.
3. Output file name = `manifest.entry`.

Copy the result (`dist/index.js` + `manifest.json`) into `extensions/<name>/`.

A plugin on another framework is built the same way; the requirements are the
same: one ES module, CEs registered on import, dependencies inside the bundle.

---

## 4. The Custom Element contract

The host creates the element and, **before** adding it to the DOM, sets two properties:

```ts
const el = document.createElement(tag);
el.api = pluginApi;      // the owning plugin's PluginApi
el.params = params;      // Record<string, string>
hostContainer.appendChild(el);
```

The parameters are additionally mirrored into the element's `dataset`
(`params.chipId` → `data-chip-id`).

### What the host guarantees

- `api` and `params` are set by the time `connectedCallback` runs.
- `api` is stable until the plugin's manifest changes. If the host replaces `api`
  or the tag, the element is **re-created** rather than receiving a new `api` on the fly.
- `params` may be updated on a live element (for example, the page's query
  string changes): the host simply assigns `el.params = newObject` and updates
  `dataset`. No event is dispatched for this.
- All `params` are strings (`Record<string, string>`). Structured data is passed
  as a JSON string (for example `placed` in the chip picker).

### What the plugin does

- Reacts to `params` changes by implementing a `params` setter (as in the example
  above). The `defineMpuElement` wrapper does **not** propagate such changes to
  the Svelte component reactively — see [Pitfalls](#9-pitfalls).
- Releases subscriptions in `disconnectedCallback`. The host may unmount the
  element at any moment (route change, closing fleet, switching tabs).
- Does not assume the element lives forever: state that must survive unmounting
  is kept at module level (module state) or in `api.settings`.

### Which `params` each surface receives

| Surface | Element | `params` |
|---|---|---|
| Page (`pages[].element`) | page | the route's query parameters (`#/p/<printer>/<page>?file=a.gcode` → `{ file: 'a.gcode' }`) |
| Widget (`widgets[].element`) | widget body | the dashboard route's query parameters (`edit`, `preview`, …) + `narrow: 'true' \| 'false'` |
| Widget header (`widgets[].headerElement`) | header buttons | `{}` |
| Banner (`banners[]`) | banner | `{ mode: 'expanded' \| 'collapsed', route: 'dashboard' \| 'plugin-page' \| 'settings', narrow: 'true' \| 'false' }` |
| Overlay (`overlays[]`) | overlay | `{}` |
| Chip (`chips[].element`) | chip | `{ chipId, chipLabel?, edit: '1' \| '0', narrow: 'true' \| 'false' }` |
| Chip picker (`chips[].pickerElement`) | item catalog | `{ edit: '1', placed: '<JSON array of ids>' }` |
| Fleet panel (`printerPanels[]`) | printer card | `{ printerId }` |
| Hotkey (`hotkeys[]`) | — (a function, not an element) | see [hotkeys.md](hotkeys.md) |

More details on every surface are in [surfaces.md](surfaces.md).

---

## 5. The manifest

```ts
interface PluginManifest {
  id: string;            // required, unique
  name: string;          // required, display name
  version: string;       // required, a string (compared as a string!)
  entry: string;         // required, path to the ES module relative to the manifest

  pages?: PageContribution[];
  widgets?: WidgetContribution[];
  overlays?: OverlayContribution[];
  banners?: BannerContribution[];
  chips?: ChipContribution[];
  printerPanels?: PrinterPanelContribution[];
  hotkeys?: HotkeyContribution[];
  guards?: GuardContribution[];

  rightPanel?: RightPanelContribution; // accepted ONLY from '@core/system'

  locales?: string[];                  // a declaration, not the translations themselves
  defaultSettings?: Record<string, unknown>; // see pitfalls
}
```

The host checks only the four required fields (`id`, `name`, `version`,
`entry` — non-empty strings). Everything else is sanitized on load: **an invalid
contribution is dropped with a console warning**; the plugin still loads. What
counts as invalid:

| Contribution | Required non-empty strings |
|---|---|
| `overlays[]`, `banners[]`, `printerPanels[]` | `id`, `element` |
| `chips[]` | `type`, `provider`, `titleKey`, `element`, `pickerElement` |
| `hotkeys[]` | `id`, `keys`, `handler`; `scope` ∈ `global`/`dashboard`/`plugin`; `keys` must parse |
| `pages[]`, `widgets[]` | not validated structurally (but nothing is rendered without `element`) |

If the value of `overlays`/`banners`/`chips`/`printerPanels`/`hotkeys` is not an
array, it is discarded.

### Plugin identifier

- Any non-empty string. Core plugins use `@core/…`; for third-party plugins use
  your own prefix (`acme/hello`) so as not to collide with core.
- The plugin's settings are stored by `id`; guards and hotkeys are attached to it;
  settings keys are built from it (`mpu:v2:plugin-settings:<printerId>:<pluginId>`).
- Changing `id` = a new plugin: the old one's settings do not carry over.

### Page icons

A page's `icon` field is the name of a built-in host icon (`dashboard`,
`settings`, `printer`, `globe`, `sun`, `moon`, `plus`, `keyboard`, …; an unknown
name shows the "file" icon). A custom icon can be supplied in two ways:

- `iconSvg` directly in the manifest — a string of SVG markup;
- the module export `pageIcons: Record<string, string>` — the loader substitutes
  `pageIcons[page.icon]` into `iconSvg` if it is not set.

### Page id uniqueness

A page is looked up by `id` **across all plugins**, and page visibility is stored
by the bare `id`. Two pages with the same `id` in different plugins conflict. Use
a plugin prefix: `acme-hello`, not `hello`.

### Versioning

`version` is an arbitrary string. The catalog compares versions **for equality**
(`installedVersion !== catalogVersion` → "update available"), not by semver.
Bump the version with every release.

---

## 6. Plugin lifecycle

1. **Host start.** For every enabled remote plugin (`mpu:v2:plugins`):
   `fetch(manifestUrl)` → validation → `import(entry)` (the URL is resolved
   relative to the manifest) → merge `locales` into the host i18n → sanitize
   contributions → register in the registry → register guards. A failure of one
   plugin is logged and does **not** block the others.
2. **Running.** The module is imported once per session. CEs are created by the
   host as surfaces appear on screen (page opened, widget on the dashboard,
   banner in the flow, …) and destroyed when they leave it.
3. **Disabling** (Settings → Plugins → toggle): contributions and guards are
   removed from the registry; already-mounted elements disappear together with
   their surfaces. The module stays in browser memory.
4. **Removal:** same + the record is deleted from `mpu:v2:plugins`.
5. **Update:** a "hot" manifest reload without F5 (`reloadRemotePlugin`): removal
   + reinstall with the same settings.

Plugins with persistent surfaces (overlays, banners, chips, fleet panels,
hotkeys) in principle do not need "activation on page visit": the module is
loaded at startup, and their contributions work immediately.

### What does not happen on Update

- **The module code is not reloaded.** `import()` is cached by the browser per
  URL. If `index.js` changed but its name did not, the old code keeps running
  until F5. For fast iteration use hashed file names or F5.
- **Custom Elements are not redefined.** `customElements.define` on a taken tag
  throws, and an element cannot be redefined at all. This is exactly why the
  registration must be wrapped in `if (!customElements.get(tag))`.
- **Localization strings are not removed** when a plugin is removed, until F5.

---

## 7. The application context around a plugin

Useful to know when designing:

- **Several printers.** The host keeps printer tabs; at any moment exactly one
  printer is *active*. Switching tabs does **not** drop connections: proxies stay
  alive. A plugin that needs a specific printer regardless of the tab (fleet
  mode) uses `moonrakerFor(id)` / `settingsFor(id)`.
- **Plugin scope.** A plugin's record (`mpu:v2:plugins`) has `printerIds`: an
  empty list means the plugin applies to all printers; a non-empty list, only to
  those listed. The host honors this **only for chips and hotkeys**; pages,
  widgets, banners, overlays and fleet panels are not filtered by `printerIds`.
- **Theme and language change on the fly.** Subscribe to `onThemeChange` /
  `onLocaleChange`, or read CSS variables (they change by themselves) and re-render
  texts on the language event.
- **RTL.** The host sets `dir` on `<html>`; use logical CSS properties
  (`margin-inline-start` instead of `margin-left`).
- **Offline.** If the active printer is unreachable, the host shows a connection
  overlay on top of the UI; your elements stay mounted. Requests are rejected in
  the meantime (`Moonraker connection is not open`); subscriptions are restored
  after reconnect.
- **Klipper is not necessarily ready.** Moonraker can run while `klippy is not
  ready`. Check `printer.info.state` and show a placeholder rather than an error.

---

## 8. Debugging and development

### Workflow

1. Build the plugin, put `manifest.json` + `index.js` into `extensions/<name>/`.
2. `node tools/extensions-sync.cjs` — regenerate `extensions/index.json`
   (needed when a plugin is first added and when its version/name changes).
3. Settings → Plugins → **Refresh** → **Install** / **Update**.
4. When the code changes — **F5** (see "What does not happen on Update").

In dev mode (`npm run dev`) the `extensions/` directory is served by a Vite
middleware at the same URLs as in production (`/extensions/...`), with no caching
for `.json`/`.js`.

### Connecting by URL (Advanced)

Settings → Plugins → **Add by URL (advanced)** — install directly from a manifest
address, for example `http://localhost:5174/manifest.json` from the plugin's dev
server. The host shows a trust warning, and the record gets an *external* badge.

For a plugin on a **different origin**, the server must send CORS headers
(`Access-Control-Allow-Origin`) for both the manifest and the module — this is a
browser restriction the host cannot work around. Plugins from `extensions/` (same
origin) do not need CORS.

On a printer installed with `deploy/install.sh` this mode is **off** by default: nginx
sends a CSP that blocks scripts from other origins. Turn it on in the installer menu:
`tessera` → **S) Settings** → **Plugins by URL** (see [deployment.md](deployment.md)).

### What to look for in the console

- `[plugin-loader] Plugin "…" has invalid <kind> contribution` — the contribution
  was dropped by the sanitizer.
- `[plugin-loader] Failed to load plugin from …` — the manifest or module failed to load.
- `[guard-agent] …: handler export "…" not found` — the manifest declares a guard
  but the module does not export a function with that name.
- `[hotkeys] Conflict on "…"` — a hotkey conflict (both disabled).
- `[hotkeys] …: handler export "…" not found` — the same for hotkeys.
- `Element not registered: <tag>` in place of a surface — the contribution is
  declared but the module never called `customElements.define` for that tag.

### The About / Debug panel

Settings → About / Debug shows the registered guards, parked (frozen) chains and
all hotkeys, with a "disabled: conflict" mark where applicable.

---

## 9. Pitfalls

Collected from the actual behaviour of the code:

1. **`params` and the Svelte wrapper.** `defineMpuElement` passes `params` to the
   component as a plain value, read at the moment of access; assigning
   `el.params = …` on a live element **does not re-render** the Svelte component.
   If a page must react to a query change (for example `?file=`), implement a
   custom CE with a `params` setter, or read `window.location.hash` / subscribe
   to `hashchange`.
2. **`api.settings.onChange` calls the callback as `cb('', allPluginSettings)`.**
   The first argument is always an empty string and the second is the **whole**
   settings object of the current printer, not a single value. Compare the keys
   you care about yourself.
3. **With no active printer** `api.printer` = `{ id: '', name: '', url: '' }`,
   `api.moonraker()` throws synchronously, `api.settings.get` returns `undefined`,
   and `set` silently does nothing.
4. **`onPrinterChange` fires only for a non-empty printer**; resetting the active
   printer does not reach the callback.
5. **`defaultSettings` from the manifest is currently not applied by the host.**
   For default values write `api.settings.get<T>(key) ?? defaultValue`.
6. **`moonraker().request()` can hang for minutes:** a request intercepted by a
   guard with `freeze` waits for the user's decision (up to 10 minutes). Do not
   put short timeouts on it and do not assume "long" means "broken".
7. **`subscribe()` and `poll()` are not guarded**, only `request()` is. Direct
   HTTP (`httpBaseUrl`) is outside the pipeline too.
8. **A repeated identical `request()` while a parked chain exists** is rejected
   with `already_pending` — this is not an error, it is a signal that "the dialog
   is already shown".
9. **CE tags are global and irreversible.** A taken tag cannot be redefined; a
   plugin that does not check `customElements.get` fails on a second load.
10. **`version` is a string compared for equality**, not by semver.
11. **`banners[].scope`** exists in the type but is not applied by the host: a
    banner is rendered on all routes. Filter by `params.route` yourself.
12. **The dashboard may be synchronized between printers.** The `dashboard`
    toggle in `mpu:v2:settingsSync` switches the layout storage to the shared
    `mpu:v2:settings:GLOBAL` (off by default).

---

## 10. Pre-release checklist

- [ ] The manifest has `id`, `name`, `version`, `entry`; every `element` exists.
- [ ] Every CE tag is registered with a `customElements.get` check.
- [ ] The plugin prefix is on CE tags, page `id`s, hotkey `id`s and settings keys.
- [ ] All subscriptions (`subscribe`, `onNotify`, `poll`, `on*Change`) are released in
      `disconnectedCallback`.
- [ ] The element correctly survives unmounting and re-mounting.
- [ ] No hex colors: only theme CSS variables; light and dark themes checked.
- [ ] All strings go through `api.i18n.t`; at least `en` exists.
- [ ] Behaviour under `klippy not ready` and offline is checked.
- [ ] Side-effect actions go through `request()` (so guards fire).
- [ ] The version is bumped; `tools/extensions-sync.cjs` has been run.
- [ ] Build: `process.env.NODE_ENV` is defined, nothing is `external`, the file
      name = `manifest.entry`.
