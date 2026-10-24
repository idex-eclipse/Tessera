import { describe, expect, it, vi } from 'vitest';

import type { PluginApi, PluginManifest } from '../../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../host-hotkeys';
import { createHotkeyManager } from '../hotkey-manager.svelte.ts';
import { analyzeHotkeys, eventMatches, formatCombo, parseCombo } from '../hotkeys';
import { createPluginRegistry } from '../plugin-registry.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { MemoryStorage } from '../storage';

function ev(over: Partial<KeyboardEvent> & { code: string; key: string }): KeyboardEvent {
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

function setup(
  opts: {
    active?: string | null;
    plugins?: PluginManifest[];
    modules?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const printers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const printerManager = {
    printers,
    activePrinterId: opts.active === undefined ? 'a' : opts.active,
  };
  const router = { navigateToPrinter: vi.fn() };
  const ui = { toggleFleet: vi.fn(), setFleet: vi.fn() };
  const registry = createPluginRegistry(createSettingsStore({ storage: new MemoryStorage() }));
  for (const m of opts.plugins ?? []) registry.registerPlugin(m);
  const warn = vi.fn();
  const manager = createHotkeyManager({
    registry,
    getRoute: () => ({ kind: 'dashboard', printerId: 'a', query: {} }),
    getModule: (id) => opts.modules?.[id],
    getApi: (id) => ({ pluginId: id }) as unknown as PluginApi,
    appliesToActivePrinter: () => true,
    hostHotkeys: createHostHotkeys({
      router,
      printerManager: printerManager as never,
      ui,
    }),
    warn,
  });
  return { manager, router, ui, warn, printerManager };
}

describe('host navigation hotkeys', () => {
  it('F toggles fleet; Shift+F does not', () => {
    const { manager, ui } = setup();
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(true);
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'F', shiftKey: true }))).toBe(false);
    expect(ui.toggleFleet).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+<n> switches to the n-th printer and closes fleet; unknown n is a no-op', () => {
    const { manager, router, ui } = setup();
    manager.handleKeydown(ev({ code: 'Digit2', key: '2', ctrlKey: true }));
    expect(router.navigateToPrinter).toHaveBeenCalledWith('b');
    expect(ui.setFleet).toHaveBeenCalledWith(false);

    router.navigateToPrinter.mockClear();
    manager.handleKeydown(ev({ code: 'Digit7', key: '7', ctrlKey: true }));
    expect(router.navigateToPrinter).not.toHaveBeenCalled();
  });

  it('Ctrl+Right / Ctrl+Left cycle through printers with wrap-around', () => {
    const { manager, router, printerManager } = setup({ active: 'c' });
    manager.handleKeydown(ev({ code: 'ArrowRight', key: 'ArrowRight', ctrlKey: true }));
    expect(router.navigateToPrinter).toHaveBeenLastCalledWith('a');

    printerManager.activePrinterId = 'a';
    manager.handleKeydown(ev({ code: 'ArrowLeft', key: 'ArrowLeft', ctrlKey: true }));
    expect(router.navigateToPrinter).toHaveBeenLastCalledWith('c');
  });

  it('with no active printer: Right goes to the first, Left to the last', () => {
    const { manager, router } = setup({ active: null });
    manager.handleKeydown(ev({ code: 'ArrowRight', key: 'ArrowRight', ctrlKey: true }));
    expect(router.navigateToPrinter).toHaveBeenLastCalledWith('a');
    manager.handleKeydown(ev({ code: 'ArrowLeft', key: 'ArrowLeft', ctrlKey: true }));
    expect(router.navigateToPrinter).toHaveBeenLastCalledWith('c');
  });

  it('bare F and Ctrl+arrows do not fire in text inputs, Ctrl+digit does', () => {
    const { manager, router, ui } = setup();
    const target = { tagName: 'TEXTAREA' } as unknown as EventTarget;
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f', target }))).toBe(false);
    expect(
      manager.handleKeydown(ev({ code: 'ArrowRight', key: 'ArrowRight', ctrlKey: true, target })),
    ).toBe(false);
    expect(manager.handleKeydown(ev({ code: 'Digit1', key: '1', ctrlKey: true, target }))).toBe(true);
    expect(ui.toggleFleet).not.toHaveBeenCalled();
    expect(router.navigateToPrinter).toHaveBeenCalledWith('a');
  });

  it('a plugin hotkey on a host combo disables BOTH (with a warning)', () => {
    const fn = vi.fn();
    const { manager, ui, warn } = setup({
      plugins: [
        {
          id: 'x',
          name: 'x',
          version: '1',
          entry: 'i.js',
          hotkeys: [{ id: 'fn', scope: 'plugin', keys: 'F', handler: 'fn' }],
        },
      ],
      modules: { x: { fn } },
    });
    expect(manager.conflicts).toHaveLength(1);
    manager.checkConflicts();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(ui.toggleFleet).not.toHaveBeenCalled();
  });

  it('a plugin cannot impersonate the host owner', () => {
    const { manager } = setup({
      plugins: [
        {
          id: '@host',
          name: 'evil',
          version: '1',
          entry: 'i.js',
          hotkeys: [{ id: 'toggle-fleet', scope: 'global', keys: 'F', handler: 'h' }],
        },
      ],
    });
    expect(manager.conflicts).toEqual([]);
    expect(manager.bindings.filter((b) => b.canonical === 'f')).toHaveLength(1);
  });
});

describe('modifier support', () => {
  const k = (code: string, key: string, mods: Partial<KeyboardEvent>) =>
    ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code, key, ...mods }) as KeyboardEvent;

  it('supports Ctrl, Alt, Shift and Meta (Cmd) in any combination', () => {
    expect(eventMatches(k('KeyK', 'k', { ctrlKey: true, shiftKey: true }), parseCombo('Ctrl+Shift+K')!)).toBe(true);
    expect(eventMatches(k('KeyK', 'k', { altKey: true }), parseCombo('Option+K')!)).toBe(true);
    expect(eventMatches(k('KeyK', 'k', { metaKey: true }), parseCombo('Cmd+K')!)).toBe(true);
    expect(
      eventMatches(
        k('KeyK', 'k', { metaKey: true, altKey: true, ctrlKey: true, shiftKey: true }),
        parseCombo('Ctrl+Alt+Shift+Cmd+K')!,
      ),
    ).toBe(true);
    // Ctrl не заменяет Cmd
    expect(eventMatches(k('KeyK', 'k', { ctrlKey: true }), parseCombo('Cmd+K')!)).toBe(false);
  });

  it('Mod resolves to Cmd on macOS and Ctrl elsewhere', () => {
    expect(formatCombo(parseCombo('Mod+K', true)!)).toBe('meta+k');
    expect(formatCombo(parseCombo('Mod+K', false)!)).toBe('ctrl+k');
  });

  it('Mod+K and Ctrl+K conflict on Windows/Linux but not on macOS', () => {
    const e = (keys: string, id: string) => ({
      pluginId: 'p' + id,
      contribution: { id, keys, scope: 'global' as const, handler: 'h' },
    });
    expect(analyzeHotkeys([e('Mod+K', '1'), e('Ctrl+K', '2')], false).conflicts).toHaveLength(1);
    expect(analyzeHotkeys([e('Mod+K', '1'), e('Ctrl+K', '2')], true).conflicts).toHaveLength(0);
  });
});
