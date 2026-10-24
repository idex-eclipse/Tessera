import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { createFileOps } from '../../shared/file-table/file-ops';
import {
  getSearchFocusTick,
  getVisibleColumns,
} from '../../shared/file-table/file-table-state.svelte';
import { editorUi } from '../../shared/text-editor-dialog/editor-state.svelte';
import { guardCriticalConfig, isCriticalConfigPath, normalizeMoonrakerPath } from '../guards';
import * as hotkeys from '../hotkeys';
import { configManifest } from '../manifest';
import { activeSearchScope, pageUi, setActivePane, setTab } from '../page-ui-state.svelte';

const decide = (method: string, params: unknown) => guardCriticalConfig({ method, params });
const DENY = { action: 'deny', reasonKey: 'config.guard.critical_file' };
const ALLOW = { action: 'allow' };

afterEach(() => {
  editorUi.openCount = 0;
  pageUi.tab = 'logs';
  pageUi.pane = 'left';
  vi.unstubAllGlobals();
});

describe('path normalization', () => {
  it('lower-cases, strips leading/duplicate slashes and resolves . and ..', () => {
    expect(normalizeMoonrakerPath('/Config//Printer.CFG')).toBe('config/printer.cfg');
    expect(normalizeMoonrakerPath('config/./sub/../printer.cfg')).toBe('config/printer.cfg');
    expect(normalizeMoonrakerPath('config\\moonraker.conf')).toBe('config/moonraker.conf');
    expect(normalizeMoonrakerPath(undefined)).toBe('');
  });

  it('recognizes only printer.cfg and moonraker.conf in the config root as critical', () => {
    expect(isCriticalConfigPath('config/printer.cfg')).toBe(true);
    expect(isCriticalConfigPath('config/moonraker.conf')).toBe(true);
    expect(isCriticalConfigPath('config/macros/printer.cfg')).toBe(false);
    expect(isCriticalConfigPath('gcodes/printer.cfg')).toBe(false);
    expect(isCriticalConfigPath('config/macros.cfg')).toBe(false);
  });
});

describe('guard config-critical-files', () => {
  it('denies deleting critical files and the config root', () => {
    expect(decide('server.files.delete_file', { path: 'config/printer.cfg' })).toEqual(DENY);
    expect(decide('server.files.delete_file', { path: '/CONFIG/./moonraker.conf' })).toEqual(DENY);
    expect(decide('server.files.delete_directory', { path: 'config', force: true })).toEqual(DENY);
  });

  it('denies moving critical files away or onto them, and copying onto them', () => {
    expect(decide('server.files.move', { source: 'config/printer.cfg', dest: 'config/old.cfg' })).toEqual(DENY);
    expect(decide('server.files.move', { source: 'config/new.cfg', dest: 'config/printer.cfg' })).toEqual(DENY);
    expect(decide('server.files.move', { source: 'config', dest: 'config_old' })).toEqual(DENY);
    expect(decide('server.files.copy', { source: 'config/new.cfg', dest: 'config/printer.cfg' })).toEqual(DENY);
  });

  it('allows ordinary files, copying FROM a critical file, and other roots', () => {
    expect(decide('server.files.delete_file', { path: 'config/macros.cfg' })).toEqual(ALLOW);
    expect(decide('server.files.delete_file', { path: 'gcodes/printer.cfg' })).toEqual(ALLOW);
    expect(decide('server.files.delete_directory', { path: 'config/backup' })).toEqual(ALLOW);
    expect(decide('server.files.copy', { source: 'config/printer.cfg', dest: 'config/printer_copy.cfg' })).toEqual(ALLOW);
    expect(decide('server.files.move', { source: 'config/a.cfg', dest: 'config/b.cfg' })).toEqual(ALLOW);
  });

  it('ignores other methods and tolerates missing params', () => {
    expect(decide('printer.gcode.script', { script: 'G28' })).toEqual(ALLOW);
    expect(decide('server.files.delete_file', undefined)).toEqual(ALLOW);
  });
});

// ------------------------------------------------------------------

function fakeApi(printerId = 'p1') {
  return { printer: { id: printerId } } as unknown as PluginApi;
}

describe('hotkey handlers', () => {
  it('Alt+L / D / C select the right-hand tab and make that pane active', () => {
    hotkeys.hotkeyTabDocs();
    expect(pageUi.tab).toBe('docs');
    expect(pageUi.pane).toBe('right');
    hotkeys.hotkeyTabExamples();
    expect(pageUi.tab).toBe('config_examples');
    hotkeys.hotkeyTabLogs();
    expect(pageUi.tab).toBe('logs');
  });

  it('Ctrl+F asks the ACTIVE table to focus its search', () => {
    const api = fakeApi();

    setActivePane('left');
    const left = getSearchFocusTick(api, 'page:config');
    hotkeys.hotkeyFindFile(api);
    expect(getSearchFocusTick(api, 'page:config')).toBe(left + 1);

    setTab('docs');
    const right = getSearchFocusTick(api, 'page:docs');
    expect(activeSearchScope()).toBe('page:docs');
    hotkeys.hotkeyFindFile(api);
    expect(getSearchFocusTick(api, 'page:docs')).toBe(right + 1);
    expect(getSearchFocusTick(api, 'page:config')).toBe(left + 1); // левая не тронута
  });

  it('is a no-op while the modal text editor is open', () => {
    const api = fakeApi();
    editorUi.openCount = 1;
    const before = getSearchFocusTick(api, 'page:config');

    hotkeys.hotkeyFindFile(api);
    hotkeys.hotkeyTabDocs();

    expect(getSearchFocusTick(api, 'page:config')).toBe(before);
    expect(pageUi.tab).toBe('logs');
  });
});

describe('manifest', () => {
  it('every guard and hotkey handler is exported by the plugin modules', () => {
    const exported = { ...hotkeys, guardCriticalConfig } as Record<string, unknown>;
    for (const g of configManifest.guards ?? []) expect(typeof exported[g.handler]).toBe('function');
    for (const h of configManifest.hotkeys ?? []) expect(typeof exported[h.handler]).toBe('function');
  });

  it('declares the requested keys and does not conflict with the host navigation keys', () => {
    const byId = Object.fromEntries((configManifest.hotkeys ?? []).map((h) => [h.id, h.keys]));
    expect(byId).toMatchObject({
      'find-file': 'Ctrl+F',
      'tab-logs': 'Alt+L',
      'tab-docs': 'Alt+D',
      'tab-examples': 'Alt+C',
    });

    const entries = (configManifest.hotkeys ?? []).map((contribution) => ({
      pluginId: configManifest.id,
      contribution: { ...contribution },
    }));
    const host = createHostHotkeys({
      router: { navigateToPrinter: vi.fn() },
      printerManager: { printers: [], activePrinterId: null } as never,
      ui: { toggleFleet: vi.fn(), setFleet: vi.fn() },
    }).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));

    const analysis = analyzeHotkeys([...host, ...entries]);
    expect(analysis.invalid).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
  });
});

// ------------------------------------------------------------------

describe('file-ops authorization', () => {
  function opsWith(token: string | null) {
    const api = {
      moonraker: () => ({ httpBaseUrl: 'http://pr:7125', authToken: token }),
    } as unknown as PluginApi;
    return createFileOps(api);
  }

  const ref = { root: 'config', path: 'my dir/printer.cfg', isDir: false };

  it('sends the Bearer token on fetch-based operations', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => 'body' }));
    vi.stubGlobal('fetch', fetchMock);
    const ops = opsWith('tok');

    await ops.readText(ref);
    await ops.saveText(ref, 'x');
    await ops.createFile('config', '', 'a.cfg');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(3);
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    }
  });

  it('sends no Authorization header without a token', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
    await opsWith(null).readText(ref);
    const [, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(init.headers).toEqual({});
  });

  it('puts the token into view URLs only when there is one (images cannot send headers)', () => {
    expect(opsWith('a b').viewUrl(ref)).toBe(
      'http://pr:7125/server/files/config/my%20dir/printer.cfg?access_token=a%20b',
    );
    expect(opsWith(null).viewUrl(ref)).toBe('http://pr:7125/server/files/config/my%20dir/printer.cfg');
  });
});

describe('file-table-state settings subscription', () => {
  it('re-subscribes api.settings.onChange when the active printer changes', () => {
    const unsubs: Array<ReturnType<typeof vi.fn>> = [];
    let printerCb: (() => void) | null = null;
    const onChange = vi.fn(() => {
      const off = vi.fn();
      unsubs.push(off);
      return off;
    });
    const api = {
      printer: { id: 'wire-test' },
      settings: { get: () => undefined, onChange },
      onPrinterChange: (cb: () => void) => {
        printerCb = cb;
        return () => {};
      },
    } as unknown as PluginApi;

    getVisibleColumns(api, 'page:x', ['name'], ['name']); // wire() при первом обращении
    expect(onChange).toHaveBeenCalledTimes(1);

    printerCb!();
    expect(unsubs[0]).toHaveBeenCalledTimes(1); // старая подписка снята
    expect(onChange).toHaveBeenCalledTimes(2); // новая — на нового принтера
  });
});
