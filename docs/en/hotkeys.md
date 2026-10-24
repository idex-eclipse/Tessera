# Hotkeys

The host listens to `keydown` on `window` and invokes plugin handlers and its own
navigation actions. A plugin declares hotkeys **declaratively**, in the manifest;
the user can reassign or disable any of them in **Settings → Hotkeys**.

## Declaration

```json
{
  "hotkeys": [
    {
      "id": "acme-refresh",
      "scope": "plugin",
      "keys": "Alt+R",
      "handler": "refreshHandler",
      "titleKey": "acme.hotkey.refresh"
    }
  ]
}
```

| Field | Req. | Description |
|---|---|---|
| `id` | yes | identifier within the plugin |
| `scope` | yes | `global`, `dashboard` or `plugin` (see below) |
| `keys` | yes | the combination; must parse (see "Writing combinations") |
| `handler` | yes | the name of an entry-module export |
| `titleKey` | no | i18n key of the description for Settings and About |
| `allowInInputs` | no | whether to fire inside input fields (see below) |

An invalid entry (unknown `scope`, unparsable `keys`, empty fields) is dropped on
load with a console warning.

The handler is a plugin module export:

```ts
import type { PluginApi } from '@sdk/types';

export async function refreshHandler(api: PluginApi, event: KeyboardEvent): Promise<void> {
  await reloadMyData(api);
}
```

- the first argument is your plugin's `PluginApi`;
- the second is the original `KeyboardEvent` (`preventDefault()` has already been
  called by the host);
- exceptions (and rejected Promises) are logged by the host and bother no one;
- if there is no export with that name, the host writes a warning once and ignores
  the hotkey.

## Scopes

| `scope` | Active when |
|---|---|
| `global` | everywhere: the dashboard, any page, Settings |
| `dashboard` | only when the dashboard is open |
| `plugin` | only on a page of the **owning plugin** |

Additionally:

- While fleet mode is open (it covers main), `dashboard` and `plugin` do not fire;
  `global` does.
- A plugin's hotkeys do not fire if the plugin does not apply to the active printer
  (the plugin record's `printerIds`).
- "A plugin's page" is determined by the host finding the page owner by the `id` in
  the current route.

## Writing combinations

Format: `Modifier+Modifier+Key`, case-insensitive.

**Modifiers:** `Ctrl` (`Control`), `Alt` (`Option`), `Shift`, `Meta` (`Cmd`,
`Command`, `Win`, `Super`) and the platform **`Mod`** — `Cmd` on macOS and `Ctrl`
on other platforms. Writing `Mod+…` is recommended for cross-platform actions.

**Keys:**

- letters and digits — `K`, `1` (including the numeric keypad);
- punctuation: `/`, `,`, `.`, `;`, `'`, `` ` ``, `-`, `=`, `[`, `]`, `\` — or by
  words `slash`, `comma`, `period`, `semicolon`, `quote`, `backquote`, `minus`,
  `equal`, `plus`;
- named: `Escape` (`Esc`), `Enter` (`Return`), `Tab`, `Space`, `Backspace`,
  `Delete` (`Del`), `Home`, `End`, `PageUp`, `PageDown`, `ArrowUp` (`Up`),
  `ArrowDown` (`Down`), `ArrowLeft` (`Left`), `ArrowRight` (`Right`), `F1`…`F12`.

Examples: `F`, `Alt+1`, `Ctrl+Shift+K`, `Mod+/`, `Shift+/`, `Ctrl+ArrowRight`, `Ctrl++`.

Invalid: an empty string, modifiers only (`Ctrl+Shift`), two main keys
(`Ctrl+K+L`), a repeated modifier, an empty part (`Ctrl++K`).

**Modifiers match exactly**: `Ctrl+K` does not fire when `Ctrl+Shift+K` is held.
Bare modifier events are ignored.

**Layout independence.** Letters, digits and punctuation are matched by the
*physical* key (`KeyboardEvent.code`), so `Ctrl+K` also works under the Russian
layout. Named keys (`F5`, `Escape`, arrows) are matched by the value of
`event.key`.

## Conflicts

Two entries with the same combination (after normalization) may be allowed or may
conflict — depending on the scopes:

| A \ B | `global` | `dashboard` | `plugin` |
|---|---|---|---|
| `global` | conflict | conflict | conflict |
| `dashboard` | conflict | conflict | allowed |
| `plugin` | conflict | allowed | different plugins — allowed, same plugin — conflict |

**A conflict is resolved by disabling both (all) sides** with a console warning
(`[hotkeys] Conflict on "…": …`). An entry that conflicts with only one of several
is disabled too. When the conflict goes away (a plugin is removed, the user
reassigned a key), the remaining entries come back to life by themselves.

Conflicts are computed over the *effective* combinations, i.e. after user
reassignments. The host's navigation keys take part in the check on equal terms with
plugin ones: the host gets no priority — a plugin that takes `F` disables both
itself and "fleet" (see below).

## Input fields

If focus is in an `input`, `textarea`, `select` or `contenteditable`, by default
only combinations with `Ctrl`, `Alt` or `Meta` fire. Single keys and `Shift+key`
do not fire in input fields — that is normal text entry.

The `allowInInputs` field overrides the rule: `false` — do not fire in input fields
even with a modifier (needed for combinations that mean something in text:
`Ctrl+arrows` move by word), `true` — always fire.

The host also does not call the handler if the event is already handled
(`defaultPrevented`), on auto-repeat (`repeat`) and during IME input.

## The host's navigation keys

| Keys | Action |
|---|---|
| `F` | open/close fleet mode |
| `Ctrl+1` … `Ctrl+9` | go to the dashboard of the printer with that number (nothing if there is none) |
| `Ctrl+→` | the next printer (wraps around) |
| `Ctrl+←` | the previous printer (wraps around) |

A switch closes fleet so that the result is visible. `F` and `Ctrl+arrows` do not
fire in input fields. Do not take these combinations in plugins — both sides would
be disabled.

Platform limitations (the host cannot influence them): `Ctrl+1…9` is taken by the
browser in some browsers/OSes (tab switching), and `Ctrl+←/→` on macOS switch
desktops by default.

## User reassignment

Settings → Hotkeys shows all host and plugin keys, grouped by owner. For each you
can:

- **Change** — press a new combination (`Esc` cancels; while recording all hotkeys
  are suspended);
- **Disable / Enable**;
- **Reset** to the manifest value; "Reset all" — for all of them.

Overrides are stored in `mpu:v2:ui.hotkeyOverrides` (device-wide): the key is
`"<pluginId>:<hotkeyId>"` (`"@host:<id>"` for the host), the value is the new
combination or `null` (disabled). An invalid value is ignored and the default
combination stays. If a conflict arises after a reassignment, it is resolved by the
general rules (both are disabled) and the rows in Settings get a "conflict: …" mark.

This gives a rule for developers: **do not rely on your combination staying
unchanged.** `PluginApi` does not tell a plugin the effective combination, so do
not show it in your plugin's UI as a constant ("press Alt+R"); Settings → Hotkeys
provides the hint to the user.

## Recommendations

- Prefer `scope: 'plugin'` — it is the least conflict-prone option.
- Use `Mod+…` for cross-platform actions.
- Do not take system and browser combinations (`Ctrl+T/W/N/R/L/Tab`, `F5`, `F12`,
  `Alt+←`): the browser may intercept the event before the page.
- Do not use single letters in `global`: they will not fire in text fields and most
  likely conflict with the host.
- Always set `titleKey`: without it Settings shows only the `id`.
- A handler should be fast and idempotent; start long operations and return a
  Promise without blocking the thread.
