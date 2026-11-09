import { flushSync, mount, unmount, type Component } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { MoonrakerProxyHandle, PluginApi } from '../../../../plugin-sdk/src/types';
import FileTable from '../FileTable.svelte';
import WithApi from './helpers/WithApi.svelte';

// The fake exposes only the host capabilities exercised by the shared table.
function fakeApi(printerId: string): PluginApi {
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
          metadata: {},
          auxiliary_data: [],
        }],
      };
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
    printer: { id: printerId, name: printerId, url: 'http://printer' },
    printers: [{ id: printerId, name: printerId, url: 'http://printer' }],
    moonraker: () => handle,
    moonrakerFor: () => handle,
    onPrinterChange: () => () => {},
    onPrintersChange: () => () => {},
    settings: { get: () => undefined, set: () => {}, onChange: () => () => {} },
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

// A unique printer id isolates each test from the shared per-printer core keeper.
async function render(printerId: string, onRowActivate?: (entry: unknown) => void) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: Record<string, unknown> = {
    root: 'history',
    scope: `test:${printerId}`,
    mode: 'history',
    title: 'History',
    menuEnabled: false,
  };
  if (onRowActivate) props.onRowActivate = onRowActivate;
  const component = mount(WithApi, {
    target,
    props: {
      api: fakeApi(printerId),
      component: FileTable as unknown as Component<Record<string, unknown>>,
      props,
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
  return { target, stop: () => { unmount(component); target.remove(); } };
}

describe('FileTable history row activation', () => {
  it('activates with click, Enter, and Space while keeping the file menu disabled', async () => {
    const activate = vi.fn();
    const view = await render('p-row-active', activate);
    try {
      const row = view.target.querySelector<HTMLTableRowElement>('tr.row-file');
      expect(row).not.toBeNull();
      expect(row?.tabIndex).toBe(0);
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      row?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      flushSync();
      expect(activate).toHaveBeenCalledTimes(3);
      expect(view.target.querySelector('[role="menu"]')).toBeNull();
    } finally {
      view.stop();
    }
  });

  it('keeps a history row inert when no activation callback is provided', async () => {
    const view = await render('p-row-inert');
    try {
      const row = view.target.querySelector<HTMLTableRowElement>('tr.row-file');
      expect(row?.classList.contains('inert')).toBe(true);
      expect(row?.hasAttribute('tabindex')).toBe(false);
      expect(row?.getAttribute('role')).toBeNull();
    } finally {
      view.stop();
    }
  });
});
