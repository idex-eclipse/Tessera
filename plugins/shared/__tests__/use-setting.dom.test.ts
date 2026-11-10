import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import type { SettingsHost } from '../settings/watch-settings';
import SettingProbe from './helpers/SettingProbe.svelte';

/** Fake host with the real contract: empty key in onChange, subscription bound to the printer active at subscribe time. */
function fakeHost() {
  const data: Record<string, Record<string, unknown>> = { p1: {}, p2: {} };
  const listeners = new Map<string, Set<(k: string, v: unknown) => void>>();
  const printerCbs = new Set<(p: { id: string }) => void>();
  let active = 'p1';
  const emit = (pid: string) => {
    for (const cb of Array.from(listeners.get(pid) ?? [])) cb('', { ...data[pid] });
  };
  const host = {
    get printer() { return { id: active }; },
    settingsFor: (printerId: string) => ({
      get: (k: string) => data[printerId]?.[k],
      set: (k: string, v: unknown) => {
        (data[printerId] ??= {})[k] = v;
        emit(printerId);
      },
      onChange: (cb: (k: string, v: unknown) => void) => {
        const bound = printerId;
        const set = listeners.get(bound) ?? new Set();
        set.add(cb);
        listeners.set(bound, set);
        return () => set.delete(cb);
      },
    }),
    onPrinterChange: (cb: (p: { id: string }) => void) => {
      printerCbs.add(cb);
      return () => printerCbs.delete(cb);
    },
  } as unknown as SettingsHost;
  return {
    host,
    remote(pid: string, k: string, v: unknown) {
      (data[pid] ??= {})[k] = v;
      emit(pid);
    },
    switchTo(id: string) {
      active = id;
      for (const cb of Array.from(printerCbs)) cb({ id });
    },
    listenerCount: () => Array.from(listeners.values()).reduce((n, s) => n + s.size, 0),
  };
}

function setup(f: ReturnType<typeof fakeHost>, expose?: (s: { set(v: boolean): void }) => void) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const c = mount(SettingProbe, { target, props: { api: f.host, expose } });
  flushSync();
  const text = () => target.querySelector('[data-testid="flag"]')?.textContent;
  return { text, stop: () => (unmount(c), target.remove()) };
}

describe('useSetting in a mounted component (client compile)', () => {
  it('re-renders when settings arrive from the database (empty key)', () => {
    const f = fakeHost();
    const { text, stop } = setup(f);
    expect(text()).toBe('false');
    f.remote('p1', 'flag', true);
    flushSync();
    expect(text()).toBe('true');
    stop();
  });

  it('re-renders after a printer switch, and follows settings of the NEW printer', () => {
    const f = fakeHost();
    f.remote('p2', 'flag', true);
    const { text, stop } = setup(f);
    expect(text()).toBe('false'); // p1 has nothing stored
    f.switchTo('p2');
    flushSync();
    expect(text()).toBe('true');

    f.remote('p2', 'flag', false); // a later DB pull for the new printer
    flushSync();
    expect(text()).toBe('false');
    stop();
  });

  it('writes through set() and shows it immediately', () => {
    const f = fakeHost();
    let setting!: { set(v: boolean): void };
    const { text, stop } = setup(f, (s) => (setting = s));
    setting.set(true);
    flushSync();
    expect(text()).toBe('true');
    expect(f.host.settingsFor(f.host.printer.id).get('flag')).toBe(true);
    stop();
  });

  it('releases its subscriptions when the component is destroyed', () => {
    const f = fakeHost();
    const { stop } = setup(f);
    expect(f.listenerCount()).toBeGreaterThan(0);
    stop();
    expect(f.listenerCount()).toBe(0);
  });
});
