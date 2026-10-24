import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { configManifest } from '../../config/manifest';
import { createFileOps } from '../../shared/file-table/file-ops';
import { getSearchFocusTick } from '../../shared/file-table/file-table-state.svelte';
import { editorUi } from '../../shared/text-editor-dialog/editor-state.svelte';
import { guardNo3mfPrint } from '../guards';
import * as hotkeys from '../hotkeys';
import { inspectUrl, is3mf, jobsCustomAction, jobsMenuItems } from '../jobs-menu';
import { jobsManifest } from '../manifest';
import { jobsUi } from '../page-ui-state.svelte';

const DENY = { action: 'deny', reasonKey: 'jobs.guard.three_mf_not_printable' };
const ALLOW = { action: 'allow' };

afterEach(() => {
  editorUi.openCount = 0;
  jobsUi.modalOpen = false;
  vi.unstubAllGlobals();
});

const i18n = { t: (k: string) => k, locale: 'en' } as PluginApi['i18n'];
const file = (path: string) => ({ root: 'gcodes', path, isDir: false });
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

describe('guard jobs-no-3mf-print', () => {
  it('denies starting a print of a .3mf, case-insensitively', () => {
    expect(guardNo3mfPrint({ method: 'printer.print.start', params: { filename: 'dir/Part.3MF' } })).toEqual(DENY);
    expect(guardNo3mfPrint({ method: 'printer.print.start', params: { filename: 'part.3mf ' } })).toEqual(DENY);
  });

  it('denies queueing when ANY file in the batch is a .3mf', () => {
    expect(
      guardNo3mfPrint({ method: 'server.job_queue.post_job', params: { filenames: ['a.gcode', 'b.3mf'] } }),
    ).toEqual(DENY);
  });

  it('allows ordinary gcode, lookalike names, other methods and missing params', () => {
    expect(guardNo3mfPrint({ method: 'printer.print.start', params: { filename: 'a.gcode' } })).toEqual(ALLOW);
    expect(guardNo3mfPrint({ method: 'printer.print.start', params: { filename: 'a.3mf.gcode' } })).toEqual(ALLOW);
    expect(guardNo3mfPrint({ method: 'server.job_queue.post_job', params: { filenames: ['a.gcode'] } })).toEqual(ALLOW);
    expect(guardNo3mfPrint({ method: 'server.job_queue.post_job', params: { filenames: 'b.3mf' } })).toEqual(ALLOW);
    expect(guardNo3mfPrint({ method: 'server.files.delete_file', params: { path: 'gcodes/a.3mf' } })).toEqual(ALLOW);
    expect(guardNo3mfPrint({ method: 'printer.print.start', params: undefined })).toEqual(ALLOW);
  });
});

describe('jobs menu', () => {
  it('a gcode file gets the full menu; print is disabled while Klipper is not ready', () => {
    const ready = jobsMenuItems(i18n, file('a.gcode'), false, true);
    expect(ids(ready)).toEqual(['print', 'queue', 'edit', 'meta', 'preview', 'zip', 'download', 'rename', 'copy', 'delete']);
    expect(ready[0]!.disabled).toBeUndefined();

    const notReady = jobsMenuItems(i18n, file('a.gcode'), false, false);
    expect(notReady[0]).toMatchObject({ id: 'print', disabled: true });
  });

  it('a .3mf has no queue/preview/meta/edit; its "print" opens the inspector even if Klipper is not ready', () => {
    const items = jobsMenuItems(i18n, file('x.3mf'), false, false);
    expect(ids(items)).toEqual(['print', 'zip', 'download', 'rename', 'copy', 'delete']);
    expect(items[0]).toMatchObject({ label: 'jobs.open3mf' });
    expect(items[0]!.disabled).toBeUndefined();
  });

  it('directories get the short menu', () => {
    expect(ids(jobsMenuItems(i18n, { root: 'gcodes', path: 'd', isDir: true }, true, true))).toEqual(['zip', 'rename', 'delete']);
  });
});

describe('jobsCustomAction', () => {
  function setup() {
    const request = vi.fn(async () => ({}));
    const api = { printer: { id: 'p 1' }, moonraker: () => ({ request }) } as unknown as PluginApi;
    const ops = { startPrint: vi.fn(async () => {}), refreshMetadata: vi.fn(async () => {}) };
    const location = { hash: '' };
    vi.stubGlobal('location', location);
    return { api, ops, request, location };
  }

  it('starts a gcode print only when Klipper is ready', async () => {
    const { api, ops } = setup();
    await jobsCustomAction(api, ops, 'print', file('a.gcode'), false);
    expect(ops.startPrint).not.toHaveBeenCalled();
    await jobsCustomAction(api, ops, 'print', file('a.gcode'), true);
    expect(ops.startPrint).toHaveBeenCalledTimes(1);
  });

  it('sends a .3mf "print" to the Jobs page inspector instead of printer.print.start', async () => {
    const { api, ops, location } = setup();
    await jobsCustomAction(api, ops, 'print', file('dir/x y.3mf'), true);
    expect(ops.startPrint).not.toHaveBeenCalled();
    expect(location.hash).toBe(inspectUrl('p 1', 'dir/x y.3mf'));
    expect(location.hash).toBe('#/p/p%201/jobs?inspect=dir%2Fx%20y.3mf');
  });

  it('refuses to queue a .3mf, queues gcode', async () => {
    const { api, ops, request } = setup();
    await expect(jobsCustomAction(api, ops, 'queue', file('x.3mf'), true)).rejects.toThrow(/3MF/);
    expect(request).not.toHaveBeenCalled();

    await jobsCustomAction(api, ops, 'queue', file('a.gcode'), true);
    expect(request).toHaveBeenCalledWith('server.job_queue.post_job', { filenames: ['a.gcode'], reset: false });
  });

  it('is3mf matches only the extension', () => {
    expect(is3mf('a.3mf')).toBe(true);
    expect(is3mf('A.3MF')).toBe(true);
    expect(is3mf('a.3mf.gcode')).toBe(false);
    expect(is3mf('3mf')).toBe(false);
  });
});

describe('hotkeys', () => {
  const api = { printer: { id: 'p1' } } as unknown as PluginApi;

  it('Ctrl+F focuses the jobs table search', () => {
    const before = getSearchFocusTick(api, 'page:gcodes');
    hotkeys.hotkeyFindJob(api);
    expect(getSearchFocusTick(api, 'page:gcodes')).toBe(before + 1);
  });

  it('stay silent while the text editor or the 3MF inspector is open', () => {
    const before = getSearchFocusTick(api, 'page:gcodes');

    editorUi.openCount = 1;
    hotkeys.hotkeyFindJob(api);
    editorUi.openCount = 0;

    jobsUi.modalOpen = true;
    hotkeys.hotkeyFindJob(api);
    hotkeys.hotkeyRefreshJobs(api);

    expect(getSearchFocusTick(api, 'page:gcodes')).toBe(before);
  });
});

describe('manifest', () => {
  it('every guard and hotkey handler is exported by the plugin modules', () => {
    const exported = { ...hotkeys, guardNo3mfPrint } as Record<string, unknown>;
    for (const g of jobsManifest.guards ?? []) expect(typeof exported[g.handler]).toBe('function');
    for (const h of jobsManifest.hotkeys ?? []) expect(typeof exported[h.handler]).toBe('function');
  });

  it('does not conflict with the host keys, nor with the config plugin (same Ctrl+F on different pages)', () => {
    const asEntries = (m: typeof jobsManifest) =>
      (m.hotkeys ?? []).map((contribution) => ({ pluginId: m.id, contribution: { ...contribution } }));
    const host = createHostHotkeys({
      router: { navigateToPrinter: vi.fn() },
      printerManager: { printers: [], activePrinterId: null } as never,
      ui: { toggleFleet: vi.fn(), setFleet: vi.fn() },
    }).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));

    const analysis = analyzeHotkeys([...host, ...asEntries(jobsManifest), ...asEntries(configManifest)]);
    expect(analysis.invalid).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
  });
});

describe('file-ops readBlob', () => {
  it('sends the Bearer token when downloading a project file', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = { moonraker: () => ({ httpBaseUrl: 'http://pr:7125', authToken: 'tok' }) } as unknown as PluginApi;

    await createFileOps(api).readBlob(file('a b.3mf'));

    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(url).toBe('http://pr:7125/server/files/gcodes/a%20b.3mf');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});
