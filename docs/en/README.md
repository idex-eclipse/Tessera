# Tessera documentation

<p><strong>English</strong> · <a href="../ru/README.md">Русский</a></p>

This documentation describes the Tessera host and everything needed to develop
**remote plugins**. It is written from the source code; if the behaviour in the code
and in the text diverge, trust the code and fix the document.

## Where to start

1. [plugin-development.md](plugin-development.md) — the plugin development guide:
   a minimal example, the manifest, the Custom Element contract, building, lifecycle,
   debugging, pitfalls, a checklist.
2. [surfaces.md](surfaces.md) — what exactly you can add to the UI and which
   parameters each surface receives.
3. [plugin-api.md](plugin-api.md) — the `PluginApi` reference.

## References

| Document | Topic |
|---|---|
| [architecture.md](architecture.md) | host design, roles, startup, core modules |
| [moonraker-proxy.md](moonraker-proxy.md) | `request`, `subscribe`, `onNotify`, `poll`, cache, errors, authorization |
| [guards.md](guards.md) | preflight request checks (`allow`/`deny`/`freeze`) |
| [hotkeys.md](hotkeys.md) | plugin and host hotkeys, conflicts, reassignment |
| [settings.md](settings.md) | `localStorage` keys, plugin settings, sync, export |
| [i18n-and-theming.md](i18n-and-theming.md) | translations, RTL, CSS variables, the panel language |
| [deployment.md](deployment.md) | `extensions/`, the catalog, installing and updating plugins |

## Quick answers

- **How does a plugin get into the UI?** A manifest + an ES module that registers
  Custom Elements; the host sets the `api` and `params` properties on the element.
- **How do I get printer data?** `api.moonraker().subscribe(…)` — see
  [moonraker-proxy.md](moonraker-proxy.md).
- **How do I send a command?** `api.moonraker().request('printer.gcode.script', { script })`;
  it goes through the guards.
- **How do I save a setting?** `api.settings.set/get` — see [settings.md](settings.md).
- **How do I update a plugin?** From the registry: `tessera-ext update --all`, then
  F5. A plugin copied by hand: replace the files in `extensions/<name>/`, bump
  `version`, run `node tools/extensions-sync.cjs`, press Update in Settings, F5 if the
  code changed. See [deployment.md](deployment.md).
- **Why doesn't my hotkey fire?** A conflict (both disabled), an input field, fleet
  mode, another page — see [hotkeys.md](hotkeys.md).
- **Why didn't my contribution appear?** An invalid contribution is dropped with a
  console warning — see "What to look for in the console" in
  [plugin-development.md](plugin-development.md#8-debugging-and-development).
