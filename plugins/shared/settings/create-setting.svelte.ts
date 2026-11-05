import { onDestroy } from 'svelte';

import { watchSettings, type SettingsHost } from './watch-settings';

/** A reactive view of one plugin setting: reading `value` in a component/`$derived` tracks it. */
export interface ReactiveSetting<T> {
  /** Current value (the fallback while nothing is stored). Reactive. */
  readonly value: T;
  /** Updates `value` immediately and persists it through `api.settings.set`. */
  set(next: T): void;
  /** Stops listening to the settings. Idempotent. */
  destroy(): void;
}

/** Turns the raw stored value (`undefined` when absent, or anything on a corrupt store) into `T`. */
export type SettingParser<T> = (raw: unknown, fallback: T) => T;

const defaultParse = <T>(raw: unknown, fallback: T): T => (raw === undefined ? fallback : (raw as T));

/**
 * Reactive setting: reads `key` with a default, and re-reads it after anything that may change
 * it - a write from another surface, a sync-mode switch, settings arriving from the Moonraker DB
 * or a printer switch (see `watchSettings`). This is the one way built-in plugins read settings.
 *
 * Pure factory (no `onDestroy`), so it can be used from long-lived cores and from tests; inside a
 * component use `useSetting`, which also unsubscribes on destroy.
 *
 * @param api      the plugin API
 * @param key      settings key (prefix it with the area, e.g. `status.banner`)
 * @param fallback value used while nothing valid is stored (the host does not apply
 *                 `manifest.defaultSettings`)
 * @param parse    validates/normalizes the stored value; must return `fallback` for bad input
 */
export function createSetting<T>(
  api: SettingsHost,
  key: string,
  fallback: T,
  parse: SettingParser<T> = defaultParse,
): ReactiveSetting<T> {
  const read = (): unknown => api.settings.get<unknown>(key);

  // Objects are compared by their JSON form so an unrelated key's change (the host reports the
  // whole settings object) does not hand the component a fresh object and re-render it.
  let signature = JSON.stringify(read());
  let value = $state<T>(parse(read(), fallback));

  const unwatch = watchSettings(api, () => {
    const raw = read();
    const next = JSON.stringify(raw);
    if (next === signature) return;
    signature = next;
    value = parse(raw, fallback);
  });

  return {
    get value() {
      return value;
    },
    set(next) {
      value = next;
      // Keep the signature in step so the echo of our own write is ignored by the watcher.
      signature = JSON.stringify(next);
      api.settings.set(key, next);
    },
    destroy: unwatch,
  };
}

/** `createSetting` for use during component initialisation: unsubscribes when the component is destroyed. */
export function useSetting<T>(
  api: SettingsHost,
  key: string,
  fallback: T,
  parse?: SettingParser<T>,
): ReactiveSetting<T> {
  const setting = createSetting(api, key, fallback, parse);
  onDestroy(setting.destroy);
  return setting;
}
