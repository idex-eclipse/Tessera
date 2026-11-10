import { flushSync, mount, unmount, type Component } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { MoonrakerProxyHandle, PluginApi } from '../../../plugin-sdk/src/types';
import WithApi from '../../shared/file-table/__tests__/helpers/WithApi.svelte';
import HistoryPage from '../components/page/HistoryPage.svelte';
import { historyUi } from '../state/page-ui-state.svelte.ts';

// The fake supplies one completed job so both halves of the statistics tab render meaningful content.
function fakeApi(): PluginApi {
  const request = vi.fn(async (method: string) => {
    if (method === 'server.history.list') {
      return {
        jobs: [{
          job_id: '000001',
          filename: 'part.gcode',
          exists: true,
          status: 'completed',
          start_time: 100,
          end_time: 200,
          print_duration: 90,
          total_duration: 100,
          filament_used: 1000,
          metadata: { filament_type: 'PLA' },
          auxiliary_data: [],
        }],
      };
    }
    if (method === 'server.history.totals') {
      return { job_totals: { total_jobs: 1, total_time: 100, total_print_time: 90 } };
    }
    return {};
  });
  const handle = {
    request,
    readyState: 'open',
    httpBaseUrl: 'http://printer',
    authToken: null,
    subscribe: () => () => {},
    onNotify: () => () => {},
    onConnectionStatusChange: () => () => {},
    onReady: () => () => {},
    poll: () => () => {},
  } as unknown as MoonrakerProxyHandle;

  return {
    printer: { id: 'p-history-stats', name: 'Printer', url: 'http://printer' },
    printers: [{ id: 'p-history-stats', name: 'Printer', url: 'http://printer' }],
    moonraker: () => handle,
    moonrakerFor: () => handle,
    onPrinterChange: () => () => {},
    onPrintersChange: () => () => {},
    settings: { get: () => undefined, set: () => {}, onChange: () => () => {} },
    settingsFor: () => ({ get: () => undefined, set: () => {}, onChange: () => () => {} }),
    i18n: { t: (key: string) => key },
    theme: { current: 'dark' },
    onThemeChange: () => () => {},
    onLocaleChange: () => () => {},
    extensions: {
      list: () => [],
      resolve: () => ({ mode: 'replacement', original: true, active: [], options: [], conflict: false }),
      onChange: () => () => {},
      invoke: async () => undefined,
    },
  } as unknown as PluginApi;
}

// Two microtasks allow the initial History request to settle before assertions.
async function renderPage() {
  historyUi.showHistorySeq = 0;
  historyUi.resetRequestSeq = 0;
  historyUi.resetDialogOpen = false;
  historyUi.activeTab = 'history';
  historyUi.tabOrder = ['history', 'stats'];
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(WithApi, {
    target,
    props: {
      api: fakeApi(),
      component: HistoryPage as unknown as Component<Record<string, unknown>>,
      props: {},
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
  return { target, stop: () => { unmount(component); target.remove(); } };
}

describe('History page tabs', () => {
  it('starts with History and shows both independently scrollable statistics halves', async () => {
    const view = await renderPage();
    try {
      const historyTab = view.target.querySelector<HTMLButtonElement>('[data-tab="history"]');
      const statsTab = view.target.querySelector<HTMLButtonElement>('[data-tab="stats"]');
      expect(historyTab?.getAttribute('aria-selected')).toBe('true');
      expect(view.target.querySelector('.history-view .ft-card.embedded')).not.toBeNull();
      expect(view.target.querySelector('.history-view .page-header')).toBeNull();
      expect(view.target.querySelector('.history-tabs-card .tabrow .ha-search')).not.toBeNull();

      statsTab?.click();
      flushSync();

      expect(statsTab?.getAttribute('aria-selected')).toBe('true');
      expect(view.target.querySelector('.stats-combined .printer-pane .printer-scroll')).not.toBeNull();
      expect(view.target.querySelector('.stats-combined .materials .materials-scroll')).not.toBeNull();
      expect(view.target.querySelector('.history-tabs-card .tabrow .ha-search')).toBeNull();
      const reset = view.target.querySelector<HTMLButtonElement>('[aria-label="stats.reset"]');
      expect(reset).not.toBeNull();
      reset?.click();
      flushSync();
      expect(view.target.querySelector('[role="alertdialog"]')).not.toBeNull();
      view.target.querySelector<HTMLButtonElement>('[role="alertdialog"] .btn-secondary')?.click();
      flushSync();
      expect(view.target.querySelectorAll('.history-tabs-card')).toHaveLength(1);

      historyUi.showHistorySeq++;
      await Promise.resolve();
      flushSync();
      expect(historyTab?.getAttribute('aria-selected')).toBe('true');
    } finally {
      view.stop();
    }
  });
});
