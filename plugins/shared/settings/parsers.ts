import type { SettingParser } from './create-setting.svelte';

/**
 * Ready-made `SettingParser`s for `createSetting` / `useSetting`. Stored settings are plain JSON
 * that a user, an import or another browser may have written, so a plugin must never trust the
 * shape: each parser returns the fallback for anything it does not recognise.
 */

/** A boolean; anything else falls back. */
export const asBoolean: SettingParser<boolean> = (raw, fallback) =>
  typeof raw === 'boolean' ? raw : fallback;

/** A finite number, optionally clamped to [min, max]; anything else falls back. */
export function asNumber(min = -Infinity, max = Infinity): SettingParser<number> {
  return (raw, fallback) =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback;
}

/** A finite number greater than zero (lengths, speeds, intervals); anything else falls back. */
export const asPositiveNumber: SettingParser<number> = (raw, fallback) =>
  typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback;

/** One of a fixed set of string literals; anything else falls back. */
export function oneOf<T extends string>(allowed: readonly T[]): SettingParser<T> {
  return (raw, fallback) => (allowed.includes(raw as T) ? (raw as T) : fallback);
}
