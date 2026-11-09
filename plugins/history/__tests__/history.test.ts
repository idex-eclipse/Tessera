import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MoonrakerProxyHandle, PluginApi } from '../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { configManifest } from '../../config/manifest';
import { jobsManifest } from '../../jobs/manifest';
import { getRefreshTick, getSearchFocusTick } from '../../shared/file-table/file-table-state.svelte';
import { formatDuration, formatFilament } from '../lib/format';
import {
  analyzeHistory,
  comparePrintEstimate,
  materialShares,
  reprintBlockReason,
  startHistoryReprint,
} from '../lib/history-analysis';
import { loadHistoryNote, saveHistoryNote } from '../lib/history-notes';
import { guardHistoryOwnerOnly } from '../guards';
import * as hotkeys from '../hotkeys';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { historyManifest } from '../manifest';
import { historyUi, moveHistoryTab } from '../state/page-ui-state.svelte';
import { normalizeHistoryJob, type HistoryJobEntry } from '../../shared/file-table/use-history-files.svelte';

afterEach(() => {
  historyUi.resetDialogOpen = false;
  historyUi.jobDialogOpen = false;
  historyUi.refreshSeq = 0;
  historyUi.showHistorySeq = 0;
  historyUi.resetRequestSeq = 0;
  historyUi.activeTab = 'history';
  historyUi.tabOrder = ['history', 'stats'];
});

function job(overrides: Record<string, unknown> = {}): HistoryJobEntry {
  const normalized = normalizeHistoryJob({
    job_id: '000001',
    filename: 'part.gcode',
    exists: true,
    status: 'completed',
    start_time: 100,
    end_time: 200,
    print_duration: 90,
    total_duration: 100,
    filament_used: 1000,
    metadata: { filament_type: 'PLA', estimated_time: 80 },
    auxiliary_data: [],
    ...overrides,
  });
  if (!normalized) throw new Error('test job did not normalize');
  return normalized;
}

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

describe('history job normalization and analysis', () => {
  it('normalizes documented Moonraker fields and tolerates a missing filename', () => {
    const entry = job({
      user: 'maker',
      metadata: { slicer: 'OrcaSlicer', filament_type: ['PLA', 'PETG'], estimated_time: 80 },
      auxiliary_data: [{ provider: 'sensor', name: 'power', value: 12 }],
    });
    expect(entry).toMatchObject({
      jobId: '000001',
      filename: 'part.gcode',
      exists: true,
      status: 'completed',
      user: 'maker',
      startTime: 100,
      printDuration: 90,
      filamentUsed: 1000,
    });
    expect(entry.metadata.slicer).toBe('OrcaSlicer');
    expect(entry.auxiliaryData).toHaveLength(1);
    expect(normalizeHistoryJob({ job_id: 'x' })).toBeNull();
  });

  it('distributes actual filament by per-tool slicer proportions', () => {
    const entry = job({
      filament_used: 900,
      metadata: { filament_type: ['PLA', 'PETG'], filament_total: [100, 200] },
    });
    expect(materialShares(entry)).toEqual([
      { type: 'PLA', filament: 300, complete: true },
      { type: 'PETG', filament: 600, complete: true },
    ]);
  });

  it('marks ambiguous multi-material lengths as partial without duplicating usage', () => {
    const shares = materialShares(job({
      metadata: { filament_type: ['PLA', 'PETG'] },
      filament_used: 900,
    }));
    expect(shares).toEqual([
      { type: 'PLA', filament: 0, complete: false },
      { type: 'PETG', filament: 0, complete: false },
    ]);
  });

  it('counts cancelled and faulted terminal jobs as failures while excluding active jobs', () => {
    const result = analyzeHistory([
      job(),
      job({ job_id: '2', status: 'cancelled', metadata: { filament_type: 'PLA' } }),
      job({ job_id: '3', status: 'klippy_shutdown', metadata: { filament_type: 'PETG' } }),
      job({ job_id: '4', status: 'in_progress', metadata: { filament_type: 'ABS' } }),
      job({ job_id: '5', status: 'error', metadata: {} }),
    ]);
    expect(result).toMatchObject({ terminalJobs: 4, failedJobs: 3, failureRate: 0.75 });
    expect(result.materials.map((row) => [row.type, row.jobs, row.failed])).toEqual([
      ['PLA', 2, 1],
      ['PETG', 1, 1],
      [null, 1, 1],
    ]);
  });

  it('compares actual print time with the slicer estimate and rejects missing values', () => {
    expect(comparePrintEstimate(80, 100)).toEqual({ estimate: 80, actual: 100, delta: 20, percent: 0.25 });
    expect(comparePrintEstimate(100, 80)).toEqual({ estimate: 100, actual: 80, delta: -20, percent: -0.2 });
    expect(comparePrintEstimate(undefined, 80)).toBeNull();
    expect(comparePrintEstimate(80, 0)).toBeNull();
    expect(comparePrintEstimate(Number.NaN, 80)).toBeNull();
  });

  it('blocks reprint for changed files, unavailable Klipper, and an active print', () => {
    expect(reprintBlockReason(job({ exists: false }), true, false)).toBe('file');
    expect(reprintBlockReason(job(), false, false)).toBe('klippy');
    expect(reprintBlockReason(job(), true, true)).toBe('printing');
    expect(reprintBlockReason(job(), true, false)).toBeNull();
  });

  it('starts the exact filename stored in history through the guarded request path', async () => {
    const request = vi.fn(async () => 'ok');
    await startHistoryReprint({ request } as unknown as MoonrakerProxyHandle, job({ filename: 'dir/part.gcode' }));
    expect(request).toHaveBeenCalledWith('printer.print.start', { filename: 'dir/part.gcode' });
  });

  it('preserves a guard rejection when reprint is denied', async () => {
    const rejection = Object.assign(new Error('denied'), { rejection: { reasonKey: 'guard.denied' } });
    const request = vi.fn(async () => { throw rejection; });
    await expect(startHistoryReprint(
      { request } as unknown as MoonrakerProxyHandle,
      job(),
    )).rejects.toBe(rejection);
  });
});

describe('history notes', () => {
  it('loads only a note matching the job start time', async () => {
    const request = vi.fn(async () => ({ value: { v: 1, startTime: 100, text: 'good', updatedAt: 1 } }));
    const moonraker = { request } as unknown as MoonrakerProxyHandle;
    await expect(loadHistoryNote(moonraker, '000001', 100)).resolves.toEqual({ text: 'good', exists: true });
    await expect(loadHistoryNote(moonraker, '000001', 101)).resolves.toEqual({ text: '', exists: false });
    expect(request).toHaveBeenCalledWith('server.database.get_item', {
      namespace: 'tessera_history',
      key: ['notes', '000001'],
    });
  });

  it('writes a trimmed note and deletes an existing note when cleared', async () => {
    const request = vi.fn(async () => ({}));
    const moonraker = { request } as unknown as MoonrakerProxyHandle;
    await expect(saveHistoryNote(moonraker, '000001', 100, '  useful  ', false)).resolves.toEqual({
      text: 'useful',
      exists: true,
    });
    expect(request).toHaveBeenNthCalledWith(1, 'server.database.post_item', expect.objectContaining({
      namespace: 'tessera_history',
      key: ['notes', '000001'],
      value: expect.objectContaining({ v: 1, startTime: 100, text: 'useful' }),
    }));

    await expect(saveHistoryNote(moonraker, '000001', 100, '  ', true)).resolves.toEqual({
      text: '',
      exists: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, 'server.database.delete_item', {
      namespace: 'tessera_history',
      key: ['notes', '000001'],
    });
  });

  it('treats a missing database key as an empty note and preserves other errors', async () => {
    const missing = { request: vi.fn(async () => { throw new Error('Key does not exist'); }) } as unknown as MoonrakerProxyHandle;
    await expect(loadHistoryNote(missing, '000001', 100)).resolves.toEqual({ text: '', exists: false });

    const offline = { request: vi.fn(async () => { throw new Error('offline'); }) } as unknown as MoonrakerProxyHandle;
    await expect(loadHistoryNote(offline, '000001', 100)).rejects.toThrow('offline');
  });

  it('preserves note write errors for the dialog to display', async () => {
    const offline = { request: vi.fn(async () => { throw new Error('offline'); }) } as unknown as MoonrakerProxyHandle;
    await expect(saveHistoryNote(offline, '000001', 100, 'note', false)).rejects.toThrow('offline');
  });
});

describe('guard history-owner-only', () => {
  it('denies erasing history or totals for other plugins', () => {
    for (const method of ['server.history.delete_job', 'server.history.reset_totals']) {
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
    expect(historyUi.showHistorySeq).toBe(1);
  });

  it('Alt+R refreshes the table and asks the statistics panel to reload', () => {
    const tick = getRefreshTick(api, 'page:history');
    hotkeys.hotkeyRefreshHistory(api);
    expect(getRefreshTick(api, 'page:history')).toBe(tick + 1);
    expect(historyUi.refreshSeq).toBe(1);
  });

  it('Alt+1 and Alt+2 select the built-in tabs', () => {
    hotkeys.hotkeyTabStatistics();
    expect(historyUi.activeTab).toBe('stats');
    hotkeys.hotkeyTabHistory();
    expect(historyUi.activeTab).toBe('history');
  });

  it('moves through built-in and contributed tabs in visual LTR and RTL order', () => {
    historyUi.tabOrder = ['history', 'stats', 'extension/details'];
    historyUi.activeTab = 'stats';

    moveHistoryTab('left', false);
    expect(historyUi.activeTab).toBe('history');
    moveHistoryTab('left', false);
    expect(historyUi.activeTab).toBe('extension/details');

    historyUi.activeTab = 'stats';
    moveHistoryTab('left', true);
    expect(historyUi.activeTab).toBe('extension/details');
    moveHistoryTab('right', true);
    expect(historyUi.activeTab).toBe('stats');
  });

  it('declares plugin-scoped digit and arrow tab shortcuts with exported handlers', () => {
    const tabs = (historyManifest.hotkeys ?? []).filter((entry) => entry.id.startsWith('tab-'));
    expect(tabs.map((entry) => [entry.keys, entry.scope, entry.handler])).toEqual([
      ['Alt+1', 'plugin', 'hotkeyTabHistory'],
      ['Alt+2', 'plugin', 'hotkeyTabStatistics'],
      ['Alt+ArrowLeft', 'plugin', 'hotkeyTabLeft'],
      ['Alt+ArrowRight', 'plugin', 'hotkeyTabRight'],
    ]);
    for (const entry of tabs) {
      expect(typeof (hotkeys as Record<string, unknown>)[entry.handler], entry.handler).toBe('function');
    }
  });

  it('stay silent while the reset dialog is open', () => {
    historyUi.resetDialogOpen = true;
    const focus = getSearchFocusTick(api, 'page:history');
    const tick = getRefreshTick(api, 'page:history');

    hotkeys.hotkeyFindHistory(api);
    hotkeys.hotkeyRefreshHistory(api);
    hotkeys.hotkeyTabStatistics();

    expect(getSearchFocusTick(api, 'page:history')).toBe(focus);
    expect(getRefreshTick(api, 'page:history')).toBe(tick);
    expect(historyUi.refreshSeq).toBe(0);
    expect(historyUi.activeTab).toBe('history');
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
    expect(matched).toHaveLength(2);
    expect(matched).not.toContain('server.history.delete_all');
  });

  it('publishes the additive History feature version without changing extension point versions', () => {
    expect(historyManifest.version).toBe('4.2.0');
    expect(historyManifest.extensionPoints?.every((point) => point.version === 1)).toBe(true);
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
      'history.title', 'history.tabsLabel', 'history.unit.h', 'history.unit.m', 'history.unit.s', 'history.unit.meter', 'history.unit.km',
      'history.guard.owner_only', 'history.hotkeys.open', 'history.hotkeys.find', 'history.hotkeys.refresh',
      'history.hotkeys.tabHistory', 'history.hotkeys.tabStatistics', 'history.hotkeys.tabLeft', 'history.hotkeys.tabRight',
      'history.detail.title', 'history.detail.loadFailed', 'history.detail.timeComparison',
      'history.detail.note', 'history.detail.saveNote', 'history.detail.reprint',
      'history.detail.reprintFileChanged', 'history.detail.reprintPrinting',
      'stats.combinedTitle', 'stats.title', 'stats.reset', 'stats.resetFailed', 'stats.statsError', 'stats.totalJobs', 'stats.longestPrint',
      'stats.totalTime', 'stats.avgTime', 'stats.totalPrintTime', 'stats.avgPrintTime', 'stats.totalFilament',
      'stats.avgFilament', 'stats.failedJobs', 'stats.failureRate', 'stats.materialsTitle', 'stats.unknownMaterial',
      'stats.confirmReset', 'stats.resetConfirmBody', 'stats.confirm',
      'ft.loading', 'ft.error', 'ft.retry', 'ft.empty', 'ft.search', 'ft.refresh', 'ft.columns', 'ft.openDetails',
      'ft.status.completed', 'ft.status.cancelled', 'ft.status.error', 'ft.status.in_progress',
    ];
    for (const k of used) expect(keys[k], k).toBeTypeOf('string');
  });
});
