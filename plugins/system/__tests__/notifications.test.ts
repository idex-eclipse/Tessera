import { describe, expect, it, vi } from 'vitest';

import type { MoonrakerProxyHandle, NotificationInput, PluginApi } from '../../../plugin-sdk/src/types';
import {
  parseGcodeResponse,
  reportSystemActionError,
  startNotificationProducers,
} from '../notifications';

describe('parseGcodeResponse', () => {
  it('parses the M118 MPU_NOTIFY echo, case-insensitively', () => {
    expect(parseGcodeResponse('echo: MPU_NOTIFY error Heater stuck')).toEqual({
      severity: 'error',
      source: 'macro',
      text: 'Heater stuck',
    });
    expect(parseGcodeResponse('echo:mpu_notify CRITICAL Fire')).toEqual({
      severity: 'critical',
      source: 'macro',
      text: 'Fire',
    });
    expect(parseGcodeResponse('echo:   MPU_NOTIFY info  all good  ')).toMatchObject({
      severity: 'info',
      text: 'all good',
    });
  });

  it('rejects an unknown severity or a missing text', () => {
    expect(parseGcodeResponse('echo: MPU_NOTIFY warning x')).toBeNull();
    expect(parseGcodeResponse('echo: MPU_NOTIFY error')).toBeNull();
    expect(parseGcodeResponse('MPU_NOTIFY error x')).toBeNull(); // без префикса echo:
  });

  it('accepts a string, an array (first element) and an object (message / text)', () => {
    const line = 'echo: MPU_NOTIFY info hi';
    expect(parseGcodeResponse(line)?.text).toBe('hi');
    expect(parseGcodeResponse([line, 'x'])?.text).toBe('hi');
    expect(parseGcodeResponse({ message: line })?.text).toBe('hi');
    expect(parseGcodeResponse({ text: line })?.text).toBe('hi');
    expect(parseGcodeResponse('')).toBeNull();
    expect(parseGcodeResponse(undefined)).toBeNull();
    expect(parseGcodeResponse([42])).toBeNull();
  });

  it('turns "!!" lines into errors, critical for shutdown-like ones', () => {
    expect(parseGcodeResponse('!! Move out of range')).toEqual({
      severity: 'error',
      source: 'gcode',
      text: 'Move out of range',
    });
    expect(parseGcodeResponse('!! Heater extruder not heating at expected rate')?.severity).toBe('critical');
    expect(parseGcodeResponse("!! MCU 'mcu' shutdown: Timer too close")?.severity).toBe('critical');
    expect(parseGcodeResponse('!!   ')).toBeNull();
  });

  it('turns "// Unknown command" into an error and ignores other lines', () => {
    expect(parseGcodeResponse('// Unknown command:"FOO"')).toEqual({
      severity: 'error',
      source: 'gcode',
      text: 'Unknown command:"FOO"',
    });
    expect(parseGcodeResponse('ok')).toBeNull();
    expect(parseGcodeResponse('// probe at 1,2')).toBeNull();
  });
});

describe('startNotificationProducers', () => {
  function setup(printerIds = ['p1']) {
    const handlers = new Map<string, Array<(p: unknown) => void>>();
    const pushed: NotificationInput[] = [];
    let printersCb: ((p: Array<{ id: string }>) => void) | null = null;
    let ids = printerIds;
    const unsubscribed = vi.fn();

    const handle = (): MoonrakerProxyHandle =>
      ({
        readyState: 'closed',
        request: vi.fn(async () => null),
        subscribe: vi.fn(() => () => {}),
        onReady: () => unsubscribed,
        onConnectionStatusChange: () => unsubscribed,
        onNotify: (ev: string, cb: (p: unknown) => void) => {
          handlers.set(ev, [...(handlers.get(ev) ?? []), cb]);
          return () => {
            handlers.set(ev, (handlers.get(ev) ?? []).filter((h) => h !== cb));
            unsubscribed();
          };
        },
      }) as unknown as MoonrakerProxyHandle;

    const api = {
      get printers() {
        return ids.map((id) => ({ id, name: id, url: '' }));
      },
      moonrakerFor: () => handle(),
      onPrintersChange: (cb: (p: Array<{ id: string }>) => void) => {
        printersCb = cb;
        return () => {
          printersCb = null;
        };
      },
      notifications: { push: (n: NotificationInput) => pushed.push(n) },
      i18n: { t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: 'en' },
    } as unknown as PluginApi;

    return {
      api,
      pushed,
      unsubscribed,
      emit: (ev: string, payload: unknown) => (handlers.get(ev) ?? []).forEach((h) => h(payload)),
      listeners: (ev: string) => (handlers.get(ev) ?? []).length,
      setPrinters(next: string[]) {
        ids = next;
        printersCb?.(next.map((id) => ({ id })));
      },
    };
  }

  it('turns a macro echo into a labelled notification for the right printer', () => {
    const t = setup();
    startNotificationProducers(t.api);
    t.emit('notify_gcode_response', ['echo: MPU_NOTIFY error Bed drift']);
    expect(t.pushed).toEqual([
      {
        printerId: 'p1',
        severity: 'error',
        label: 'system.notifications.src.macro',
        text: 'Bed drift',
      },
    ]);
  });

  it('reports a Klipper shutdown as critical, with the reason when given', () => {
    const t = setup();
    startNotificationProducers(t.api);
    t.emit('notify_klippy_shutdown', ['Lost communication with MCU']);
    t.emit('notify_klippy_shutdown', []);
    expect(t.pushed.map((n) => [n.severity, n.label, n.text])).toEqual([
      ['critical', 'system.notifications.src.klippy', 'system.notifications.klipperShutdownReason:{"reason":"Lost communication with MCU"}'],
      ['critical', 'system.notifications.src.klippy', 'system.notifications.klipperShutdown'],
    ]);
    expect(t.pushed[0]!.actions).toEqual([
      {
        element: 'mpu-system-klipper-error-help-action',
        params: { hintId: 'mcu-connection' },
      },
    ]);
    expect(t.pushed[1]!.actions).toBeUndefined();
  });

  it('adds help only to recognised Klipper gcode errors, never to macro messages', () => {
    const t = setup();
    startNotificationProducers(t.api);
    t.emit('notify_gcode_response', ['!! Move out of range: 300 0 0']);
    t.emit('notify_gcode_response', ['!! A future unknown error']);
    t.emit('notify_gcode_response', ['echo: MPU_NOTIFY error Move out of range']);

    expect(t.pushed[0]!.actions?.[0]).toEqual({
      element: 'mpu-system-klipper-error-help-action',
      params: { hintId: 'move-out-of-range' },
    });
    expect(t.pushed[1]!.actions).toBeUndefined();
    expect(t.pushed[2]!.actions).toBeUndefined();
  });

  it('ignores gcode responses that are not notifications', () => {
    const t = setup();
    startNotificationProducers(t.api);
    t.emit('notify_gcode_response', ['ok']);
    t.emit('notify_gcode_response', ['// probe at 1,2']);
    expect(t.pushed).toEqual([]);
  });

  it('follows the printer list and stops everything on teardown', () => {
    const t = setup(['p1']);
    const stop = startNotificationProducers(t.api);
    expect(t.listeners('notify_gcode_response')).toBe(1);

    t.setPrinters(['p1', 'p2']);
    expect(t.listeners('notify_gcode_response')).toBe(2);

    t.setPrinters(['p2']);
    expect(t.listeners('notify_gcode_response')).toBe(1);

    stop();
    expect(t.listeners('notify_gcode_response')).toBe(0);
    t.emit('notify_gcode_response', ['!! late']);
    expect(t.pushed).toEqual([]);
  });

  it('adds monitoring only to TMC, host, MCU and CAN health notifications', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const subscriptions: Array<{
      objects: Record<string, string[]>;
      callback: (delta: unknown) => void;
    }> = [];
    const pushed: NotificationInput[] = [];
    const handle = {
      readyState: 'open',
      request: vi.fn(async (method: string) => {
        if (method === 'machine.proc_stats') return { throttled_state: { bits: 0 } };
        if (method === 'printer.objects.list') {
          return { objects: ['tmc2209 stepper_x', 'mcu', 'mcu EBB', 'canbus_stats EBB'] };
        }
        return {};
      }),
      subscribe(objects: Record<string, string[]>, callback: (delta: unknown) => void) {
        subscriptions.push({ objects, callback });
        return () => {};
      },
      onReady: () => () => {},
      onConnectionStatusChange: () => () => {},
      onNotify(event: string, callback: (payload: unknown) => void) {
        handlers.set(event, callback);
        return () => handlers.delete(event);
      },
    } as unknown as MoonrakerProxyHandle;
    const api = {
      printers: [{ id: 'printer /one', name: 'One', url: '' }],
      moonrakerFor: () => handle,
      onPrintersChange: () => () => {},
      notifications: { push: (notification: NotificationInput) => pushed.push(notification) },
      i18n: { t: (key: string) => key, locale: 'en' },
    } as unknown as PluginApi;
    startNotificationProducers(api);
    await Promise.resolve();
    await Promise.resolve();

    subscriptions.find((entry) => 'tmc2209 stepper_x' in entry.objects)?.callback({
      'tmc2209 stepper_x': { drv_status: { ot: true } },
    });
    handlers.get('notify_cpu_throttled')?.([{ bits: 1 }]);
    const health = subscriptions.find((entry) => 'canbus_stats EBB' in entry.objects);
    const stats = (write: number, retransmit: number) => ({
      last_stats: { mcu_awake: 0.01, bytes_write: write, bytes_retransmit: retransmit },
    });
    health?.callback({
      mcu: stats(0, 0),
      'mcu EBB': stats(0, 0),
      'canbus_stats EBB': { bus_state: 'active' },
    });
    health?.callback({
      mcu: stats(10_000, 900),
      'mcu EBB': stats(10_000, 0),
      'canbus_stats EBB': { bus_state: 'passive' },
    });
    handlers.get('notify_gcode_response')?.(['!! A future unknown error']);

    const monitoring = {
      element: 'mpu-system-notification-page-action',
      params: {
        printerId: 'printer /one',
        pageId: 'machine',
        section: 'monitoring',
        labelKey: 'system.notifications.openMonitoring',
      },
    };
    expect(pushed.filter((notification) => notification.label !== 'system.notifications.src.gcode'))
      .not.toHaveLength(0);
    for (const notification of pushed.filter((item) => item.label !== 'system.notifications.src.gcode')) {
      expect(notification.actions).toEqual([monitoring]);
    }
    expect(pushed.find((item) => item.label === 'system.notifications.src.gcode')?.actions).toBeUndefined();
  });

  it('reports command failures without offering an action', () => {
    const pushed: NotificationInput[] = [];
    const api = {
      notifications: { push: (notification: NotificationInput) => pushed.push(notification) },
      i18n: { t: (key: string) => key, locale: 'en' },
    } as unknown as PluginApi;
    reportSystemActionError(api, 'p1', 'restart', new Error('offline'));
    expect(pushed).toEqual([{
      printerId: 'p1',
      severity: 'error',
      text: 'system.errors.actionFailed',
    }]);
  });
});
