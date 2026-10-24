import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi, PluginManifest } from '../../../plugin-sdk/src/types';
import * as calibrations from '../../calibrations/hotkeys';
import { calibrationsManifest } from '../../calibrations/manifest';
import * as config from '../../config/hotkeys';
import * as consolePlugin from '../../console/hotkeys';
import { consoleManifest } from '../../console/manifest';
import { configManifest } from '../../config/manifest';
import * as history from '../../history/hotkeys';
import { historyManifest } from '../../history/manifest';
import * as jobs from '../../jobs/hotkeys';
import { jobsManifest } from '../../jobs/manifest';
import * as system from '../../system/hotkeys';
import { systemManifest } from '../../system/manifest';
import { systemUiState } from '../../system/system-ui-state.svelte';
import { openPluginPage, pageHash } from '../page-nav';

afterEach(() => {
  vi.unstubAllGlobals();
  systemUiState.uploadPickSeq = 0;
  systemUiState.printAfterToggleSeq = 0;
});

const api = (id: string) => ({ printer: { id } }) as unknown as PluginApi;

describe('openPluginPage', () => {
  it('builds an encoded hash route and ignores a missing active printer', () => {
    const location = { hash: '' };
    vi.stubGlobal('location', location);

    expect(pageHash('p 1', 'my/page')).toBe('#/p/p%201/my%2Fpage');

    openPluginPage(api('p1'), 'jobs');
    expect(location.hash).toBe('#/p/p1/jobs');

    location.hash = '';
    openPluginPage(api(''), 'jobs');
    expect(location.hash).toBe('');
  });
});

/** [манифест, модуль hotkeys, id hotkey, клавиши по умолчанию, обработчик, страница] */
const OPEN_PAGE_KEYS: Array<[PluginManifest, Record<string, unknown>, string, string, string, string]> = [
  [jobsManifest, jobs, 'open-jobs', 'J', 'hotkeyOpenJobs', 'jobs'],
  [historyManifest, history, 'open-history', 'H', 'hotkeyOpenHistory', 'history'],
  [systemManifest, system, 'open-machine', 'M', 'hotkeyOpenMachine', 'machine'],
  [configManifest, config, 'open-config', 'Shift+C', 'hotkeyOpenConfig', 'config'],
  [calibrationsManifest, calibrations, 'open-calibrations', 'Shift+A', 'hotkeyOpenCalibrations', 'calibrations'],
  [consoleManifest, consolePlugin, 'open-console', 'Shift+O', 'hotkeyOpenConsole', 'console'],
];

describe.each(OPEN_PAGE_KEYS)('open-page hotkey of %#', (manifest, mod, id, keys, handler, page) => {
  it(`${manifest.id}: ${keys} is a global hotkey that opens an existing page`, () => {
    const declared = manifest.hotkeys?.find((h) => h.id === id);
    expect(declared).toMatchObject({ scope: 'global', keys, handler });

    // страница, на которую ведёт клавиша, объявлена в манифесте этого же плагина
    expect(manifest.pages?.some((p) => p.id === page)).toBe(true);

    const location = { hash: '' };
    vi.stubGlobal('location', location);
    (mod[handler] as (a: PluginApi) => void)(api('printer-1'));
    expect(location.hash).toBe(`#/p/printer-1/${page}`);
  });
});

describe('system upload hotkeys', () => {
  it('U asks the right panel to open the file picker, P to toggle "print after upload"', () => {
    system.hotkeyUploadFile();
    expect(systemUiState.uploadPickSeq).toBe(1);
    system.hotkeyTogglePrintAfter();
    system.hotkeyTogglePrintAfter();
    expect(systemUiState.printAfterToggleSeq).toBe(2);
  });

  it('are declared as global hotkeys with exported handlers', () => {
    const byId = Object.fromEntries((systemManifest.hotkeys ?? []).map((h) => [h.id, h]));
    expect(byId['upload-file']).toMatchObject({ scope: 'global', keys: 'U', handler: 'hotkeyUploadFile' });
    expect(byId['toggle-print-after']).toMatchObject({ scope: 'global', keys: 'P', handler: 'hotkeyTogglePrintAfter' });
    for (const id of ['upload-file', 'toggle-print-after']) {
      expect(typeof (system as Record<string, unknown>)[byId[id]!.handler]).toBe('function');
    }
  });
});
