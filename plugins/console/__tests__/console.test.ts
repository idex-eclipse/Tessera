import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { calibrationsManifest } from '../../calibrations/manifest';
import { configManifest } from '../../config/manifest';
import { historyManifest } from '../../history/manifest';
import { jobsManifest } from '../../jobs/manifest';
import { systemManifest } from '../../system/manifest';
import {
  applyFilters,
  attach,
  clearLines,
  compileFilters,
  getLines,
  getPrefs,
  isPrinting,
  refreshNow,
  type ConsoleLine,
} from '../console-session.svelte';
import * as hotkeys from '../hotkeys';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { consoleManifest } from '../manifest';
import { consoleUi } from '../page-ui-state.svelte';
import { breaksPrint, isPrintActive, scriptCommands } from '../print-safety';

afterEach(() => {
  vi.unstubAllGlobals();
  consoleUi.focusInputSeq = 0;
  consoleUi.toggleFiltersSeq = 0;
  consoleUi.filtersOpen = false;
});

describe('print-safety', () => {
  it('extracts the first word of every real line, upper-cased', () => {
    expect(scriptCommands('g28\n; comment\n\n  m104 S200 ; x\n# note\nRESTART')).toEqual(['G28', 'M104', 'RESTART']);
  });

  it('flags RESTART / FIRMWARE_RESTART (any case, any line) and nothing else', () => {
    expect(breaksPrint('restart')).toBe(true);
    expect(breaksPrint('G28\nFIRMWARE_RESTART')).toBe(true);
    expect(breaksPrint('M112')).toBe(false); // аварийная остановка не задерживается
    expect(breaksPrint('RESTART_FAN S1')).toBe(false);
    expect(breaksPrint('; RESTART')).toBe(false);
    expect(breaksPrint('G1 X1')).toBe(false);
  });

  it('treats printing and paused as an active print', () => {
    expect(isPrintActive('printing')).toBe(true);
    expect(isPrintActive('paused')).toBe(true);
    for (const s of ['standby', 'complete', 'cancelled', 'error', undefined]) expect(isPrintActive(s)).toBe(false);
  });
});

describe('filters', () => {
  const line = (id: string, text: string): ConsoleLine => ({ id, kind: 'response', text, time: '' });

  it('hides matching lines and ignores invalid patterns', () => {
    const entries = compileFilters(['^\\s*(B|T\\d*):\\d', '(']);
    expect(entries[1]!.re).toBeNull();
    const out = applyFilters([line('1', 'ok'), line('2', 'B:60.0 /60.0 T0:200.0 /200.0')], entries);
    expect(out.map((l) => l.id)).toEqual(['1']);
  });
});

// ------------------------------------------------------------------
// Жизненный цикл сессии (fake PluginApi)
// ------------------------------------------------------------------

function fakeApi(ids: string[], store: (pid: string) => Promise<unknown>) {
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  const stored: Array<{ pid: string; message: string; time: number; type: string }> = [];
  let printersCb: ((p: Array<{ id: string }>) => void) | null = null;
  let offPrinters = 0;
  let printStatsCb: ((d: unknown) => void) | null = null;

  const handle = (pid: string) => ({
    readyState: 'open',
    onConnectionStatusChange: () => () => {},
    onReady: () => () => {},
    onNotify: () => () => {
      unsubscribed.push(`${pid}:notify`);
    },
    subscribe: (_o: unknown, cb: (d: unknown) => void) => {
      subscribed.push(pid);
      printStatsCb = cb;
      return () => {
        unsubscribed.push(`${pid}:sub`);
      };
    },
    request: async (method: string) => {
      if (method === 'server.gcode_store') return store(pid);
      if (method === 'printer.gcode.help') return {};
      return {};
    },
  });

  const settings = { get: () => undefined, set: () => {} };
  const api = {
    printer: { id: ids[0] },
    printers: ids.map((id) => ({ id })),
    onPrintersChange: (cb: (p: Array<{ id: string }>) => void) => {
      printersCb = cb;
      return () => {
        offPrinters++;
      };
    },
    moonrakerFor: handle,
    settings: { onChange: () => () => {} },
    settingsFor: () => settings,
  } as unknown as PluginApi;

  return {
    api,
    subscribed,
    unsubscribed,
    stored,
    emitPrintState: (state: string) => printStatsCb?.({ print_stats: { state } }),
    offPrinters: () => offPrinters,
    firePrinters: (p: Array<{ id: string }>) => printersCb?.(p),
  };
}

const entry = (message: string, time: number) => ({ message, time, type: 'response' });

describe('session lifecycle', () => {
  it('subscribes once for several consumers and tears down when the last one detaches', () => {
    const f = fakeApi(['p1', 'p2'], async () => ({ gcode_store: [] }));

    const a = attach(f.api);
    const b = attach(f.api);
    expect(f.subscribed).toEqual(['p1', 'p2']); // второй потребитель не плодит подписки

    a();
    expect(f.offPrinters()).toBe(0);
    a(); // повторный вызов того же detach безвреден
    expect(f.offPrinters()).toBe(0);

    b();
    expect(f.offPrinters()).toBe(1);
    expect(f.unsubscribed.filter((u) => u.endsWith(':sub')).sort()).toEqual(['p1:sub', 'p2:sub']);
  });

  it('tracks the print state used for the restart confirmation', async () => {
    const f = fakeApi(['p3'], async () => ({ gcode_store: [] }));
    const off = attach(f.api);
    expect(isPrinting('p3')).toBe(false);
    f.emitPrintState('printing');
    expect(isPrinting('p3')).toBe(true);
    f.emitPrintState('standby');
    expect(isPrinting('p3')).toBe(false);
    off();
  });

  it('keeps the loaded lines after detach and drops them when the printer disappears', async () => {
    const f = fakeApi(['p4'], async () => ({ gcode_store: [entry('ok', 1)] }));
    const off = attach(f.api);
    await vi.waitFor(() => expect(getLines('p4').map((l) => l.text)).toEqual(['ok']));
    off();
    expect(getLines('p4').map((l) => l.text)).toEqual(['ok']);

    const off2 = attach(f.api);
    f.firePrinters([]); // принтер удалён
    expect(getLines('p4')).toEqual([]);
    off2();
  });

  it('ignores a stale store response that arrives after Clear', async () => {
    let release: (v: unknown) => void = () => {};
    let first = true;
    const f = fakeApi(['p5'], () => {
      if (first) {
        first = false;
        return new Promise((r) => (release = r)); // «в полёте» при первичной загрузке
      }
      return Promise.resolve({ gcode_store: [] });
    });
    const off = attach(f.api);

    clearLines('p5');
    release({ gcode_store: [entry('stale', 1)] });
    await Promise.resolve();
    await Promise.resolve();
    expect(getLines('p5')).toEqual([]);

    // «Обновить» снимает паузу и подтягивает свежие данные
    refreshNow(f.api, 'p5');
    off();
  });

  it('defaults prefs for an unknown printer', () => {
    expect(getPrefs('nobody')).toMatchObject({ reverse: false, autoscroll: true, filtersEnabled: true, filters: [] });
  });
});

// ------------------------------------------------------------------
// Hotkeys
// ------------------------------------------------------------------

describe('hotkey handlers', () => {
  it('C opens the console page of the active printer', () => {
    const location = { hash: '' };
    vi.stubGlobal('location', location);
    hotkeys.hotkeyOpenConsole({ printer: { id: 'printer-1' } } as unknown as PluginApi);
    expect(location.hash).toBe('#/p/printer-1/console');
  });

  it('Alt+I and Alt+F raise their request counters', () => {
    hotkeys.hotkeyFocusInput();
    hotkeys.hotkeyToggleFilters();
    hotkeys.hotkeyToggleFilters();
    expect(consoleUi.focusInputSeq).toBe(1);
    expect(consoleUi.toggleFiltersSeq).toBe(2);
  });

  it('stay quiet while the filter menu is open (Alt+F itself still works)', () => {
    const sets: unknown[] = [];
    const api = {
      printer: { id: 'p6' },
      settingsFor: () => ({ get: () => undefined, set: (_k: string, v: unknown) => sets.push(v) }),
    } as unknown as PluginApi;

    consoleUi.filtersOpen = true;
    hotkeys.hotkeyFocusInput();
    hotkeys.hotkeyClear(api);
    hotkeys.hotkeyToggleAutoscroll(api);
    hotkeys.hotkeyToggleReverse(api);
    expect(consoleUi.focusInputSeq).toBe(0);
    expect(sets).toEqual([]);

    hotkeys.hotkeyToggleFilters();
    expect(consoleUi.toggleFiltersSeq).toBe(1);
  });

  it('Alt+S / Alt+O flip the stored prefs of the active printer', () => {
    const sets: Array<Record<string, unknown>> = [];
    const api = {
      printer: { id: 'p7' },
      settingsFor: () => ({ get: () => undefined, set: (_k: string, v: Record<string, unknown>) => sets.push(v) }),
    } as unknown as PluginApi;

    hotkeys.hotkeyToggleAutoscroll(api);
    expect(sets.at(-1)).toMatchObject({ autoscroll: false });
    hotkeys.hotkeyToggleReverse(api);
    expect(sets.at(-1)).toMatchObject({ reverse: true });
  });

  it('ignore a missing active printer', () => {
    const api = { printer: { id: '' } } as unknown as PluginApi;
    expect(() => {
      hotkeys.hotkeyClear(api);
      hotkeys.hotkeyRefresh(api);
      hotkeys.hotkeyToggleAutoscroll(api);
      hotkeys.hotkeyToggleReverse(api);
    }).not.toThrow();
  });
});

describe('manifest', () => {
  it('declares exported handlers, an existing page and titled hotkeys', () => {
    const exported = hotkeys as Record<string, unknown>;
    for (const h of consoleManifest.hotkeys ?? []) {
      expect(typeof exported[h.handler]).toBe('function');
      expect(h.titleKey?.startsWith('console.hotkeys.')).toBe(true);
    }
    const open = consoleManifest.hotkeys?.find((h) => h.id === 'open-console');
    expect(open).toMatchObject({ scope: 'global', keys: 'C' });
    expect(consoleManifest.pages?.some((p) => p.id === 'console')).toBe(true);
  });

  it('does not conflict with the host or the other built-in plugins', () => {
    const asEntries = (m: typeof consoleManifest) =>
      (m.hotkeys ?? []).map((contribution) => ({ pluginId: m.id, contribution: { ...contribution } }));
    const host = createHostHotkeys({ ...fakeHostHotkeyDeps() }).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));

    const analysis = analyzeHotkeys([
      ...host,
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

  it('define every hotkey title and the new UI strings', () => {
    const keys = flat(en);
    for (const h of consoleManifest.hotkeys ?? []) expect(keys[h.titleKey!]).toBeTruthy();
    for (const k of ['console.confirmRestart', 'console.help.SafetyTitle', 'console.help.SafetyText']) {
      expect(keys[k]).toBeTruthy();
      expect(flat(ru)[k]).toBeTruthy();
    }
  });
});
