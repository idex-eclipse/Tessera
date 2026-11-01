import { describe, expect, it, vi } from 'vitest';

import { createHostHotkeys } from '../host-hotkeys';
import { createHotkeyManager } from '../hotkey-manager.svelte.ts';
import { createPluginRegistry } from '../plugin-registry.svelte.ts';
import { createSettingsStore } from '../settings-store.svelte.ts';
import { MemoryStorage } from '../storage';

function keydown(over: {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}): KeyboardEvent {
  return {
    ctrlKey: true,
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

function setup(active: boolean) {
  const editor = { active, undo: vi.fn(), redo: vi.fn() };
  const manager = createHotkeyManager({
    registry: createPluginRegistry(createSettingsStore({ storage: new MemoryStorage() })),
    getRoute: () => ({ kind: 'dashboard', printerId: 'a', query: {} }),
    getModule: () => undefined,
    getApi: () => ({}) as never,
    appliesToActivePrinter: () => true,
    hostHotkeys: createHostHotkeys({
      router: {} as never,
      printerManager: { printers: [], activePrinterId: null } as never,
      ui: {} as never,
      registry: { getVisiblePages: () => [] },
      getRoute: () => ({ kind: 'dashboard', printerId: 'a', query: {} }),
      editor,
    }),
    warn: vi.fn(),
  });
  return { manager, editor };
}

describe('layout editor hotkeys', () => {
  it('undo and redo work while editing and swallow the event', () => {
    const { manager, editor } = setup(true);

    const undo = keydown({ code: 'KeyZ', key: 'z' });
    expect(manager.handleKeydown(undo)).toBe(true);
    expect(undo.defaultPrevented).toBe(true);
    expect(editor.undo).toHaveBeenCalledTimes(1);

    expect(manager.handleKeydown(keydown({ code: 'KeyY', key: 'y' }))).toBe(true);
    expect(manager.handleKeydown(keydown({ code: 'KeyZ', key: 'Z', shiftKey: true }))).toBe(true);
    expect(editor.redo).toHaveBeenCalledTimes(2);
  });

  it('leaves the keys to the browser outside edit mode', () => {
    const { manager, editor } = setup(false);

    const undo = keydown({ code: 'KeyZ', key: 'z' });
    expect(manager.handleKeydown(undo)).toBe(false);
    expect(undo.defaultPrevented).toBe(false);
    expect(editor.undo).not.toHaveBeenCalled();
  });

  it('on Apple platforms both Ctrl and Cmd work', () => {
    vi.stubGlobal('navigator', { platform: 'iPhone' });
    try {
      const { manager, editor } = setup(true);

      expect(manager.handleKeydown(keydown({ code: 'KeyZ', key: 'z' }))).toBe(true);
      expect(manager.handleKeydown(keydown({ code: 'KeyZ', key: 'z', ctrlKey: false, metaKey: true }))).toBe(true);
      expect(editor.undo).toHaveBeenCalledTimes(2);

      expect(manager.handleKeydown(keydown({ code: 'KeyZ', key: 'z', ctrlKey: false, metaKey: true, shiftKey: true }))).toBe(true);
      expect(editor.redo).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not steal native undo from text inputs', () => {
    const { manager, editor } = setup(true);
    const input = { tagName: 'INPUT', isContentEditable: false };

    expect(manager.handleKeydown(keydown({ code: 'KeyZ', key: 'z', target: input }))).toBe(false);
    expect(editor.undo).not.toHaveBeenCalled();
  });
});
