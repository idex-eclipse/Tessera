import type { PluginApi } from '../../../plugin-sdk/src/types';

/** The slice of `PluginApi` the settings helpers need (also keeps them trivial to fake in tests). */
export type SettingsHost = Pick<PluginApi, 'settings' | 'onPrinterChange'>;

/**
 * Calls `onChange` whenever the plugin's settings of the ACTIVE printer may have changed:
 * a local write, a sync-mode switch, newer settings pulled from the Moonraker DB, or a switch
 * of the active printer. Returns an unsubscribe function.
 *
 * Why this exists (see docs/en/plugin-api.md → Settings → `onChange` specifics):
 * - the host always calls `cb('', allSettings)`, so the key can NOT be used to tell which
 *   setting changed. Handlers like `if (k === 'foo')` never fire; callers must re-read the
 *   keys they care about instead;
 * - `api.settings.onChange` stays bound to the printer that was active at subscribe time, so
 *   it is re-subscribed here on every printer switch;
 * - after a printer switch the callback runs once, because the new printer has its own values.
 *
 * The callback is NOT invoked for the initial state: read the values once before subscribing.
 *
 * @param api     the plugin API (or any object with `settings` and `onPrinterChange`)
 * @param onChange re-read callback; takes no arguments on purpose (the key is meaningless)
 */
export function watchSettings(api: SettingsHost, onChange: () => void): () => void {
  let offSettings = api.settings.onChange(() => onChange());

  const offPrinter = api.onPrinterChange(() => {
    // Re-bind to the new active printer before re-reading, otherwise its changes are missed.
    offSettings();
    offSettings = api.settings.onChange(() => onChange());
    onChange();
  });

  return () => {
    offSettings();
    offPrinter();
  };
}
