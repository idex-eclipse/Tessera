import { describe, expect, it, vi } from 'vitest';

import type { PluginApi, PluginManifest } from '../../../../plugin-sdk/src/types';
import { createHotkeyManager } from '../hotkey-manager.svelte.ts';
import { createPluginRegistry } from '../plugin-registry.svelte.ts';
import type { Route } from '../router.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { MemoryStorage } from '../storage';

function manifest(id: string, over: Partial<PluginManifest> = {}): PluginManifest {
  return { id, name: id, version: '1.0.0', entry: 'index.js', ...over };
}

function keydown(over: Partial<KeyboardEvent> & { code: string; key: string }): KeyboardEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    preventDefault() {
      (this as { defaultPrevented: boolean }).defaultPrevented = true;
    },
    ...over,
  } as unknown as KeyboardEvent;
}

const dashboard: Route = { kind: 'dashboard', printerId: 'p1', query: {} };
const settingsRoute: Route = { kind: 'settings', section: null };
const pageOf = (pageId: string): Route => ({ kind: 'plugin-page', printerId: 'p1', pageId, query: {} });

function setup(manifests: PluginManifest[], modules: Record<string, Record<string, unknown>>) {
  const registry = createPluginRegistry(createSettingsStore({ storage: new MemoryStorage() }));
  for (const m of manifests) registry.registerPlugin(m);

  const state = { route: dashboard as Route, fleet: false, applies: true };
  const warn = vi.fn();
  const manager = createHotkeyManager({
    registry,
    getRoute: () => state.route,
    getModule: (id) => modules[id],
    getApi: (id) => ({ pluginId: id }) as unknown as PluginApi,
    appliesToActivePrinter: () => state.applies,
    isFleetOpen: () => state.fleet,
    warn,
  });
  return { registry, manager, state, warn };
}

const hk = (id: string, scope: 'global' | 'dashboard' | 'plugin', keys: string) => ({
  id,
  scope,
  keys,
  handler: id,
});

describe('hotkey-manager', () => {
  it('global fires on dashboard, plugin page and settings', () => {
    const fn = vi.fn();
    const { manager, state } = setup(
      [manifest('a', { hotkeys: [hk('fn', 'global', 'Ctrl+K')] })],
      { a: { fn } },
    );

    for (const route of [dashboard, pageOf('x'), settingsRoute]) {
      state.route = route;
      expect(manager.handleKeydown(keydown({ code: 'KeyK', key: 'k', ctrlKey: true }))).toBe(true);
    }
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls[0]![0]).toMatchObject({ pluginId: 'a' });
  });

  it('dashboard scope fires only on dashboard', () => {
    const fn = vi.fn();
    const { manager, state } = setup(
      [manifest('a', { hotkeys: [hk('fn', 'dashboard', 'Alt+1')] })],
      { a: { fn } },
    );
    const ev = () => keydown({ code: 'Digit1', key: '1', altKey: true });

    expect(manager.handleKeydown(ev())).toBe(true);
    state.route = pageOf('x');
    expect(manager.handleKeydown(ev())).toBe(false);
    state.route = settingsRoute;
    expect(manager.handleKeydown(ev())).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('plugin scope fires only on the owner plugin page; same key in two plugins routes by page', () => {
    const fnA = vi.fn();
    const fnB = vi.fn();
    const { manager, state } = setup(
      [
        manifest('a', { pages: [{ id: 'pa', titleKey: 't', element: 'e' }], hotkeys: [hk('fnA', 'plugin', 'F2')] }),
        manifest('b', { pages: [{ id: 'pb', titleKey: 't', element: 'e' }], hotkeys: [hk('fnB', 'plugin', 'F2')] }),
      ],
      { a: { fnA }, b: { fnB } },
    );
    const ev = () => keydown({ code: 'F2', key: 'F2' });

    state.route = pageOf('pa');
    manager.handleKeydown(ev());
    state.route = pageOf('pb');
    manager.handleKeydown(ev());
    state.route = dashboard;
    expect(manager.handleKeydown(ev())).toBe(false);

    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
    expect(manager.conflicts).toEqual([]);
  });

  it('dashboard + plugin may share a key', () => {
    const dash = vi.fn();
    const plug = vi.fn();
    const { manager, state } = setup(
      [
        manifest('a', {
          pages: [{ id: 'pa', titleKey: 't', element: 'e' }],
          hotkeys: [hk('dash', 'dashboard', 'F4'), hk('plug', 'plugin', 'F4')],
        }),
      ],
      { a: { dash, plug } },
    );
    manager.handleKeydown(keydown({ code: 'F4', key: 'F4' }));
    state.route = pageOf('pa');
    manager.handleKeydown(keydown({ code: 'F4', key: 'F4' }));
    expect(dash).toHaveBeenCalledTimes(1);
    expect(plug).toHaveBeenCalledTimes(1);
  });

  it('conflicting hotkeys are both disabled', () => {
    const f1 = vi.fn();
    const f2 = vi.fn();
    const { manager, registry } = setup(
      [
        manifest('a', { hotkeys: [hk('f1', 'global', 'Ctrl+K')] }),
        manifest('b', { hotkeys: [hk('f2', 'dashboard', 'ctrl+k')] }),
      ],
      { a: { f1 }, b: { f2 } },
    );
    expect(manager.conflicts).toHaveLength(1);
    expect(manager.handleKeydown(keydown({ code: 'KeyK', key: 'k', ctrlKey: true }))).toBe(false);
    expect(f1).not.toHaveBeenCalled();
    expect(f2).not.toHaveBeenCalled();

    // снятие одного из участников возвращает второго к жизни
    registry.unregisterPlugin('b');
    expect(manager.conflicts).toEqual([]);
    expect(manager.handleKeydown(keydown({ code: 'KeyK', key: 'k', ctrlKey: true }))).toBe(true);
    expect(f1).toHaveBeenCalledTimes(1);
  });

  it('start() warns once per conflict and stops cleanly', () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: (t: string, l: EventListener) => void listeners.set(t, l),
      removeEventListener: (t: string) => void listeners.delete(t),
    };
    const registry = createPluginRegistry(createSettingsStore({ storage: new MemoryStorage() }));
    registry.registerPlugin(manifest('a', { hotkeys: [hk('f1', 'global', 'F9')] }));
    registry.registerPlugin(manifest('b', { hotkeys: [hk('f2', 'global', 'F9')] }));
    const warn = vi.fn();
    const manager = createHotkeyManager({
      registry,
      getRoute: () => dashboard,
      getModule: () => ({}),
      getApi: () => null,
      appliesToActivePrinter: () => true,
      target,
      warn,
    });

    const stop = manager.start();
    expect(listeners.has('keydown')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('f9');
    manager.checkConflicts();
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.has('keydown')).toBe(false);
  });

  it('ignores bare keys in text inputs but allows Ctrl combos', () => {
    const bare = vi.fn();
    const ctrl = vi.fn();
    const { manager } = setup(
      [manifest('a', { hotkeys: [hk('bare', 'global', 'F6'), hk('ctrl', 'global', 'Ctrl+S')] })],
      { a: { bare, ctrl } },
    );
    const input = { tagName: 'INPUT' };
    expect(manager.handleKeydown(keydown({ code: 'F6', key: 'F6', target: input as unknown as EventTarget }))).toBe(false);
    expect(
      manager.handleKeydown(keydown({ code: 'KeyS', key: 's', ctrlKey: true, target: input as unknown as EventTarget })),
    ).toBe(true);
    expect(bare).not.toHaveBeenCalled();
    expect(ctrl).toHaveBeenCalledTimes(1);
  });

  it('dashboard/plugin scopes are suspended while fleet is open; global is not', () => {
    const dash = vi.fn();
    const glob = vi.fn();
    const { manager, state } = setup(
      [manifest('a', { hotkeys: [hk('dash', 'dashboard', 'F7'), hk('glob', 'global', 'F8')] })],
      { a: { dash, glob } },
    );
    state.fleet = true;
    expect(manager.handleKeydown(keydown({ code: 'F7', key: 'F7' }))).toBe(false);
    expect(manager.handleKeydown(keydown({ code: 'F8', key: 'F8' }))).toBe(true);
  });

  it('skips plugins not applicable to the active printer, repeats and handled events', () => {
    const fn = vi.fn();
    const { manager, state } = setup([manifest('a', { hotkeys: [hk('fn', 'global', 'F10')] })], { a: { fn } });

    state.applies = false;
    expect(manager.handleKeydown(keydown({ code: 'F10', key: 'F10' }))).toBe(false);
    state.applies = true;
    expect(manager.handleKeydown(keydown({ code: 'F10', key: 'F10', repeat: true }))).toBe(false);
    expect(manager.handleKeydown(keydown({ code: 'F10', key: 'F10', defaultPrevented: true }))).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('handler errors (sync and async) are reported, not thrown; missing handler warns once', async () => {
    const { manager, warn } = setup(
      [
        manifest('a', {
          hotkeys: [hk('boom', 'global', 'F11'), hk('rej', 'global', 'F12'), hk('ghost', 'global', 'Alt+G')],
        }),
      ],
      {
        a: {
          boom: () => {
            throw new Error('x');
          },
          rej: () => Promise.reject(new Error('y')),
        },
      },
    );

    expect(() => manager.handleKeydown(keydown({ code: 'F11', key: 'F11' }))).not.toThrow();
    manager.handleKeydown(keydown({ code: 'F12', key: 'F12' }));
    await Promise.resolve();
    await Promise.resolve();
    manager.handleKeydown(keydown({ code: 'KeyG', key: 'g', altKey: true }));
    manager.handleKeydown(keydown({ code: 'KeyG', key: 'g', altKey: true }));

    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes('handler failed'))).toHaveLength(2);
    expect(messages.filter((m) => m.includes('not found'))).toHaveLength(1);
  });
});
