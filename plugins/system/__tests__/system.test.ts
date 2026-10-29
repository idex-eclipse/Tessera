import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { fakeHostHotkeyDeps } from '../../../host/src/core/__tests__/helpers/host-hotkey-deps';
import { createHostHotkeys } from '../../../host/src/core/host-hotkeys';
import { analyzeHotkeys } from '../../../host/src/core/hotkeys';
import { calibrationsManifest } from '../../calibrations/manifest';
import { configManifest } from '../../config/manifest';
import { historyManifest } from '../../history/manifest';
import { jobsManifest } from '../../jobs/manifest';
import { endangersPrint, guardSystemPrintSafety } from '../guards';
import * as hotkeys from '../hotkeys';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { systemManifest } from '../manifest';
import { ensurePrintTracker, stopPrintTracker } from '../print-tracker';
import { durationUnits, fmtClock, fmtDuration } from '../use-print-status.svelte';
import { updateRequestFor } from '../use-system.svelte';
import { systemUiState } from '../system-ui-state.svelte';

// ------------------------------------------------------------------
// Fake PluginApi: подписки и запросы по принтерам
// ------------------------------------------------------------------

type Delta = Record<string, Record<string, unknown>>;

function fakeApi(printerIds: string[], queryState?: string) {
  const subs = new Map<string, Array<(d: Delta) => void>>();
  const requests: Array<{ pid: string; method: string }> = [];
  let printersCb: ((p: Array<{ id: string }>) => void) | null = null;
  let ids = [...printerIds];

  const handles = new Map<string, unknown>();
  const api = {
    get printers() {
      return ids.map((id) => ({ id, name: id, url: '' }));
    },
    printer: { id: printerIds[0] ?? '' },
    onPrintersChange(cb: typeof printersCb) {
      printersCb = cb;
      return () => {
        printersCb = null;
      };
    },
    moonrakerFor(pid: string) {
      if (!handles.has(pid)) {
        handles.set(pid, {
          subscribe(_o: unknown, cb: (d: Delta) => void) {
            subs.set(pid, [...(subs.get(pid) ?? []), cb]);
            return () => subs.set(pid, (subs.get(pid) ?? []).filter((c) => c !== cb));
          },
          async request(method: string) {
            requests.push({ pid, method });
            if (queryState === undefined) throw new Error('offline');
            return { status: { print_stats: { state: queryState } } };
          },
        });
      }
      return handles.get(pid);
    },
  } as unknown as PluginApi;

  return {
    api,
    requests,
    emit: (pid: string, d: Delta) => (subs.get(pid) ?? []).forEach((cb) => cb(d)),
    subscriberCount: (pid: string) => (subs.get(pid) ?? []).length,
    setPrinters(next: string[]) {
      ids = next;
      printersCb?.(next.map((id) => ({ id })));
    },
  };
}

afterEach(() => {
  stopPrintTracker();
  systemUiState.notificationsOpen = false;
  systemUiState.refreshSeq = 0;
  vi.unstubAllGlobals();
});

const req = (method: string, params?: unknown) => ({ method, params });
const decide = (method: string, params: unknown, pid: string) =>
  guardSystemPrintSafety(req(method, params), 't', { targetPrinterId: pid });

const DENY = { action: 'deny', reasonKey: 'system.guard.print_in_progress' };
const ALLOW = { action: 'allow' };

// ------------------------------------------------------------------

describe('endangersPrint', () => {
  it('flags restarts, host power, updates and Klipper service stop/restart', () => {
    for (const m of [
      'printer.restart', 'printer.firmware_restart', 'machine.reboot', 'machine.shutdown',
      'machine.update.klipper', 'machine.update.client', 'machine.update.full', 'machine.update.rollback',
    ]) {
      expect(endangersPrint(req(m)), m).toBe(true);
    }
    expect(endangersPrint(req('machine.services.restart', { service: 'Klipper' }))).toBe(true);
    expect(endangersPrint(req('machine.services.stop', { service: 'klipper' }))).toBe(true);
  });

  it('does not flag reads, status/refresh, other services or the emergency stop', () => {
    for (const m of [
      'machine.update.status', 'machine.update.refresh', 'printer.emergency_stop', 'printer.info',
      'server.info', 'machine.system_info',
    ]) {
      expect(endangersPrint(req(m)), m).toBe(false);
    }
    expect(endangersPrint(req('machine.services.restart', { service: 'moonraker' }))).toBe(false);
    expect(endangersPrint(req('machine.services.start', { service: 'klipper' }))).toBe(false);
    expect(endangersPrint(req('machine.services.restart', undefined))).toBe(false);
  });
});

describe('guard system-print-safety', () => {
  it('denies dangerous operations only on the printer that is printing', async () => {
    const f = fakeApi(['a', 'b']);
    ensurePrintTracker(f.api);
    f.emit('a', { print_stats: { state: 'printing' } });
    f.emit('b', { print_stats: { state: 'standby' } });

    expect(await decide('printer.firmware_restart', undefined, 'a')).toEqual(DENY);
    expect(await decide('machine.reboot', undefined, 'a')).toEqual(DENY);
    expect(await decide('machine.services.restart', { service: 'klipper' }, 'a')).toEqual(DENY);
    expect(await decide('printer.firmware_restart', undefined, 'b')).toEqual(ALLOW);
  });

  it('treats paused as printing; complete/standby as not printing', async () => {
    const f = fakeApi(['a']);
    ensurePrintTracker(f.api);
    f.emit('a', { print_stats: { state: 'paused' } });
    expect(await decide('machine.shutdown', undefined, 'a')).toEqual(DENY);
    f.emit('a', { print_stats: { state: 'complete' } });
    expect(await decide('machine.shutdown', undefined, 'a')).toEqual(ALLOW);
  });

  it('never blocks harmless requests and does not touch Moonraker for them', async () => {
    const f = fakeApi(['a'], 'printing');
    ensurePrintTracker(f.api);
    expect(await decide('printer.emergency_stop', undefined, 'a')).toEqual(ALLOW);
    expect(await decide('machine.update.status', undefined, 'a')).toEqual(ALLOW);
    expect(f.requests).toEqual([]);
  });

  it('asks Moonraker when the state is not tracked yet, and allows when it cannot be determined', async () => {
    const asked = fakeApi(['a'], 'printing');
    ensurePrintTracker(asked.api);
    expect(await decide('printer.restart', undefined, 'a')).toEqual(DENY);
    expect(asked.requests.some((r) => r.method === 'printer.objects.query')).toBe(true);
    stopPrintTracker();

    const offline = fakeApi(['a']);
    ensurePrintTracker(offline.api);
    expect(await decide('printer.restart', undefined, 'a')).toEqual(ALLOW);
  });

  it('the tracker follows the printer registry', () => {
    const f = fakeApi(['a']);
    ensurePrintTracker(f.api);
    ensurePrintTracker(f.api); // идемпотентно
    expect(f.subscriberCount('a')).toBe(1);
    f.setPrinters(['a', 'b']);
    expect(f.subscriberCount('b')).toBe(1);
    f.setPrinters(['b']);
    expect(f.subscriberCount('a')).toBe(0);
  });

  it('manifest matchers cover every method the guard can deny', () => {
    const matchers = systemManifest.guards?.[0]?.match ?? [];
    const matches = (m: string) =>
      matchers.some((pat) => (pat.endsWith('*') ? m.startsWith(pat.slice(0, -1)) : pat === m));
    for (const m of [
      'printer.restart', 'printer.firmware_restart', 'machine.reboot', 'machine.shutdown',
      'machine.update.klipper', 'machine.update.client', 'machine.update.rollback',
      'machine.services.restart', 'machine.services.stop',
    ]) {
      expect(matches(m), m).toBe(true);
    }
  });
});

describe('updateRequestFor', () => {
  it('built-in targets have their own method; everything else is a client', () => {
    expect(updateRequestFor('klipper')).toEqual({ method: 'machine.update.klipper' });
    expect(updateRequestFor('moonraker')).toEqual({ method: 'machine.update.moonraker' });
    expect(updateRequestFor('system')).toEqual({ method: 'machine.update.system' });
    expect(updateRequestFor('fluidd')).toEqual({ method: 'machine.update.client', params: { name: 'fluidd' } });
  });
});

describe('hotkeys', () => {
  it('M opens the Machine page of the active printer (id is URL-encoded)', () => {
    const location = { hash: '' };
    vi.stubGlobal('location', location);
    hotkeys.hotkeyOpenMachine({ printer: { id: 'p 1' } } as unknown as PluginApi);
    expect(location.hash).toBe('#/p/p%201/machine');

    location.hash = '';
    hotkeys.hotkeyOpenMachine({ printer: { id: '' } } as unknown as PluginApi);
    expect(location.hash).toBe('');
  });

  it('the Machine page id used by Alt+M exists in the manifest', () => {
    expect(systemManifest.pages?.some((p) => p.id === hotkeys.MACHINE_PAGE_ID)).toBe(true);
  });

  it('Alt+R bumps the refresh request; N toggles the notification center', () => {
    hotkeys.hotkeyRefreshMachine();
    expect(systemUiState.refreshSeq).toBe(1);
    hotkeys.hotkeyToggleNotifications();
    expect(systemUiState.notificationsOpen).toBe(true);
  });

  it('every guard and hotkey handler is exported', () => {
    const exported = { ...hotkeys, guardSystemPrintSafety } as Record<string, unknown>;
    for (const g of systemManifest.guards ?? []) expect(typeof exported[g.handler]).toBe('function');
    for (const h of systemManifest.hotkeys ?? []) expect(typeof exported[h.handler]).toBe('function');
  });

  it('there is no emergency-stop hotkey', () => {
    const joined = JSON.stringify(systemManifest.hotkeys);
    expect(joined).not.toMatch(/estop|emergency/i);
  });

  it('all built-in plugins together have no hotkey conflicts, including the host keys', () => {
    const asEntries = (m: { id: string; hotkeys?: Array<Record<string, unknown>> }) =>
      (m.hotkeys ?? []).map((contribution) => ({ pluginId: m.id, contribution: { ...contribution } }));
    const host = createHostHotkeys(fakeHostHotkeyDeps()).map((h) => ({
      pluginId: '@host',
      contribution: { id: h.id, keys: h.keys, scope: 'global' as const, handler: h.id },
    }));

    const analysis = analyzeHotkeys([
      ...host,
      ...asEntries(systemManifest as never),
      ...asEntries(calibrationsManifest as never),
      ...asEntries(configManifest as never),
      ...asEntries(jobsManifest as never),
      ...asEntries(historyManifest as never),
    ] as never);
    expect(analysis.invalid).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
  });
});

describe('print status formatting', () => {
  it('fmtDuration uses localized units', () => {
    expect(fmtDuration(3725)).toBe('1h 2m');
    expect(fmtDuration(125)).toBe('2m 5s');
    expect(fmtDuration(9)).toBe('9s');
    expect(fmtDuration(3725, { h: 'ч', m: 'м', s: 'с' })).toBe('1ч 2м');
    expect(fmtDuration(null)).toBe('—');
  });

  it('durationUnits reads the i18n keys', () => {
    const t = (k: string) => ({ 'system.units.h': 'H', 'system.units.m': 'M', 'system.units.s': 'S' })[k] ?? k;
    expect(durationUnits(t)).toEqual({ h: 'H', m: 'M', s: 'S' });
  });

  it('fmtClock formats in the given locale', () => {
    const d = new Date(2024, 0, 1, 15, 30);
    expect(fmtClock(null)).toBe('—');
    expect(fmtClock(d, 'en-US')).toMatch(/3:30/);
    expect(fmtClock(d, 'ru-RU')).toMatch(/15:30/);
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
    const e = Object.keys(flat(en)).sort();
    const r = Object.keys(flat(ru)).sort();
    expect(r.filter((k) => !e.includes(k))).toEqual([]);
    expect(e.filter((k) => !r.includes(k))).toEqual([]);
  });

  it('define the keys added in this review', () => {
    const keys = flat(en);
    for (const k of [
      'system.guard.print_in_progress', 'system.units.h', 'system.units.m', 'system.units.s',
      'system.errors.actionFailed', 'system.hotkeys.openMachine', 'system.hotkeys.refresh',
      'system.hotkeys.toggleNotifications', 'system.notifications.klipperShutdown',
      'system.notifications.klipperShutdownReason', 'system.notifications.tmcFlag',
    ]) {
      expect(keys[k], k).toBeTypeOf('string');
    }
  });

  it('define every key the monitoring UI and alerts look up dynamically', () => {
    const keys = flat(en);
    const dynamic = [
      ...['overview', 'monitoring', 'maintenance'].map((t) => `system.tabs.${t}`),
      ...['ok', 'warn', 'crit', 'unknown'].map((s) => `system.health.state.${s}`),
      ...['undervoltage', 'freqCapped', 'throttled', 'tempLimit'].map((f) => `system.throttle.${f}`),
      ...['retransmit', 'invalid', 'highLoad', 'busState', 'busErrors'].map((r) => `system.link.reason.${r}`),
      ...['active', 'warning', 'passive', 'off'].map((s) => `system.link.bus.${s}`),
      ...['ot', 'otpw', 's2ga', 's2gb', 's2vsa', 's2vsb', 'ola', 'olb', 't120', 't143', 't150', 't157'].map(
        (f) => `system.tmc.flag.${f}`,
      ),
      ...['host', 'mcu', 'tmc'].map((s) => `system.notifications.src.${s}`),
      'system.units.d', 'system.notifications.throttle', 'system.notifications.mcuLink',
      'system.notifications.canbus', 'system.tmc.idle', 'system.tmc.idleHint', 'system.health.idle',
      'system.hotkeys.tabOverview', 'system.hotkeys.tabMonitoring',
      'system.hotkeys.tabMaintenance', 'system.charts.mcuRetrans', 'system.charts.mcuRtt',
    ];
    for (const k of dynamic) expect(keys[k], k).toBeTypeOf('string');
  });

  it('keep the placeholders of the alert texts identical in en and ru', () => {
    const vars = (s: unknown) => (String(s).match(/\{\w+\}/g) ?? []).sort();
    const e = flat(en);
    const r = flat(ru);
    for (const k of ['throttle', 'mcuLink', 'canbus']) {
      expect(vars(r[`system.notifications.${k}`]), k).toEqual(vars(e[`system.notifications.${k}`]));
    }
    expect(vars(r['system.tmc.seen'])).toEqual(vars(e['system.tmc.seen']));
  });
});
