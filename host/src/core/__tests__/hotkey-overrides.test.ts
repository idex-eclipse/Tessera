import { describe, expect, it, vi } from 'vitest';

import type { PluginApi, PluginManifest } from '../../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../host-hotkeys';
import { createHotkeyManager } from '../hotkey-manager.svelte.ts';
import { comboFromEvent, displayCombo, formatCombo, parseCombo } from '../hotkeys';
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

const plugin = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: 'x',
  name: 'X',
  version: '1',
  entry: 'i.js',
  hotkeys: [{ id: 'fn', scope: 'global', keys: 'Alt+X', handler: 'fn', titleKey: 'x.title' }],
  ...over,
});

function setup(manifests: PluginManifest[] = [plugin()], fn = vi.fn()) {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const registry = createPluginRegistry(settings);
  for (const m of manifests) registry.registerPlugin(m);

  const ui = { toggleFleet: vi.fn(), setFleet: vi.fn() };
  const manager = createHotkeyManager({
    registry,
    getRoute: () => ({ kind: 'dashboard', printerId: 'a', query: {} }),
    getModule: () => ({ fn }),
    getApi: (id) => ({ pluginId: id }) as unknown as PluginApi,
    appliesToActivePrinter: () => true,
    getOverrides: () => settings.ui.hotkeyOverrides,
    hostHotkeys: createHostHotkeys({
      router: { navigateToPrinter: vi.fn() },
      printerManager: { printers: [], activePrinterId: null } as never,
      ui,
    }),
    warn: vi.fn(),
  });
  return { settings, manager, ui, fn, storage };
}

const item = (m: ReturnType<typeof setup>['manager'], key: string) =>
  m.items.find((i) => i.key === key)!;

describe('hotkey overrides', () => {
  it('items list host and plugin hotkeys with defaults', () => {
    const { manager } = setup();
    const fleet = item(manager, '@host:toggle-fleet');
    expect(fleet).toMatchObject({ keys: 'F', customized: false, userDisabled: false, enabled: true });
    expect(item(manager, 'x:fn')).toMatchObject({ keys: 'Alt+X', scope: 'global', enabled: true });
  });

  it('an override rebinds the key: new combo fires, the old one does not', () => {
    const { settings, manager, fn } = setup();
    settings.setHotkeyOverride('x:fn', 'ctrl+shift+k');

    expect(manager.handleKeydown(ev({ code: 'KeyX', key: 'x', altKey: true }))).toBe(false);
    expect(
      manager.handleKeydown(ev({ code: 'KeyK', key: 'k', ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(item(manager, 'x:fn')).toMatchObject({ customized: true, defaultKeys: 'Alt+X' });
  });

  it('null disables a hotkey (host ones too); clearing restores the default', () => {
    const { settings, manager, ui } = setup();
    settings.setHotkeyOverride('@host:toggle-fleet', null);
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(false);
    expect(item(manager, '@host:toggle-fleet')).toMatchObject({ userDisabled: true, enabled: false, keys: null });

    settings.clearHotkeyOverride('@host:toggle-fleet');
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(true);
    expect(ui.toggleFleet).toHaveBeenCalledTimes(1);
  });

  it('a user override into a conflict disables both sides and reports who conflicts', () => {
    const { settings, manager, fn } = setup();
    settings.setHotkeyOverride('x:fn', 'f'); // совпало с хостовым F

    expect(manager.conflicts).toHaveLength(1);
    expect(item(manager, 'x:fn')).toMatchObject({ enabled: false, conflictsWith: ['@host/toggle-fleet'] });
    expect(item(manager, '@host:toggle-fleet')).toMatchObject({ enabled: false, conflictsWith: ['x/fn'] });
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(false);
    expect(fn).not.toHaveBeenCalled();

    settings.resetHotkeyOverrides();
    expect(manager.conflicts).toEqual([]);
  });

  it('freeing a user-disabled hotkey frees the combo for another one', () => {
    const { settings, manager, fn } = setup();
    settings.setHotkeyOverride('x:fn', 'f');
    settings.setHotkeyOverride('@host:toggle-fleet', null); // хост уступил F
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('an invalid stored override is ignored (default stays)', () => {
    const { settings, manager } = setup();
    settings.setHotkeyOverride('x:fn', 'Ctrl+Shift');
    expect(item(manager, 'x:fn')).toMatchObject({ keys: 'Alt+X', customized: false, enabled: true });
  });

  it('suspend() stops dispatch until resumed', () => {
    const { manager } = setup();
    const resume = manager.suspend();
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(false);
    resume();
    expect(manager.handleKeydown(ev({ code: 'KeyF', key: 'f' }))).toBe(true);
  });

  it('overrides persist in storage and survive reload', () => {
    const { settings, storage } = setup();
    settings.setHotkeyOverride('x:fn', 'alt+z');
    settings.setHotkeyOverride('@host:toggle-fleet', null);

    const reloaded = createSettingsStore({ storage });
    expect(reloaded.ui.hotkeyOverrides).toEqual({ 'x:fn': 'alt+z', '@host:toggle-fleet': null });
  });
});

describe('recording a combination', () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

  it('builds a combo from an event, round-trips through parseCombo, layout independent', () => {
    const combo = comboFromEvent({ ...base, ctrlKey: true, shiftKey: true, code: 'KeyK', key: 'Л' })!;
    expect(formatCombo(combo)).toBe('ctrl+shift+k');
    expect(parseCombo(formatCombo(combo))).toEqual(combo);

    const arrow = comboFromEvent({ ...base, ctrlKey: true, code: 'ArrowRight', key: 'ArrowRight' })!;
    expect(parseCombo(formatCombo(arrow))).toEqual(arrow);
  });

  it('ignores pure modifier presses', () => {
    expect(comboFromEvent({ ...base, ctrlKey: true, code: 'ControlLeft', key: 'Control' })).toBeNull();
    expect(comboFromEvent({ ...base, metaKey: true, code: 'MetaLeft', key: 'Meta' })).toBeNull();
  });

  it('displays combos for humans, platform-aware', () => {
    const combo = parseCombo('ctrl+alt+meta+arrowright')!;
    expect(displayCombo(combo, false)).toBe('Ctrl+Alt+Win+→');
    expect(displayCombo(combo, true)).toBe('Ctrl+Option+Cmd+→');
    expect(displayCombo(parseCombo('shift+/')!, false)).toBe('Shift+/');
  });
});
