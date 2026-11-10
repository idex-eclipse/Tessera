import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MoonrakerProxyHandle,
  NotificationInput,
  PluginApi,
  PluginSettingsApi,
} from '../../../plugin-sdk/src/types';
import {
  advanceHeaterDeviation,
  initialHeaterDeviationState,
  startNotificationProducers,
  subscribeHeaterDeviationAlerts,
  type HeaterDeviationSample,
  type HeaterDeviationState,
} from '../notifications';

const WITHIN: HeaterDeviationSample = {
  deviation: 1,
  threshold: 5,
  printing: false,
  suppressed: false,
};

/** Advances a fresh detector through its required 45-second stable period. */
function settledState(start = 0): HeaterDeviationState {
  let state = initialHeaterDeviationState(start);
  state = advanceHeaterDeviation(state, WITHIN, start).state;
  return advanceHeaterDeviation(state, WITHIN, start + 45_000).state;
}

describe('heater deviation detector', () => {
  it('requires settling and then the normal 20-second hold', () => {
    let state = initialHeaterDeviationState(0);
    state = advanceHeaterDeviation(state, WITHIN, 0).state;
    state = advanceHeaterDeviation(state, WITHIN, 44_999).state;
    expect(state.phase).toBe('settle');
    state = advanceHeaterDeviation(state, WITHIN, 45_000).state;
    expect(state.phase).toBe('watch');

    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 46_000).state;
    expect(advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 65_999).notify).toBe(false);
    const alert = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 66_000);
    expect(alert.notify).toBe(true);
    expect(alert.state.active).toBe(true);
  });

  it('doubles the hold while printing or paused', () => {
    let state = settledState();
    const outside = { ...WITHIN, deviation: 7, printing: true };
    state = advanceHeaterDeviation(state, outside, 46_000).state;
    expect(advanceHeaterDeviation(state, outside, 85_999).notify).toBe(false);
    expect(advanceHeaterDeviation(state, outside, 86_000).notify).toBe(true);
  });

  it('recovers below half the threshold and preserves cooldown rearming', () => {
    let state = settledState();
    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 46_000).state;
    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 66_000).state;
    expect(advanceHeaterDeviation(state, { ...WITHIN, deviation: 3 }, 70_000).state.active).toBe(true);

    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 2 }, 71_000).state;
    expect(state).toMatchObject({ phase: 'cooldown', active: false });
    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 72_000).state;
    expect(state).toMatchObject({ phase: 'watch', outsideSince: 72_000 });
    expect(advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 92_000).notify).toBe(true);
  });

  it('repeats a persistent alert after 300 seconds', () => {
    let state = settledState();
    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 46_000).state;
    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 66_000).state;
    expect(advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 365_999).notify).toBe(false);
    expect(advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 366_000).notify).toBe(true);
  });

  it('a threshold reset starts a new settle cycle', () => {
    let state = settledState();
    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7 }, 46_000).state;
    state = initialHeaterDeviationState(50_000);
    expect(advanceHeaterDeviation(state, { ...WITHIN, deviation: 7, threshold: 8 }, 70_000).notify).toBe(false);
    state = advanceHeaterDeviation(state, { ...WITHIN, deviation: 7, threshold: 8 }, 71_000).state;
    expect(state.phase).toBe('settle');
  });
});

/** Captured status subscription used to drive producer deltas deterministically. */
interface FakeSubscription {
  objects: Record<string, string[]>;
  callback: (delta: unknown) => void;
  active: boolean;
}

/** Mutable fake services and listeners belonging to one printer. */
interface FakePrinter {
  objects: string[];
  gcodeStore: Array<{ message: string; type?: string }>;
  requests: string[];
  subscriptions: FakeSubscription[];
  handlers: Map<string, Set<(value: unknown) => void>>;
  connectionHandlers: Set<(status: string) => void>;
  readyHandlers: Set<() => void>;
  threshold: unknown;
  settingsHandlers: Set<() => void>;
}

/** Creates a controllable multi-printer Moonraker and settings facade. */
function producerHarness(initialIds: string[]) {
  let ids = [...initialIds];
  let printersChanged: (() => void) | null = null;
  const pushed: NotificationInput[] = [];
  const printers = new Map<string, FakePrinter>();

  const getPrinter = (printerId: string): FakePrinter => {
    let printer = printers.get(printerId);
    if (!printer) {
      printer = {
        objects: ['print_stats', 'extruder', 'extruder1', 'heater_bed', 'heater_generic chamber', 'fan'],
        gcodeStore: [],
        requests: [],
        subscriptions: [],
        handlers: new Map(),
        connectionHandlers: new Set(),
        readyHandlers: new Set(),
        threshold: 5,
        settingsHandlers: new Set(),
      };
      printers.set(printerId, printer);
    }
    return printer;
  };

  const moonrakerFor = (printerId: string): MoonrakerProxyHandle => {
    const printer = getPrinter(printerId);
    return {
      readyState: 'open',
      async request(method: string) {
        printer.requests.push(method);
        if (method === 'printer.objects.list') return { objects: [...printer.objects] };
        if (method === 'server.gcode_store') return { gcode_store: [...printer.gcodeStore] };
        return {};
      },
      subscribe(objects: Record<string, string[]>, callback: (delta: unknown) => void) {
        const subscription = { objects, callback, active: true };
        printer.subscriptions.push(subscription);
        return () => { subscription.active = false; };
      },
      onReady(callback: () => void) {
        printer.readyHandlers.add(callback);
        return () => printer.readyHandlers.delete(callback);
      },
      onConnectionStatusChange(callback: (status: string) => void) {
        printer.connectionHandlers.add(callback);
        return () => printer.connectionHandlers.delete(callback);
      },
      onNotify(event: string, callback: (value: unknown) => void) {
        const handlers = printer.handlers.get(event) ?? new Set();
        handlers.add(callback);
        printer.handlers.set(event, handlers);
        return () => handlers.delete(callback);
      },
    } as unknown as MoonrakerProxyHandle;
  };

  const settingsFor = (printerId: string): PluginSettingsApi => {
    const printer = getPrinter(printerId);
    return {
      get: () => printer.threshold,
      set: vi.fn(),
      onChange(callback: () => void) {
        printer.settingsHandlers.add(callback);
        return () => printer.settingsHandlers.delete(callback);
      },
    } as unknown as PluginSettingsApi;
  };

  const api = {
    get printers() {
      return ids.map((id) => ({ id, name: id, url: '' }));
    },
    moonrakerFor,
    settingsFor,
    onPrintersChange(callback: () => void) {
      printersChanged = callback;
      return () => { printersChanged = null; };
    },
    notifications: { push: (notification: NotificationInput) => pushed.push(notification) },
    i18n: {
      locale: 'en',
      t: (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`,
    },
  } as unknown as PluginApi;

  return {
    api,
    pushed,
    printer: getPrinter,
    emitStatus(printerId: string, delta: unknown) {
      for (const subscription of getPrinter(printerId).subscriptions) {
        if (subscription.active) subscription.callback(delta);
      }
    },
    emitNotify(printerId: string, event: string, value: unknown = []) {
      for (const callback of getPrinter(printerId).handlers.get(event) ?? []) callback(value);
    },
    emitConnection(printerId: string, status: string) {
      for (const callback of getPrinter(printerId).connectionHandlers) callback(status);
    },
    setThreshold(printerId: string, value: unknown) {
      const printer = getPrinter(printerId);
      printer.threshold = value;
      for (const callback of printer.settingsHandlers) callback();
    },
    setPrinters(next: string[]) {
      ids = [...next];
      printersChanged?.();
    },
  };
}

/** Lets the producer finish its request-driven discovery work. */
async function flushProducer(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('calibrations notification producer', () => {
  it('discovers every supported heater with one status subscription', async () => {
    const harness = producerHarness(['p1']);
    const stop = startNotificationProducers(harness.api);
    await flushProducer();

    const active = harness.printer('p1').subscriptions.filter((subscription) => subscription.active);
    expect(active).toHaveLength(1);
    expect(active[0]!.objects).toEqual({
      print_stats: ['state'],
      extruder: ['temperature', 'target'],
      extruder1: ['temperature', 'target'],
      heater_bed: ['temperature', 'target'],
      'heater_generic chamber': ['temperature', 'target'],
    });
    stop();
  });

  it('keeps independent heater and printer state and exposes generic heater UI ids', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const harness = producerHarness(['p1', 'p2']);
    const snapshots: Array<readonly { printerId: string; heaterId: string }[]> = [];
    const offAlerts = subscribeHeaterDeviationAlerts((alerts) => snapshots.push(alerts));
    const stop = startNotificationProducers(harness.api);
    await flushProducer();

    for (const printerId of ['p1', 'p2']) {
      harness.emitStatus(printerId, {
        print_stats: { state: 'standby' },
        extruder: { temperature: 200, target: 200 },
        'heater_generic chamber': { temperature: 60, target: 60 },
      });
    }
    vi.advanceTimersByTime(45_000);
    for (const printerId of ['p1', 'p2']) {
      harness.emitStatus(printerId, {
        extruder: { temperature: 200, target: 200 },
        'heater_generic chamber': { temperature: 60, target: 60 },
      });
    }
    harness.emitStatus('p1', { 'heater_generic chamber': { temperature: 70, target: 60 } });
    harness.emitStatus('p2', { extruder: { temperature: 190, target: 200 } });
    vi.advanceTimersByTime(20_000);
    harness.emitStatus('p1', { 'heater_generic chamber': { temperature: 70, target: 60 } });
    harness.emitStatus('p2', { extruder: { temperature: 190, target: 200 } });

    expect(harness.pushed.map((notification) => notification.printerId).sort()).toEqual(['p1', 'p2']);
    expect(harness.pushed.find((notification) => notification.printerId === 'p1')?.actions).toEqual([
      {
        element: 'mpu-calibrations-notification-page-action',
        params: {
          printerId: 'p1',
          pageId: 'calibrations',
          section: 'heaters',
          heater: 'chamber',
          labelKey: 'calibrations.heaters.openHeaters',
        },
      },
    ]);
    expect(snapshots.at(-1)?.map((alert) => [alert.printerId, alert.heaterId]).sort()).toEqual([
      ['p1', 'chamber'],
      ['p2', 'extruder'],
    ]);
    stop();
    offAlerts();
  });

  it('reattaches after config/reconnect and detaches removed printers and teardown', async () => {
    const harness = producerHarness(['p1']);
    const stop = startNotificationProducers(harness.api);
    await flushProducer();
    expect(harness.printer('p1').subscriptions.filter((item) => item.active)).toHaveLength(1);

    harness.emitNotify('p1', 'notify_config_changed');
    await flushProducer();
    expect(harness.printer('p1').requests.filter((method) => method === 'printer.objects.list')).toHaveLength(2);
    expect(harness.printer('p1').subscriptions.filter((item) => item.active)).toHaveLength(1);

    harness.emitConnection('p1', 'closed');
    expect(harness.printer('p1').subscriptions.some((item) => item.active)).toBe(false);
    harness.emitConnection('p1', 'open');
    await flushProducer();
    expect(harness.printer('p1').requests.filter((method) => method === 'printer.objects.list')).toHaveLength(3);

    harness.setPrinters(['p2']);
    await flushProducer();
    expect(harness.printer('p1').subscriptions.some((item) => item.active)).toBe(false);
    expect(harness.printer('p1').handlers.get('notify_gcode_response')?.size ?? 0).toBe(0);
    expect(harness.printer('p2').subscriptions.filter((item) => item.active)).toHaveLength(1);
    stop();
    expect(harness.printer('p2').subscriptions.some((item) => item.active)).toBe(false);
  });

  it('resets an unfinished detector when the per-printer threshold changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const harness = producerHarness(['p1']);
    const stop = startNotificationProducers(harness.api);
    await flushProducer();

    harness.emitStatus('p1', { extruder: { temperature: 200, target: 200 } });
    vi.advanceTimersByTime(45_000);
    harness.emitStatus('p1', { extruder: { temperature: 200, target: 200 } });
    harness.emitStatus('p1', { extruder: { temperature: 210, target: 200 } });
    harness.setThreshold('p1', 4);
    vi.advanceTimersByTime(20_000);
    harness.emitStatus('p1', { extruder: { temperature: 210, target: 200 } });
    expect(harness.pushed).toEqual([]);
    stop();
  });

  it('suppresses active PID calibration until a result resets the detector', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    const harness = producerHarness(['p1']);
    harness.printer('p1').gcodeStore = [
      { type: 'command', message: 'PID_CALIBRATE HEATER=extruder TARGET=200' },
    ];
    const stop = startNotificationProducers(harness.api);
    await flushProducer();

    harness.emitStatus('p1', { extruder: { temperature: 200, target: 200 } });
    vi.advanceTimersByTime(45_000);
    harness.emitStatus('p1', { extruder: { temperature: 200, target: 200 } });
    harness.emitStatus('p1', { extruder: { temperature: 220, target: 200 } });
    vi.advanceTimersByTime(40_000);
    harness.emitStatus('p1', { extruder: { temperature: 220, target: 200 } });
    expect(harness.pushed).toEqual([]);

    harness.printer('p1').gcodeStore.push({ type: 'response', message: 'Kp:1.0 Ki:2.0 Kd:3.0' });
    harness.emitNotify('p1', 'notify_gcode_response');
    await vi.advanceTimersByTimeAsync(500);
    await flushProducer();
    harness.emitStatus('p1', { extruder: { temperature: 200, target: 200 } });
    vi.advanceTimersByTime(45_000);
    harness.emitStatus('p1', { extruder: { temperature: 200, target: 200 } });
    harness.emitStatus('p1', { extruder: { temperature: 220, target: 200 } });
    vi.advanceTimersByTime(20_000);
    harness.emitStatus('p1', { extruder: { temperature: 220, target: 200 } });
    expect(harness.pushed).toHaveLength(1);
    stop();
  });
});
