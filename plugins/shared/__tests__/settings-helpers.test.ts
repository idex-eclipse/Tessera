import { describe, expect, it, vi } from 'vitest';

import { createSetting } from '../settings/create-setting.svelte';
import { watchSettings, type SettingsHost } from '../settings/watch-settings';

/**
 * A fake host that mimics the REAL contract of `api.settings` (plugin-api-factory.ts):
 * - `onChange` calls back as `cb('', allSettings)` - the key is always empty;
 * - `onChange` stays bound to the printer that was active when it was subscribed;
 * - `get`/`set` follow the active printer.
 */
function fakeHost(initial: Record<string, Record<string, unknown>> = { p1: {}, p2: {} }) {
  const data: Record<string, Record<string, unknown>> = structuredClone(initial);
  const listeners = new Map<string, Set<(key: string, value: unknown) => void>>();
  const printerListeners = new Set<(p: { id: string }) => void>();
  let active = 'p1';

  // One printer's settings object; created on demand so indexing stays type-safe.
  const bucket = (printerId: string): Record<string, unknown> => (data[printerId] ??= {});

  const emit = (printerId: string) => {
    for (const cb of Array.from(listeners.get(printerId) ?? [])) cb('', { ...bucket(printerId) });
  };

  const host = {
    settings: {
      get: <T>(key: string) => data[active]?.[key] as T | undefined,
      set: (key: string, value: unknown) => {
        bucket(active)[key] = value;
        emit(active);
      },
      onChange: (cb: (key: string, value: unknown) => void) => {
        const bound = active;
        const set = listeners.get(bound) ?? new Set();
        set.add(cb);
        listeners.set(bound, set);
        return () => set.delete(cb);
      },
    },
    onPrinterChange: (cb: (p: { id: string }) => void) => {
      printerListeners.add(cb);
      return () => printerListeners.delete(cb);
    },
  } as unknown as SettingsHost;

  return {
    host,
    /** Simulates settings arriving from the Moonraker DB (a write that did not come from the plugin). */
    remoteWrite(printerId: string, key: string, value: unknown) {
      bucket(printerId)[key] = value;
      emit(printerId);
    },
    switchPrinter(id: string) {
      active = id;
      for (const cb of Array.from(printerListeners)) cb({ id });
    },
    listenerCount: () => Array.from(listeners.values()).reduce((n, s) => n + s.size, 0),
    printerListenerCount: () => printerListeners.size,
  };
}

describe('watchSettings', () => {
  it('fires on a write even though the host reports an empty key', () => {
    const { host, remoteWrite } = fakeHost();
    const cb = vi.fn();
    watchSettings(host, cb);
    remoteWrite('p1', 'a', 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is not called for the initial state', () => {
    const { host } = fakeHost();
    const cb = vi.fn();
    watchSettings(host, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('re-subscribes on a printer switch: the new printer is watched, the old one is not', () => {
    const { host, remoteWrite, switchPrinter } = fakeHost();
    const cb = vi.fn();
    watchSettings(host, cb);

    switchPrinter('p2');
    expect(cb).toHaveBeenCalledTimes(1); // values differ per printer, so it re-reads once

    remoteWrite('p2', 'a', 1);
    expect(cb).toHaveBeenCalledTimes(2);

    remoteWrite('p1', 'a', 1); // the previous printer is no longer ours
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('releases every subscription on stop', () => {
    const { host, listenerCount, printerListenerCount } = fakeHost();
    const stop = watchSettings(host, () => {});
    stop();
    expect(listenerCount()).toBe(0);
    expect(printerListenerCount()).toBe(0);
  });
});

describe('createSetting', () => {
  it('returns the fallback while nothing is stored, then the stored value', () => {
    const empty = fakeHost();
    expect(createSetting(empty.host, 'k', 5).value).toBe(5);

    const stored = fakeHost({ p1: { k: 9 }, p2: {} });
    expect(createSetting(stored.host, 'k', 5).value).toBe(9);
  });

  it('picks up settings that arrive later (DB pull / another surface) without a key match', () => {
    // Regression: handlers comparing the key (`k === 'x'`) never fired with the real host.
    const { host, remoteWrite } = fakeHost();
    const s = createSetting(host, 'status.banner', true);
    expect(s.value).toBe(true);
    remoteWrite('p1', 'status.banner', false);
    expect(s.value).toBe(false);
  });

  it('re-reads on a printer switch', () => {
    const { host, switchPrinter } = fakeHost({ p1: { k: 1 }, p2: { k: 2 } });
    const s = createSetting(host, 'k', 0);
    expect(s.value).toBe(1);
    switchPrinter('p2');
    expect(s.value).toBe(2);
  });

  it('set() updates immediately and persists', () => {
    const { host } = fakeHost();
    const s = createSetting(host, 'k', 0);
    s.set(7);
    expect(s.value).toBe(7);
    expect(host.settings.get('k')).toBe(7);
  });

  it('keeps the same object when an unrelated key changes', () => {
    const { host, remoteWrite } = fakeHost({ p1: { cols: { a: true } }, p2: {} });
    const s = createSetting(host, 'cols', { a: false });
    const before = s.value;
    remoteWrite('p1', 'other', 1);
    expect(s.value).toBe(before);
  });

  it('runs the stored value through parse and falls back on garbage', () => {
    const { host, remoteWrite } = fakeHost({ p1: { mode: 'weird' }, p2: {} });
    const parse = (raw: unknown, fb: 'a' | 'b') => (raw === 'a' || raw === 'b' ? raw : fb);
    const s = createSetting<'a' | 'b'>(host, 'mode', 'a', parse);
    expect(s.value).toBe('a');
    remoteWrite('p1', 'mode', 'b');
    expect(s.value).toBe('b');
  });

  it('stops following the settings after destroy()', () => {
    const { host, remoteWrite, listenerCount } = fakeHost();
    const s = createSetting(host, 'k', 0);
    s.destroy();
    remoteWrite('p1', 'k', 3);
    expect(s.value).toBe(0);
    expect(listenerCount()).toBe(0);
  });
});

describe('parsers', () => {
  it('asBoolean accepts only booleans', async () => {
    const { asBoolean } = await import('../settings/parsers');
    expect(asBoolean(false, true)).toBe(false);
    expect(asBoolean('no', true)).toBe(true);
    expect(asBoolean(undefined, false)).toBe(false);
  });

  it('asNumber clamps and rejects non-finite values', async () => {
    const { asNumber } = await import('../settings/parsers');
    const p = asNumber(1, 10);
    expect(p(5, 3)).toBe(5);
    expect(p(99, 3)).toBe(10);
    expect(p(-4, 3)).toBe(1);
    expect(p(Number.NaN, 3)).toBe(3);
    expect(p('7', 3)).toBe(3);
  });

  it('oneOf accepts only listed values', async () => {
    const { oneOf } = await import('../settings/parsers');
    const p = oneOf(['a', 'b'] as const);
    expect(p('b', 'a')).toBe('b');
    expect(p('c', 'a')).toBe('a');
    expect(p(undefined, 'a')).toBe('a');
  });
});
