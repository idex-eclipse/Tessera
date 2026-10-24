import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { calibrationsManifest } from '../../calibrations/manifest';
import { configManifest } from '../../config/manifest';
import { consoleManifest } from '../../console/manifest';
import { historyManifest } from '../../history/manifest';
import { jobsManifest } from '../../jobs/manifest';
import { systemManifest } from '../../system/manifest';
import * as hotkeys from '../hotkeys';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { gcodePreviewManifest } from '../manifest';
import { ensureParsed, getEntry, reloadParsed } from '../viewer/gcode-store.svelte';
import { previewUi, sendPreviewCommand } from '../viewer/preview-ui-state.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
  previewUi.commandId = 0;
  previewUi.command = null;
  previewUi.dialogOpen = false;
});

const GCODE = 'G1 Z0.2 F1000\nG1 X10 Y10 E1\nG1 Z0.4\nG1 X20 Y20 E2\n';

function fakeApi(printerId: string, token = '') {
  const handle = { httpBaseUrl: `http://${printerId}`, authToken: token };
  return {
    printer: { id: printerId },
    moonrakerFor: () => handle,
  } as unknown as PluginApi;
}

async function settled(api: PluginApi, path: string) {
  await vi.waitFor(() => expect(getEntry(api, path)?.status).not.toBe('loading'));
  return getEntry(api, path)!;
}

describe('gcode-store', () => {
  it('fetches once, parses, and keeps files of different printers apart', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => GCODE }));
    vi.stubGlobal('fetch', fetchMock);

    const a = fakeApi('pa');
    const b = fakeApi('pb');
    ensureParsed(a, 'gcodes/x.gcode');
    ensureParsed(a, 'gcodes/x.gcode'); // повтор не плодит запросы
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await settled(a, 'gcodes/x.gcode')).status).toBe('ok');

    // тот же путь на другом принтере — другой файл
    expect(getEntry(b, 'gcodes/x.gcode')).toBeUndefined();
    ensureParsed(b, 'gcodes/x.gcode');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the Moonraker token and encodes path segments', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({ ok: true, text: async () => GCODE }));
    vi.stubGlobal('fetch', fetchMock);

    const api = fakeApi('pt', 'secret');
    ensureParsed(api, 'gcodes/my dir/a#b.gcode');
    await settled(api, 'gcodes/my dir/a#b.gcode');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://pt/server/files/gcodes/my%20dir/a%23b.gcode');
    expect(init).toEqual({ headers: { Authorization: 'Bearer secret' } });
  });

  it('reports HTTP errors and retries them on reload', async () => {
    let ok = false;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: 404, text: async () => GCODE })));

    const api = fakeApi('pe');
    ensureParsed(api, 'gcodes/e.gcode');
    expect(await settled(api, 'gcodes/e.gcode')).toEqual({ status: 'error', message: 'HTTP 404' });

    ok = true;
    reloadParsed(api, 'gcodes/e.gcode');
    expect((await settled(api, 'gcodes/e.gcode')).status).toBe('ok');
  });

  it('keeps only a few parsed files in memory (oldest evicted)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => GCODE })));
    const api = fakeApi('pc');

    for (let i = 0; i < 8; i++) ensureParsed(api, `gcodes/f${i}.gcode`);
    await settled(api, 'gcodes/f7.gcode');

    expect(getEntry(api, 'gcodes/f0.gcode')).toBeUndefined();
    expect(getEntry(api, 'gcodes/f1.gcode')).toBeUndefined();
    expect(getEntry(api, 'gcodes/f7.gcode')?.status).toBe('ok');
  });

  it('ignores an empty path', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ensureParsed(fakeApi('pn'), '');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getEntry(fakeApi('pn'), '')).toBeUndefined();
  });
});

describe('hotkey handlers', () => {
  it('G opens the preview page of the active printer', () => {
    const location = { hash: '' };
    vi.stubGlobal('location', location);
    hotkeys.hotkeyOpenPreview({ printer: { id: 'printer-1' } } as unknown as PluginApi);
    expect(location.hash).toBe('#/p/printer-1/gcode-preview');
  });

  it('send one command each, with increasing ids', () => {
    hotkeys.hotkeyLayerUp();
    expect(previewUi.command).toEqual({ name: 'layer-step', amount: 1 });
    hotkeys.hotkeyLayerDown10();
    expect(previewUi.command).toEqual({ name: 'layer-step', amount: -10 });
    hotkeys.hotkeyToggleMode();
    expect(previewUi.command).toEqual({ name: 'toggle-mode' });
    expect(previewUi.commandId).toBe(3);
  });

  it('stay quiet while the exclude-object dialog is open', () => {
    previewUi.dialogOpen = true;
    sendPreviewCommand({ name: 'clear' });
    hotkeys.hotkeyReloadPreview();
    expect(previewUi.commandId).toBe(0);
    expect(previewUi.command).toBeNull();
  });
});

describe('manifest', () => {
  it('declares exported handlers, titled hotkeys and an existing page', () => {
    const exported = hotkeys as Record<string, unknown>;
    for (const h of gcodePreviewManifest.hotkeys ?? []) {
      expect(typeof exported[h.handler]).toBe('function');
      expect(h.titleKey?.startsWith('gcodePreview.hotkeys.')).toBe(true);
    }
    expect(gcodePreviewManifest.hotkeys?.find((h) => h.id === 'open-preview')).toMatchObject({
      scope: 'global',
      keys: 'G',
    });
    expect(gcodePreviewManifest.pages?.some((p) => p.id === 'gcode-preview')).toBe(true);
    expect(gcodePreviewManifest.guards ?? []).toEqual([]);
  });

  it('does not conflict with the host or the other built-in plugins', () => {
    const asEntries = (m: typeof gcodePreviewManifest) =>
      (m.hotkeys ?? []).map((contribution) => ({ pluginId: m.id, contribution: { ...contribution } }));
    const host = createHostHotkeys({ ...fakeHostHotkeyDeps() }).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));

    const analysis = analyzeHotkeys([
      ...host,
      ...asEntries(gcodePreviewManifest),
      ...asEntries(consoleManifest),
      ...asEntries(configManifest),
      ...asEntries(jobsManifest),
      ...asEntries(historyManifest),
      ...asEntries(systemManifest),
      ...asEntries(calibrationsManifest),
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

  it('define every hotkey title and the summary line with its placeholders', () => {
    const keys = flat(en);
    for (const h of gcodePreviewManifest.hotkeys ?? []) expect(keys[h.titleKey!]).toBeTruthy();
    for (const l of [en, ru]) {
      const s = flat(l)['gcodePreview.summary'] as string;
      for (const ph of ['{moves}', '{layers}', '{extruders}']) expect(s).toContain(ph);
    }
  });
});
