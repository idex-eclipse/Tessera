import { describe, expect, it } from 'vitest';

import type { HotkeyContribution } from '../../../../plugin-sdk/src/types';
import {
  analyzeHotkeys,
  eventMatches,
  formatCombo,
  hotkeysConflict,
  parseCombo,
  type HotkeyEntry,
} from '../hotkeys';

function key(over: Partial<KeyboardEvent> & { code: string; key: string }) {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over };
}

function entry(
  pluginId: string,
  id: string,
  scope: HotkeyContribution['scope'],
  keys: string,
): HotkeyEntry {
  return { pluginId, contribution: { id, keys, scope, handler: 'h' } };
}

describe('parseCombo / formatCombo', () => {
  it('normalizes aliases, case and modifier order', () => {
    expect(formatCombo(parseCombo('Shift+Control+K')!)).toBe('ctrl+shift+k');
    expect(formatCombo(parseCombo('cmd+Esc')!)).toBe('meta+escape');
    expect(formatCombo(parseCombo('Alt+Up')!)).toBe('alt+arrowup');
    expect(formatCombo(parseCombo('Ctrl++')!)).toBe('ctrl++');
    expect(formatCombo(parseCombo('Shift+/')!)).toBe('shift+/');
  });

  it('rejects malformed specs', () => {
    for (const bad of ['', '  ', 'Ctrl', 'Ctrl+Shift', 'Ctrl+K+L', 'Ctrl+Ctrl+K', 'Ctrl++K', '+K', 7, null]) {
      expect(parseCombo(bad)).toBeNull();
    }
  });
});

describe('eventMatches', () => {
  it('matches letters by physical key, independent of layout', () => {
    const combo = parseCombo('Ctrl+K')!;
    // кириллическая раскладка: key='л', code='KeyK'
    expect(eventMatches(key({ code: 'KeyK', key: 'л', ctrlKey: true }), combo)).toBe(true);
    expect(eventMatches(key({ code: 'KeyJ', key: 'j', ctrlKey: true }), combo)).toBe(false);
  });

  it('requires exact modifiers', () => {
    const combo = parseCombo('Ctrl+K')!;
    expect(eventMatches(key({ code: 'KeyK', key: 'k' }), combo)).toBe(false);
    expect(eventMatches(key({ code: 'KeyK', key: 'K', ctrlKey: true, shiftKey: true }), combo)).toBe(false);
  });

  it('matches digits, punctuation and named keys', () => {
    expect(eventMatches(key({ code: 'Digit1', key: '!', altKey: true }), parseCombo('Alt+1')!)).toBe(true);
    expect(eventMatches(key({ code: 'Digit1', key: '1', altKey: true }), parseCombo('Alt+1')!)).toBe(true);
    expect(eventMatches(key({ code: 'Slash', key: '?', shiftKey: true }), parseCombo('Shift+/')!)).toBe(true);
    expect(eventMatches(key({ code: 'F5', key: 'F5' }), parseCombo('F5')!)).toBe(true);
    expect(eventMatches(key({ code: 'Escape', key: 'Escape' }), parseCombo('Esc')!)).toBe(true);
  });

  it('ignores pure modifier presses', () => {
    expect(eventMatches(key({ code: 'ControlLeft', key: 'Control', ctrlKey: true }), parseCombo('Ctrl+K')!)).toBe(false);
  });
});

describe('hotkeysConflict', () => {
  const g = { pluginId: 'a', scope: 'global' as const };
  const d = (pluginId: string) => ({ pluginId, scope: 'dashboard' as const });
  const p = (pluginId: string) => ({ pluginId, scope: 'plugin' as const });

  it('global conflicts with everything', () => {
    expect(hotkeysConflict(g, g)).toBe(true);
    expect(hotkeysConflict(g, d('b'))).toBe(true);
    expect(hotkeysConflict(p('b'), g)).toBe(true);
  });

  it('dashboard vs dashboard conflicts, dashboard vs plugin does not', () => {
    expect(hotkeysConflict(d('a'), d('b'))).toBe(true);
    expect(hotkeysConflict(d('a'), p('a'))).toBe(false);
    expect(hotkeysConflict(p('b'), d('a'))).toBe(false);
  });

  it('plugin vs plugin conflicts only within one plugin', () => {
    expect(hotkeysConflict(p('a'), p('b'))).toBe(false);
    expect(hotkeysConflict(p('a'), p('a'))).toBe(true);
  });
});

describe('analyzeHotkeys', () => {
  const enabledIds = (entries: HotkeyEntry[]) =>
    analyzeHotkeys(entries).bindings.filter((b) => b.enabled).map((b) => `${b.pluginId}/${b.contribution.id}`);

  it('keeps non-overlapping hotkeys enabled', () => {
    const a = analyzeHotkeys([entry('a', '1', 'global', 'Ctrl+K'), entry('b', '2', 'dashboard', 'Ctrl+L')]);
    expect(a.conflicts).toEqual([]);
    expect(a.bindings.every((b) => b.enabled)).toBe(true);
  });

  it('disables BOTH sides of a conflict and reports it', () => {
    const a = analyzeHotkeys([entry('a', '1', 'global', 'ctrl+k'), entry('b', '2', 'plugin', 'Control+K')]);
    expect(a.bindings.map((b) => b.enabled)).toEqual([false, false]);
    expect(a.conflicts).toHaveLength(1);
    expect(a.conflicts[0]!.members.map((m) => m.pluginId).sort()).toEqual(['a', 'b']);
  });

  it('allows dashboard + plugin and plugin + plugin across plugins', () => {
    expect(
      enabledIds([
        entry('a', 'd', 'dashboard', 'Alt+1'),
        entry('a', 'p', 'plugin', 'Alt+1'),
        entry('b', 'p', 'plugin', 'Alt+1'),
      ]),
    ).toEqual(['a/d', 'a/p', 'b/p']);
  });

  it('disables dashboard duplicates and same-plugin duplicates', () => {
    expect(enabledIds([entry('a', '1', 'dashboard', 'F2'), entry('b', '2', 'dashboard', 'F2')])).toEqual([]);
    expect(enabledIds([entry('a', '1', 'plugin', 'F2'), entry('a', '2', 'plugin', 'F2')])).toEqual([]);
  });

  it('disables a member that conflicts with only one of several', () => {
    // global + plugin(b) + plugin(c): global конфликтует со всеми; b и c между собой допустимы,
    // но отключены, потому что конфликтуют с global.
    expect(
      enabledIds([
        entry('a', 'g', 'global', 'F3'),
        entry('b', 'p', 'plugin', 'F3'),
        entry('c', 'p', 'plugin', 'F3'),
      ]),
    ).toEqual([]);
  });

  it('reports invalid key specs without enabling them', () => {
    const a = analyzeHotkeys([entry('a', 'x', 'global', 'Ctrl')]);
    expect(a.invalid).toHaveLength(1);
    expect(a.bindings).toEqual([]);
  });
});
