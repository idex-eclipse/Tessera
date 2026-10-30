import { describe, expect, it } from 'vitest';

import {
  createAlertGate,
  createHealthWatch,
  diffBusState,
  diffMcuLink,
  diffThrottle,
  MCU_ALERT_GAP_MS,
  THROTTLE_ALERT_GAP_MS,
} from '../health-alerts';
import { RESTART_QUIET_SEC } from '../health-model';
import { parseThrottled, type LinkStatus } from '../health-utils';

const link = (severity: LinkStatus['severity'], reasons: LinkStatus['reasons']): LinkStatus => ({
  severity,
  reasons,
  retransmitRatio: 0,
});

describe('diffThrottle', () => {
  it('stays silent for hosts that do not report throttling', () => {
    expect(diffThrottle(null, parseThrottled(null))).toEqual([]);
  });

  it('reports a flag that just appeared, critical for under-voltage and throttling', () => {
    const cur = parseThrottled({ bits: 0b0101 });
    expect(diffThrottle(parseThrottled({ bits: 0 }), cur)).toEqual([
      { kind: 'throttle', flag: 'undervoltage', severity: 'critical', sticky: true },
      { kind: 'throttle', flag: 'throttled', severity: 'critical', sticky: true },
    ]);
  });

  it('treats frequency capping as a plain error', () => {
    expect(diffThrottle(null, parseThrottled({ bits: 0b0010 }))).toEqual([
      { kind: 'throttle', flag: 'freqCapped', severity: 'error', sticky: false },
    ]);
  });

  it('does not repeat flags that were already set, nor report ones that cleared', () => {
    const prev = parseThrottled({ bits: 0b0001 });
    expect(diffThrottle(prev, parseThrottled({ bits: 0b0001 }))).toEqual([]);
    expect(diffThrottle(prev, parseThrottled({ bits: 0 }))).toEqual([]);
  });

  it('ignores "since boot" bits: those are history, not a live problem', () => {
    expect(diffThrottle(null, parseThrottled({ bits: 0x50000 }))).toEqual([]);
  });
});

describe('diffMcuLink', () => {
  it('reports only reasons that are new', () => {
    const prev = link('warn', ['invalid']);
    const cur = link('warn', ['invalid', 'busErrors']);
    expect(diffMcuLink('EBB', prev, cur)).toEqual([
      { kind: 'mcuLink', mcu: 'EBB', reason: 'busErrors', severity: 'error', sticky: false },
    ]);
  });

  it('escalates heavy retransmits to a sticky critical alert', () => {
    expect(diffMcuLink('mcu', null, link('crit', ['retransmit']))).toEqual([
      { kind: 'mcuLink', mcu: 'mcu', reason: 'retransmit', severity: 'critical', sticky: true },
    ]);
    expect(diffMcuLink('mcu', null, link('warn', ['retransmit']))[0]).toMatchObject({ severity: 'error' });
  });

  it('leaves load and bus state to other detectors', () => {
    expect(diffMcuLink('mcu', null, link('warn', ['highLoad', 'busState']))).toEqual([]);
  });
});

describe('diffBusState', () => {
  it('reports a transition away from active', () => {
    expect(diffBusState('EBB', 'active', 'passive')).toEqual([
      { kind: 'canbus', mcu: 'EBB', state: 'passive', severity: 'critical', sticky: true },
    ]);
    expect(diffBusState('EBB', 'active', 'warning')).toEqual([
      { kind: 'canbus', mcu: 'EBB', state: 'warning', severity: 'error', sticky: false },
    ]);
  });

  it('is silent when healthy, unknown or unchanged', () => {
    expect(diffBusState('EBB', undefined, 'active')).toEqual([]);
    expect(diffBusState('EBB', 'active', undefined)).toEqual([]);
    expect(diffBusState('EBB', 'off', 'off')).toEqual([]);
  });

  it('reports a bus that is already bad on the first look', () => {
    expect(diffBusState('EBB', undefined, 'off')).toHaveLength(1);
  });
});

describe('createAlertGate', () => {
  it('lets an event through once per gap', () => {
    let t = 0;
    const gate = createAlertGate(() => t);
    expect(gate.allow('k', 1000)).toBe(true);
    t = 999;
    expect(gate.allow('k', 1000)).toBe(false);
    t = 1000;
    expect(gate.allow('k', 1000)).toBe(true);
  });

  it('keys are independent', () => {
    const gate = createAlertGate(() => 0);
    expect(gate.allow('a', 1000)).toBe(true);
    expect(gate.allow('b', 1000)).toBe(true);
  });
});

describe('createHealthWatch', () => {
  const stats = (write: number, retransmit: number, extra: Record<string, number> = {}) => ({
    last_stats: { mcu_awake: 0.01, bytes_write: write, bytes_retransmit: retransmit, ...extra },
  });

  it('raises one notification when retransmits start, and not again while they persist', () => {
    let now = 1_000_000;
    const w = createHealthWatch(() => now);

    expect(w.onDelta({ mcu: stats(0, 0) })).toEqual([]);

    now += 1000;
    const first = w.onDelta({ mcu: stats(10000, 900) });
    expect(first).toEqual([
      { kind: 'mcuLink', mcu: 'mcu', reason: 'retransmit', severity: 'critical', sticky: true },
    ]);

    now += 1000;
    expect(w.onDelta({ mcu: stats(20000, 1800) })).toEqual([]);
  });

  it('lets the same alert through again after the gap, once it has cleared and returned', () => {
    let now = 0;
    const w = createHealthWatch(() => now);
    const bad = (n: number) => ({ mcu: stats(n * 10000, n * 900) });

    w.onDelta({ mcu: stats(0, 0) });
    now = 1000;
    expect(w.onDelta(bad(1))).toHaveLength(1);

    // связь восстановилась: окно ушло вперёд, ретрансмиты прекратились
    now = 200_000;
    expect(w.onDelta({ mcu: stats(30000, 900) })).toEqual([]);

    now = 200_000 + 1000;
    expect(w.onDelta({ mcu: stats(40000, 2000) })).toHaveLength(1);
  });

  it('suppresses a flapping CAN bus inside the gap, then lets it through', () => {
    let now = 0;
    const w = createHealthWatch(() => now);
    const bus = (state: string) => ({ 'mcu EBB': stats(0, 0), 'canbus_stats EBB': { bus_state: state } });

    w.onDelta(bus('active'));
    now = 1000;
    expect(w.onDelta(bus('passive'))).toHaveLength(1);

    // шина мигнула в active и снова упала через 5 с — тот же алерт глушим
    now = 3000;
    w.onDelta(bus('active'));
    now = 6000;
    expect(w.onDelta(bus('passive'))).toEqual([]);

    now = 1000 + MCU_ALERT_GAP_MS;
    w.onDelta(bus('active'));
    expect(w.onDelta(bus('passive'))).toHaveLength(1);
  });

  describe('Klipper restart', () => {
    it('does not raise a retransmit alert while Klipper restarts, nor in the quiet period after it', () => {
      let now = 1_000_000;
      const w = createHealthWatch(() => now);
      w.onDelta({ mcu: stats(0, 0) });

      w.klippyReady(false); // notify_klippy_disconnected / shutdown / started
      now += 2000;
      expect(w.onDelta({ mcu: stats(10000, 3000) })).toEqual([]);

      w.klippyReady(true); // notify_klippy_ready — MCU ещё довыставляет связь
      now += 5000;
      expect(w.onDelta({ mcu: stats(20000, 6000) })).toEqual([]);
    });

    it('goes back to alerting once the quiet period is over', () => {
      let now = 0;
      const w = createHealthWatch(() => now);
      w.onDelta({ mcu: stats(0, 0) });
      w.klippyReady(false);
      w.klippyReady(true);

      now = RESTART_QUIET_SEC * 1000 + 1000;
      expect(w.onDelta({ mcu: stats(1000, 0) })).toEqual([]); // чистая база после паузы
      now += 1000;
      expect(w.onDelta({ mcu: stats(11000, 900) })).toEqual([
        { kind: 'mcuLink', mcu: 'mcu', reason: 'retransmit', severity: 'critical', sticky: true },
      ]);
    });

    it('does not report a CAN bus that drops while MCUs reconnect, but does if it stays down', () => {
      let now = 0;
      const w = createHealthWatch(() => now);
      const bus = (state: string) => ({ 'mcu EBB': stats(0, 0), 'canbus_stats EBB': { bus_state: state } });

      w.onDelta(bus('active'));
      w.klippyReady(false);
      w.klippyReady(true);

      now = 2000;
      expect(w.onDelta(bus('off'))).toEqual([]);

      now = RESTART_QUIET_SEC * 1000 + 1000;
      expect(w.onDelta(bus('off'))).toEqual([
        { kind: 'canbus', mcu: 'EBB', state: 'off', severity: 'critical', sticky: true },
      ]);
    });

    it('does not silence host throttling', () => {
      let now = 0;
      const w = createHealthWatch(() => now);
      w.klippyReady(false);
      now = 1000;
      expect(w.onThrottle({ bits: 1 })).toHaveLength(1);
    });
  });

  it('reports a CAN bus going bad and ignores a healthy one', () => {
    const w = createHealthWatch(() => 0);
    expect(w.onDelta({ 'mcu EBB': stats(0, 0), 'canbus_stats EBB': { bus_state: 'active' } })).toEqual([]);
    expect(w.onDelta({ 'canbus_stats EBB': { bus_state: 'passive' } })).toEqual([
      { kind: 'canbus', mcu: 'EBB', state: 'passive', severity: 'critical', sticky: true },
    ]);
  });

  it('reports throttling once per gap', () => {
    let now = 0;
    const w = createHealthWatch(() => now);

    expect(w.onThrottle({ bits: 0 })).toEqual([]);
    now = 1000;
    expect(w.onThrottle({ bits: 1 })).toEqual([
      { kind: 'throttle', flag: 'undervoltage', severity: 'critical', sticky: true },
    ]);

    // флаг мигнул и вернулся внутри окна антидребезга
    now = 2000;
    w.onThrottle({ bits: 0 });
    now = 3000;
    expect(w.onThrottle({ bits: 1 })).toEqual([]);

    now = 1000 + THROTTLE_ALERT_GAP_MS;
    w.onThrottle({ bits: 0 });
    expect(w.onThrottle({ bits: 1 })).toHaveLength(1);
  });

  it('survives garbage and unsupported hosts', () => {
    const w = createHealthWatch(() => 0);
    expect(w.onDelta(null)).toEqual([]);
    expect(w.onDelta({ toolhead: { stalls: 1 } })).toEqual([]);
    expect(w.onThrottle(null)).toEqual([]);
    expect(w.onThrottle(undefined)).toEqual([]);
  });

  it('forgets MCUs that left the config, so one that comes back is judged afresh', () => {
    let now = 0;
    const w = createHealthWatch(() => now);
    const bad = { 'mcu EBB': stats(0, 0), 'canbus_stats EBB': { bus_state: 'passive' } };

    expect(w.onDelta(bad)).toHaveLength(1);
    now = 10 * 60_000;
    expect(w.onDelta(bad)).toEqual([]); // всё ещё passive — повтора нет

    w.retain(new Set(['mcu'])); // EBB убрали из конфига
    expect(w.onDelta(bad)).toHaveLength(1); // вернулся — смотрим как в первый раз
  });
});
