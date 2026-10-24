import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { configManifest } from '../../config/manifest';
import { jobsManifest } from '../../jobs/manifest';
import { getRefreshTick, getSearchFocusTick } from '../../shared/file-table/file-table-state.svelte';
import { formatDuration, formatFilament } from '../format';
import { guardHistoryOwnerOnly } from '../guards';
import * as hotkeys from '../hotkeys';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { historyManifest } from '../manifest';
import { historyUi } from '../page-ui-state.svelte';

afterEach(() => {
  historyUi.dialogOpen = false;
  historyUi.refreshSeq = 0;
});

describe('formatDuration / formatFilament', () => {
  it('formats with the default Latin units', () => {
    expect(formatDuration(3725)).toBe('1h 2m 5s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(9)).toBe('9s');
    expect(formatFilament(2_500)).toBe('2.50 m');
    expect(formatFilament(2_500_000)).toBe('2.50 km');
  });

  it('uses localized units when given', () => {
    expect(formatDuration(3725, { h: 'ч', m: 'м', s: 'с' })).toBe('1ч 2м 5с');
    expect(formatFilament(2_500_000, { m: 'м', km: 'км' })).toBe('2.50 км');
  });

  it('shows a dash for missing / non-positive / non-finite values', () => {
    for (const v of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDuration(v as number)).toBe('—');
      expect(formatFilament(v as number)).toBe('—');
    }
  });
});

describe('guard history-owner-only', () => {
  it('denies erasing history or totals for other plugins', () => {
    for (const method of ['server.history.delete_job', 'server.history.delete_all', 'server.history.reset_totals']) {
      expect(guardHistoryOwnerOnly({ method, params: {} })).toEqual({
        action: 'deny',
        reasonKey: 'history.guard.owner_only',
      });
    }
  });

  it('allows reading history and unrelated methods', () => {
    for (const method of ['server.history.list', 'server.history.totals', 'server.history.get_job', 'printer.info']) {
      expect(guardHistoryOwnerOnly({ method, params: {} })).toEqual({ action: 'allow' });
    }
  });
});

describe('hotkeys', () => {
  const api = { printer: { id: 'p1' } } as unknown as PluginApi;

  it('Ctrl+F focuses the history search', () => {
    const before = getSearchFocusTick(api, 'page:history');
    hotkeys.hotkeyFindHistory(api);
    expect(getSearchFocusTick(api, 'page:history')).toBe(before + 1);
  });

  it('Alt+R refreshes the table and asks the statistics panel to reload', () => {
    const tick = getRefreshTick(api, 'page:history');
    hotkeys.hotkeyRefreshHistory(api);
    expect(getRefreshTick(api, 'page:history')).toBe(tick + 1);
    expect(historyUi.refreshSeq).toBe(1);
  });

  it('stay silent while the reset dialog is open', () => {
    historyUi.dialogOpen = true;
    const focus = getSearchFocusTick(api, 'page:history');
    const tick = getRefreshTick(api, 'page:history');

    hotkeys.hotkeyFindHistory(api);
    hotkeys.hotkeyRefreshHistory(api);

    expect(getSearchFocusTick(api, 'page:history')).toBe(focus);
    expect(getRefreshTick(api, 'page:history')).toBe(tick);
    expect(historyUi.refreshSeq).toBe(0);
  });
});

describe('manifest', () => {
  it('every guard and hotkey handler is exported by the plugin modules', () => {
    const exported = { ...hotkeys, guardHistoryOwnerOnly } as Record<string, unknown>;
    for (const g of historyManifest.guards ?? []) expect(typeof exported[g.handler]).toBe('function');
    for (const h of historyManifest.hotkeys ?? []) expect(typeof exported[h.handler]).toBe('function');
  });

  it('guard matchers equal the destructive methods the guard denies', () => {
    const matched = historyManifest.guards?.[0]?.match ?? [];
    for (const method of matched) {
      expect(guardHistoryOwnerOnly({ method, params: {} }).action).toBe('deny');
    }
    expect(matched).toHaveLength(3);
  });

  it('does not conflict with the host, config or jobs (same Ctrl+F / Alt+R on different pages)', () => {
    const asEntries = (m: typeof historyManifest) =>
      (m.hotkeys ?? []).map((contribution) => ({ pluginId: m.id, contribution: { ...contribution } }));
    const host = createHostHotkeys({
      ...fakeHostHotkeyDeps(),
    }).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));

    const analysis = analyzeHotkeys([
      ...host,
      ...asEntries(historyManifest),
      ...asEntries(configManifest),
      ...asEntries(jobsManifest),
    ]);
    expect(analysis.invalid).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
  });
});

describe('locales', () => {
  const flat = (o: Record<string, unknown>, p = '', out: Record<string, unknown> = {}) => {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === 'object') flat(v as Record<string, unknown>, key, out);
      else out[key] = v;
    }
    return out;
  };

  it('en and ru define the same keys', () => {
    expect(Object.keys(flat(ru)).sort()).toEqual(Object.keys(flat(en)).sort());
  });

  it('define every key the plugin UI uses (statistics, units, table chrome, guard, hotkeys, statuses)', () => {
    const keys = flat(en);
    const used = [
      'history.title', 'history.unit.h', 'history.unit.m', 'history.unit.s', 'history.unit.meter', 'history.unit.km',
      'history.guard.owner_only', 'history.hotkeys.find', 'history.hotkeys.refresh',
      'stats.title', 'stats.reset', 'stats.resetFailed', 'stats.statsError', 'stats.totalJobs', 'stats.longestPrint',
      'stats.totalTime', 'stats.avgTime', 'stats.totalPrintTime', 'stats.avgPrintTime', 'stats.totalFilament',
      'stats.avgFilament', 'stats.confirmReset', 'stats.resetConfirmBody', 'stats.confirm',
      'ft.loading', 'ft.error', 'ft.retry', 'ft.empty', 'ft.search', 'ft.refresh', 'ft.columns',
      'ft.status.completed', 'ft.status.cancelled', 'ft.status.error', 'ft.status.in_progress',
    ];
    for (const k of used) expect(keys[k], k).toBeTypeOf('string');
  });
});
