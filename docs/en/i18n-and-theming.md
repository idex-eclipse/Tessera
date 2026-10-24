# Localization and the design system

## Localization

### How a plugin supplies translations

The `entry` module exports a named `locales` — an object
`{ <locale>: <messages> }`. After `import()`, the loader merges it (deep merge) into
the host's dictionary:

```ts
export const locales = {
  en: {
    acme: {
      title: 'Hello',
      greeting: 'Active printer: {name}',
      errors: { offline: 'Printer is offline' },
    },
  },
  ru: {
    acme: {
      title: 'Привет',
      greeting: 'Активный принтер: {name}',
      errors: { offline: 'Принтер недоступен' },
    },
  },
};
```

`manifest.locales` is only a declaration of supported languages (`["en","ru"]`);
only the actual messages in `locales` matter.

Messages can be **nested** objects (as above) or **flat** keys
`"acme.title": "…"`. An exact match of a flat key has priority, then a dotted
traversal follows.

### Usage

```ts
api.i18n.t('acme.title');
api.i18n.t('acme.greeting', { name: api.printer.name });   // substitutes {name}
```

`titleKey` of pages, widgets, chips and fleet panels are also `t` keys.

### How a key is found

The dictionary is **shared** by the host and all plugins. For the current locale the
lookup goes in order:

1. the exact locale (`ru-ru`; case and `_`/`-` are normalized);
2. the base language (`ru`), if the locale has a region;
3. the host's fallback locale (`en`).

If the key is nowhere, `t` returns **the key itself**.

Consequences:

- **A namespace is mandatory.** All plugin keys must start with a unique prefix
  (`acme.`), otherwise you overwrite other people's strings: the merge is deep and
  has no collision protection.
- The host's shared strings are available to any plugin: `common.*` (`add`,
  `remove`, `refresh`, `edit`, `save`, `cancel`, `close`, `retry`, `reset`, `back`,
  `loading`, `error`, `confirm`, `klipperNotReady`, …). You can use them without
  duplication. Other host branches (`settings.*`, `dashboard.*`, `nav.*`) are
  internal; do not rely on their stability.
- Strings added by a plugin are **not removed** when the plugin is disabled/removed
  until the page is reloaded.
- If a plugin does not know the user's language, they will see `en` strings — always
  provide a complete `en`.

### Language change and RTL

```ts
const off = api.onLocaleChange((locale, dir) => rerender());
```

The host sets attributes on `<html>`: `data-locale` and `dir` (`ltr` | `rtl`). For
RTL use **logical** CSS properties: `margin-inline-start`, `padding-inline`,
`inset-inline-end`, `text-align: start`, `border-inline-start` instead of
`left/right`.

---

## The design system

All surfaces must look like one product. This is achieved by shared rules and theme
CSS variables, not by fitting each plugin by hand.

### Theme

The host sets the `data-theme="light|dark"` attribute on `<html>`. Variables are
defined for both themes. The user can set an **accent color** — the host overrides
`--accent` inline on `<html>`; derived colors recompute automatically.

Rule: **do not use hex colors in plugin components.** Variables only, otherwise the
plugin breaks on another theme or with another accent. For canvas/WebGL, read the
variable's value at draw time and redraw on `onThemeChange`:

```ts
const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
```

### Variables

**Backgrounds**

| Variable | Purpose |
|---|---|
| `--bg-app` | application background |
| `--bg-surface` | panel and card background |
| `--bg-surface-hover` | hover on a surface (mixes in the accent) |
| `--bg-surface-hover-no-override` | a neutral muted background for buttons/fields: a fixed theme color that does **not** mix with the accent (unlike `--bg-surface-hover`) |
| `--bg-surface-active` | selected/active element (mixes in the accent) |
| `--bg-header`, `--bg-sidebar` | header and sidebar (usually not needed by plugins) |
| `--bg-overlay` | dimming under modal windows (backdrop) |

**Text**

`--text-primary`, `--text-secondary`, `--text-muted`, `--text-on-header`,
`--text-on-header-muted`.

**Borders and focus:** `--border-color`, `--border-focus`.

**Accent and semantics**

| Variable | Purpose |
|---|---|
| `--accent` | the main interactive color (buttons, active states) |
| `--accent-text` | text color **on** an accent fill |
| `--accent-hover`, `--accent-active` | accent button states |
| `--accent-subtle`, `--accent-subtle-strong` | semi-transparent accent fill |
| `--accent-ring` | focus ring |
| `--danger` | error, destructive action |
| `--warning` | warning, "powered/active" |
| `--success` | normal, success |
| `--heat` / `--cool` | thermal semantics: heating / cooling |

**Sizes and styling**

| Group | Variables |
|---|---|
| Spacing | `--space-xs` 4px, `--space-sm` 8px, `--space-md` 16px, `--space-lg` 24px, `--space-xl` 32px |
| Radii | `--radius-sm` 4px, `--radius-md` 8px, `--radius-lg` 12px |
| Typography | `--font-family`, `--font-size-sm` (0.925rem), `--font-size-md` (1rem), `--font-size-lg` (1.2rem) |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| Transitions | `--transition-fast` (150ms), `--transition-normal` (250ms) |
| Dashboard grid | `--grid-row-height` (80px) |
| Layers | `--z-plugin-overlays` (60), `--z-right-panel` (30) |

The light/dark values are in
[`host/src/styles/global.css`](../../host/src/styles/global.css).

> The `:root` variables live in the same CSS space as the page: a Custom Element is
> not isolated by Shadow DOM (the host mounts the element as is), so the host's
> global styles also apply to your content. Style your component with a class
> prefix or your own Shadow DOM so as not to affect anything else.

### Panel language

The basic unit of the interface is the **panel** (card).

- A plugin page = a vertical stack of panels. A grid of several independently
  scrolling panels is acceptable if they form one working surface.
- **There is no separate big page title**: the name is set by the sidebar entry.
  Inside the page there are only panel headers.
- A panel: a header inside the block, a content area, a footer if needed. Background
  `--bg-surface`, border `--border-color`, radius `--radius-md`/`--radius-lg`, a
  shadow if needed, the host's typography.
- **Panel header:** the name on the left (with `ellipsis`, no wrapping), `headerActions`
  on the right — buttons, icons, toggles, search, refresh. Secondary actions as
  icons; if there are many actions, the main ones are visible and the rest go into a
  menu; destructive actions — only with confirmation.
- A **widget** is a smaller page: the same panel language, the title inside the card
  (drawn by the host), actions in the header (`headerElement`), denser content.
- A **chip** is not a panel but a mini element: an 80px-high slot, width by content;
  a two-line body (category on top — uppercase, muted; the value below); a status
  indicator stripe on the left in a semantic color; the action is a popover;
  *missing* — a dashed border and muted text.
- **Modal windows** (overlays): a `--bg-overlay` backdrop, the dialog is a panel.
- Buttons: an accent fill (`--accent` + `--accent-text`) for the main action,
  neutral (`--bg-surface-hover-no-override`) for others, `--danger` for destructive ones.

### States

For every surface think through and show: loading, empty, error, *Klippy not ready*,
no connection. Do not count on the host covering everything: the offline overlay
covers the UI, but your element stays mounted and keeps receiving events.

### Accessibility and behaviour

- Interactive elements are real `button`/`a`/`input`, not a `div` with `onclick`.
- Visible focus (`--accent-ring`/`--border-focus`).
- Do not block page scroll or the mouse wheel without need.
- Keep working at narrow widths: the dashboard grid collapses into one column.
