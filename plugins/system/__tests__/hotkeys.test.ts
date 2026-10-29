import { afterEach, describe, expect, it } from 'vitest';

import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import * as hotkeys from '../hotkeys';
import { systemManifest } from '../manifest';
import { systemUiState } from '../system-ui-state.svelte';

afterEach(() => {
  systemUiState.notificationsOpen = false;
  systemUiState.activeTab = 'overview';
});

describe('system hotkeys', () => {
  it('N toggles the notification center', () => {
    expect(systemUiState.notificationsOpen).toBe(false);
    hotkeys.hotkeyToggleNotifications();
    expect(systemUiState.notificationsOpen).toBe(true);
    hotkeys.hotkeyToggleNotifications();
    expect(systemUiState.notificationsOpen).toBe(false);
  });

  it('is declared as a global hotkey on N with an exported handler, and does not conflict with the host keys', () => {
    const declared = (systemManifest.hotkeys ?? []).filter((h) => h.id === 'toggle-notifications');
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatchObject({ scope: 'global', keys: 'N', handler: 'hotkeyToggleNotifications' });
    expect(typeof (hotkeys as Record<string, unknown>)[declared[0]!.handler]).toBe('function');

    const host = createHostHotkeys(fakeHostHotkeyDeps()).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));
    const mine = (systemManifest.hotkeys ?? []).map((contribution) => ({
      pluginId: systemManifest.id,
      contribution: { ...contribution },
    }));

    const analysis = analyzeHotkeys([...host, ...mine]);
    expect(analysis.invalid).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
  });

  it('Alt+1/2/3 switch the page tabs', () => {
    hotkeys.hotkeyTabMonitoring();
    expect(systemUiState.activeTab).toBe('monitoring');
    hotkeys.hotkeyTabMaintenance();
    expect(systemUiState.activeTab).toBe('maintenance');
    hotkeys.hotkeyTabOverview();
    expect(systemUiState.activeTab).toBe('overview');
  });

  it('declares the tab hotkeys as plugin-scoped Alt+digits with exported handlers', () => {
    const tabs = (systemManifest.hotkeys ?? []).filter((h) => h.id.startsWith('tab-'));
    expect(tabs.map((h) => [h.keys, h.scope, h.handler])).toEqual([
      ['Alt+1', 'plugin', 'hotkeyTabOverview'],
      ['Alt+2', 'plugin', 'hotkeyTabMonitoring'],
      ['Alt+3', 'plugin', 'hotkeyTabMaintenance'],
    ]);
    for (const h of tabs) {
      expect(typeof (hotkeys as Record<string, unknown>)[h.handler], h.handler).toBe('function');
    }
  });
});
