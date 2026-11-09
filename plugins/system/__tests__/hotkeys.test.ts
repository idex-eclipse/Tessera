import { afterEach, describe, expect, it } from 'vitest';

import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import * as hotkeys from '../hotkeys';
import { systemManifest } from '../manifest';
import { moveSystemTab, systemUiState } from '../state/system-ui-state.svelte';

afterEach(() => {
  systemUiState.activeTab = 'overview';
  systemUiState.tabOrder = ['overview', 'monitoring', 'maintenance'];
});

describe('system hotkeys', () => {
  it('does not declare N: the notification center belongs to the host, which owns its hotkey', () => {
    expect((systemManifest.hotkeys ?? []).map((h) => h.keys as string)).not.toContain('N');
    expect((hotkeys as Record<string, unknown>).hotkeyToggleNotifications).toBeUndefined();
  });

  it('declared hotkeys do not conflict with the host keys', () => {
    const host = createHostHotkeys({ ...fakeHostHotkeyDeps(), notifications: { toggle: () => {} } }).map((h) => ({
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

  it('moves through built-in and contributed tabs in visual LTR and RTL order', () => {
    systemUiState.tabOrder = ['overview', 'monitoring', 'maintenance', 'extension/details'];
    systemUiState.activeTab = 'monitoring';

    moveSystemTab('left', false);
    expect(systemUiState.activeTab).toBe('overview');
    moveSystemTab('left', false);
    expect(systemUiState.activeTab).toBe('extension/details');

    systemUiState.activeTab = 'monitoring';
    moveSystemTab('left', true);
    expect(systemUiState.activeTab).toBe('maintenance');
    moveSystemTab('right', true);
    expect(systemUiState.activeTab).toBe('monitoring');
  });

  it('declares plugin-scoped digit and arrow tab hotkeys with exported handlers', () => {
    const tabs = (systemManifest.hotkeys ?? []).filter((h) => h.id.startsWith('tab-'));
    expect(tabs.map((h) => [h.keys, h.scope, h.handler])).toEqual([
      ['Alt+1', 'plugin', 'hotkeyTabOverview'],
      ['Alt+2', 'plugin', 'hotkeyTabMonitoring'],
      ['Alt+3', 'plugin', 'hotkeyTabMaintenance'],
      ['Alt+ArrowLeft', 'plugin', 'hotkeyTabLeft'],
      ['Alt+ArrowRight', 'plugin', 'hotkeyTabRight'],
    ]);
    for (const h of tabs) {
      expect(typeof (hotkeys as Record<string, unknown>)[h.handler], h.handler).toBe('function');
    }
  });
});
