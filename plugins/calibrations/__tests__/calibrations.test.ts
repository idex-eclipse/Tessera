import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { guardCalibPrintStart, guardCalibScript, scriptCommands } from '../guards';
import * as hotkeys from '../hotkeys';
import { calibrationsManifest } from '../manifest';
import { pageUi } from '../page-ui-state.svelte';
import { ensurePrinterTracker, stopPrinterTracker } from '../printer-tracker';

// ------------------------------------------------------------------
// Fake PluginApi: подписки и запросы по принтерам
// ------------------------------------------------------------------

type Delta = Record<string, Record<string, unknown>>;

function createFakeApi(printerIds: string[], queryResult?: (pid: string) => unknown) {
  const subs = new Map<string, Array<(d: Delta) => void>>();
  const requests: Array<{ pid: string; method: string; params: unknown }> = [];
  let printersCb: ((p: Array<{ id: string; name: string; url: string }>) => void) | null = null;
  let ids = [...printerIds];
  let activeId = printerIds[0] ?? '';

  const handleFor = (pid: string) => ({
    subscribe(_objects: unknown, cb: (d: Delta) => void) {
      subs.set(pid, [...(subs.get(pid) ?? []), cb]);
      return () => {
        subs.set(pid, (subs.get(pid) ?? []).filter((c) => c !== cb));
      };
    },
    async request(method: string, params?: unknown) {
      requests.push({ pid, method, params });
      if (method === 'printer.objects.query') {
        if (!queryResult) throw new Error('offline');
        return queryResult(pid);
      }
      return {};
    },
  });

  const handles = new Map<string, ReturnType<typeof handleFor>>();
  const api = {
    pluginId: '@core/calibrations',
    get printer() {
      return { id: activeId, name: activeId, url: '' };
    },
    get printers() {
      return ids.map((id) => ({ id, name: id, url: '' }));
    },
    onPrintersChange(cb: typeof printersCb) {
      printersCb = cb;
      return () => {
        printersCb = null;
      };
    },
    moonrakerFor(pid: string) {
      if (!handles.has(pid)) handles.set(pid, handleFor(pid));
      return handles.get(pid)!;
    },
    moonraker() {
      return api.moonrakerFor(activeId);
    },
  } as unknown as PluginApi;

  return {
    api,
    requests,
    emit(pid: string, delta: Delta) {
      for (const cb of subs.get(pid) ?? []) cb(delta);
    },
    subscriberCount: (pid: string) => (subs.get(pid) ?? []).length,
    setPrinters(next: string[]) {
      ids = next;
      printersCb?.(next.map((id) => ({ id, name: id, url: '' })));
    },
    setActive(id: string) {
      activeId = id;
    },
  };
}

const script = (pid: string, s: string) => ({
  method: 'printer.gcode.script',
  params: { script: s },
  targetPrinterId: pid,
});

afterEach(() => stopPrinterTracker());

// ------------------------------------------------------------------

describe('scriptCommands', () => {
  it('takes the first word of every non-empty, non-comment line, upper-cased', () => {
    expect(scriptCommands('g28\n  bed_mesh_calibrate  PROFILE=x\n\n; note\n# other\nM117 hi')).toEqual([
      'G28',
      'BED_MESH_CALIBRATE',
      'M117',
    ]);
  });
});

describe('guard calib-safety', () => {
  it('denies calibrations and config saves while printing, per target printer', async () => {
    const f = createFakeApi(['a', 'b']);
    ensurePrinterTracker(f.api);
    f.emit('a', { print_stats: { state: 'printing' }, toolhead: { homed_axes: 'xyz' } });
    f.emit('b', { print_stats: { state: 'standby' }, toolhead: { homed_axes: 'xyz' } });

    expect(await guardCalibScript(script('a', 'PID_CALIBRATE HEATER=extruder TARGET=200'), 't', { targetPrinterId: 'a' }))
      .toEqual({ action: 'deny', reasonKey: 'calibrations.guard.start_during_print' });
    expect(await guardCalibScript(script('a', 'SAVE_CONFIG'), 't', { targetPrinterId: 'a' }))
      .toEqual({ action: 'deny', reasonKey: 'calibrations.guard.save_during_print' });

    // тот же запрос на принтер B (не печатает) разрешён
    expect(await guardCalibScript(script('b', 'PID_CALIBRATE HEATER=extruder TARGET=200'), 't', { targetPrinterId: 'b' }))
      .toEqual({ action: 'allow' });
  });

  it('requires homed axes for mesh/shaper/leveling commands', async () => {
    const f = createFakeApi(['a']);
    ensurePrinterTracker(f.api);
    f.emit('a', { print_stats: { state: 'standby' }, toolhead: { homed_axes: 'xy' } });

    const run = (s: string) => guardCalibScript(script('a', s), 't', { targetPrinterId: 'a' });
    expect(await run('BED_MESH_CALIBRATE')).toEqual({ action: 'deny', reasonKey: 'calibrations.guard.needs_homing' });
    expect(await run('Z_TILT_ADJUST')).toEqual({ action: 'deny', reasonKey: 'calibrations.guard.needs_homing' });
    expect(await run('PID_CALIBRATE HEATER=extruder TARGET=200')).toEqual({ action: 'allow' }); // PID не требует homing

    f.emit('a', { toolhead: { homed_axes: 'xyz' } });
    expect(await run('BED_MESH_CALIBRATE')).toEqual({ action: 'allow' });
  });

  it('inspects every line of a multi-line script, not only the first', async () => {
    const f = createFakeApi(['a']);
    ensurePrinterTracker(f.api);
    f.emit('a', { print_stats: { state: 'printing' }, toolhead: { homed_axes: 'xyz' } });

    const decision = await guardCalibScript(script('a', 'G28\nBED_MESH_CALIBRATE'), 't', { targetPrinterId: 'a' });
    expect(decision).toEqual({ action: 'deny', reasonKey: 'calibrations.guard.start_during_print' });
  });

  it('does not touch Moonraker for commands it does not watch', async () => {
    const f = createFakeApi(['a'], () => ({}));
    ensurePrinterTracker(f.api);
    expect(await guardCalibScript(script('a', 'M104 S200\nG1 X10'), 't', { targetPrinterId: 'a' })).toEqual({ action: 'allow' });
    expect(f.requests).toEqual([]);
  });

  it('asks Moonraker when the printer state is not tracked yet', async () => {
    const f = createFakeApi(['a'], () => ({
      status: { print_stats: { state: 'printing' }, toolhead: { homed_axes: 'xyz' } },
    }));
    ensurePrinterTracker(f.api); // подписка есть, дельт ещё не было

    const decision = await guardCalibScript(script('a', 'SHAPER_CALIBRATE'), 't', { targetPrinterId: 'a' });
    expect(decision).toEqual({ action: 'deny', reasonKey: 'calibrations.guard.start_during_print' });
    expect(f.requests.some((r) => r.method === 'printer.objects.query' && r.pid === 'a')).toBe(true);
  });

  it('allows when the state cannot be determined (offline)', async () => {
    const f = createFakeApi(['a']); // query бросает
    ensurePrinterTracker(f.api);
    expect(await guardCalibScript(script('a', 'SAVE_CONFIG'), 't', { targetPrinterId: 'a' })).toEqual({ action: 'allow' });
  });

  it('ignores other methods', async () => {
    expect(await guardCalibScript({ method: 'server.info', params: undefined, targetPrinterId: 'a' }, 't', { targetPrinterId: 'a' }))
      .toEqual({ action: 'allow' });
  });
});

describe('guard calib-print-start', () => {
  it('denies a print start while manual probing is active on the target printer only', () => {
    const f = createFakeApi(['a', 'b']);
    ensurePrinterTracker(f.api);
    f.emit('a', { manual_probe: { is_active: true } });

    const start = (pid: string) =>
      guardCalibPrintStart({ method: 'printer.print.start', params: { filename: 'x' }, targetPrinterId: pid }, 't', { targetPrinterId: pid });
    expect(start('a')).toEqual({ action: 'deny', reasonKey: 'calibrations.guard.probe_active' });
    expect(start('b')).toEqual({ action: 'allow' });

    f.emit('a', { manual_probe: { is_active: false } });
    expect(start('a')).toEqual({ action: 'allow' });
  });
});

describe('printer tracker', () => {
  it('follows the printer registry: subscribes to new printers, drops removed ones', () => {
    const f = createFakeApi(['a']);
    ensurePrinterTracker(f.api);
    expect(f.subscriberCount('a')).toBe(1);

    f.setPrinters(['a', 'b']);
    expect(f.subscriberCount('b')).toBe(1);

    f.setPrinters(['b']);
    expect(f.subscriberCount('a')).toBe(0);
  });

  it('is idempotent', () => {
    const f = createFakeApi(['a']);
    ensurePrinterTracker(f.api);
    ensurePrinterTracker(f.api);
    expect(f.subscriberCount('a')).toBe(1);
  });
});

describe('hotkey handlers', () => {
  it('TESTZ / ACCEPT / ABORT act only while manual probing is active on the active printer', async () => {
    const f = createFakeApi(['a']);
    ensurePrinterTracker(f.api);
    const sent = () => f.requests.filter((r) => r.method === 'printer.gcode.script').map((r) => (r.params as { script: string }).script);

    await hotkeys.hotkeyTestzUp(f.api);
    await hotkeys.hotkeyProbeAccept(f.api);
    expect(sent()).toEqual([]);

    f.emit('a', { manual_probe: { is_active: true } });
    await hotkeys.hotkeyTestzUp(f.api);
    await hotkeys.hotkeyTestzDown(f.api);
    await hotkeys.hotkeyTestzUpFine(f.api);
    await hotkeys.hotkeyTestzDownFine(f.api);
    await hotkeys.hotkeyProbeAccept(f.api);
    await hotkeys.hotkeyProbeAbort(f.api);
    expect(sent()).toEqual(['TESTZ Z=+0.1', 'TESTZ Z=-0.1', 'TESTZ Z=+0.01', 'TESTZ Z=-0.01', 'ACCEPT', 'ABORT']);
  });

  it('tab hotkeys request the matching tab', () => {
    hotkeys.hotkeyTabHeaters();
    expect(pageUi.requestedTab).toBe('heaters');
    const seq = pageUi.seq;
    hotkeys.hotkeyTabMesh();
    expect(pageUi.requestedTab).toBe('mesh');
    expect(pageUi.seq).toBe(seq + 1);
  });
});

describe('manifest', () => {
  it('every guard and hotkey handler is exported by the plugin modules', () => {
    const exported = { ...hotkeys, guardCalibScript, guardCalibPrintStart } as Record<string, unknown>;
    for (const g of calibrationsManifest.guards ?? []) expect(typeof exported[g.handler]).toBe('function');
    for (const h of calibrationsManifest.hotkeys ?? []) expect(typeof exported[h.handler]).toBe('function');
  });

  it('hotkeys are valid, unique and do not conflict with the host navigation keys', () => {
    const entries = (calibrationsManifest.hotkeys ?? []).map((contribution) => ({
      pluginId: calibrationsManifest.id,
      contribution: { ...contribution },
    }));
    const host = createHostHotkeys({
      ...fakeHostHotkeyDeps(),
    }).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));

    const analysis = analyzeHotkeys([...host, ...entries]);
    expect(analysis.invalid).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
    expect(new Set(entries.map((e) => e.contribution.id)).size).toBe(entries.length);
  });
});
