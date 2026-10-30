import { describe, expect, it } from 'vitest';

import { createHealthModel, HEALTH_CAP } from '../health-model';
import {
  busStateSeverity,
  canbusMcuName,
  counterDelta,
  cpuTempSeverity,
  decodeDrvStatus,
  formatUptime,
  hostSeverity,
  isFlagSet,
  linkSample,
  matchCanbus,
  matchMcu,
  matchTmc,
  mcuLinkStatus,
  mcuShortName,
  parseCanbus,
  parseLastStats,
  parseThrottled,
  parseTmcName,
  pushLinkSample,
  summarize,
  tmcState,
  worstSeverity,
  type LinkSample,
} from '../health-utils';

describe('formatUptime', () => {
  const u = { d: 'd', h: 'h', m: 'm' };

  it('keeps the two most significant units', () => {
    expect(formatUptime(30, u)).toBe('0m');
    expect(formatUptime(7 * 60 + 5, u)).toBe('7m');
    expect(formatUptime(5 * 3600 + 12 * 60, u)).toBe('5h 12m');
    expect(formatUptime(3 * 86400 + 4 * 3600 + 59, u)).toBe('3d 4h');
  });

  it('clamps negatives', () => {
    expect(formatUptime(-10, u)).toBe('0m');
  });
});

describe('object names', () => {
  it('matches mcu, canbus_stats and tmc objects but not lookalikes', () => {
    expect(matchMcu('mcu')).toBe(true);
    expect(matchMcu('mcu EBB')).toBe(true);
    expect(matchMcu('temperature_mcu')).toBe(false);
    expect(matchMcu('mcuX')).toBe(false);

    expect(matchCanbus('canbus_stats EBB')).toBe(true);
    expect(matchCanbus('canbus_stats mcu')).toBe(true);
    expect(matchCanbus('mcu EBB')).toBe(false);

    expect(matchTmc('tmc2209 stepper_x')).toBe(true);
    expect(matchTmc('tmc5160 stepper_z')).toBe(true);
    expect(matchTmc('tmc2209')).toBe(true);
    expect(matchTmc('tmc_foo')).toBe(false);
  });

  it('maps mcu and canbus_stats objects to the same short name', () => {
    expect(mcuShortName('mcu')).toBe('mcu');
    expect(mcuShortName('mcu EBB')).toBe('EBB');
    expect(canbusMcuName('canbus_stats EBB')).toBe('EBB');
    expect(canbusMcuName('canbus_stats mcu')).toBe('mcu');
  });

  it('splits a tmc object name into driver type and stepper', () => {
    expect(parseTmcName('tmc2209 stepper_x')).toEqual({ type: 'tmc2209', stepper: 'stepper_x' });
    expect(parseTmcName('tmc2240 extruder')).toEqual({ type: 'tmc2240', stepper: 'extruder' });
  });
});

describe('severity', () => {
  it('picks the worst, and unknown never hides a known state', () => {
    expect(worstSeverity('ok', 'warn', 'crit')).toBe('crit');
    expect(worstSeverity('unknown', 'ok')).toBe('ok');
    expect(worstSeverity('unknown', 'unknown')).toBe('unknown');
    expect(worstSeverity()).toBe('unknown');
  });
});

describe('parseThrottled', () => {
  it('treats null / garbage as "not supported"', () => {
    for (const raw of [null, undefined, 0, 'x', { flags: 'x' }, {}]) {
      const t = parseThrottled(raw);
      expect(t.supported, String(raw)).toBe(false);
      expect(t.severity).toBe('unknown');
    }
  });

  it('reads a clean Raspberry Pi as ok', () => {
    const t = parseThrottled({ bits: 0, flags: [] });
    expect(t).toMatchObject({ supported: true, now: [], past: [], severity: 'ok' });
  });

  it('decodes "now" bits 0–3', () => {
    expect(parseThrottled({ bits: 0b0001 }).now).toEqual(['undervoltage']);
    expect(parseThrottled({ bits: 0b1010 }).now).toEqual(['freqCapped', 'tempLimit']);
  });

  it('decodes "since boot" bits 16–19 separately from "now"', () => {
    const t = parseThrottled({ bits: 0x50000 }); // 16 + 18
    expect(t.now).toEqual([]);
    expect(t.past).toEqual(['undervoltage', 'throttled']);
    expect(t.severity).toBe('ok');
  });

  it('rates under-voltage and throttling critical, other live flags a warning', () => {
    expect(parseThrottled({ bits: 0b0001 }).severity).toBe('crit');
    expect(parseThrottled({ bits: 0b0100 }).severity).toBe('crit');
    expect(parseThrottled({ bits: 0b0010 }).severity).toBe('warn');
    expect(parseThrottled({ bits: 0b1000 }).severity).toBe('warn');
  });

  it('falls back to the flag names when bits is missing', () => {
    const t = parseThrottled({ flags: ['Under-Voltage Detected', 'Previously Throttled'] });
    expect(t.supported).toBe(true);
    expect(t.now).toEqual(['undervoltage']);
    expect(t.past).toEqual(['throttled']);
  });
});

describe('host severity', () => {
  it('rates CPU temperature with a warning at 80 and critical at 85', () => {
    expect(cpuTempSeverity(60)).toBe('ok');
    expect(cpuTempSeverity(80)).toBe('warn');
    expect(cpuTempSeverity(84.9)).toBe('warn');
    expect(cpuTempSeverity(85)).toBe('crit');
    expect(cpuTempSeverity(null)).toBe('unknown');
    expect(cpuTempSeverity(NaN)).toBe('unknown');
  });

  it('combines throttling with temperature, so a non-Pi host is still covered', () => {
    expect(hostSeverity(parseThrottled(null), 82)).toBe('warn');
    expect(hostSeverity(parseThrottled({ bits: 0 }), 50)).toBe('ok');
    expect(hostSeverity(parseThrottled({ bits: 1 }), 50)).toBe('crit');
    expect(hostSeverity(parseThrottled(null), null)).toBe('unknown');
  });
});

describe('parseLastStats', () => {
  it('maps the snake_case fields and drops non-numbers', () => {
    const s = parseLastStats({
      mcu_awake: 0.012,
      mcu_task_avg: 0.000004,
      bytes_write: 1000,
      bytes_retransmit: '5',
      srtt: Infinity,
      freq: 72000000,
      unknown_field: 1,
    });
    expect(s).toEqual({ awake: 0.012, taskAvg: 0.000004, bytesWrite: 1000, freq: 72000000 });
  });

  it('survives garbage', () => {
    expect(parseLastStats(null)).toEqual({});
    expect(parseLastStats('x')).toEqual({});
  });
});

describe('counterDelta', () => {
  it('returns the increase', () => {
    expect(counterDelta(10, 25)).toBe(15);
    expect(counterDelta(5, 5)).toBe(0);
  });

  it('rebases after a counter reset instead of going negative', () => {
    expect(counterDelta(5000, 12)).toBe(0);
  });

  it('is null when either side is missing', () => {
    expect(counterDelta(undefined, 5)).toBeNull();
    expect(counterDelta(5, undefined)).toBeNull();
  });
});

describe('parseCanbus', () => {
  it('requires bus_state and keeps the optional counters', () => {
    expect(parseCanbus({ bus_state: 'active', rx_error: 1, tx_error: 2, tx_retries: 3 })).toEqual({
      state: 'active',
      rxError: 1,
      txError: 2,
      txRetries: 3,
    });
    expect(parseCanbus({ rx_error: 1 })).toBeNull();
    expect(parseCanbus(null)).toBeNull();
  });

  it('rates the bus state', () => {
    expect(busStateSeverity('active')).toBe('ok');
    expect(busStateSeverity('warning')).toBe('warn');
    expect(busStateSeverity('passive')).toBe('crit');
    expect(busStateSeverity('off')).toBe('crit');
    expect(busStateSeverity(undefined)).toBe('unknown');
  });
});

describe('link quality', () => {
  const snap = (awake = 0.01, bus: ReturnType<typeof parseCanbus> = null) => ({
    stats: { awake },
    bus,
  });
  const sample = (t: number, o: Partial<LinkSample> = {}): LinkSample => ({
    t,
    write: 0,
    retransmit: 0,
    invalid: 0,
    busErrors: 0,
    ...o,
  });

  it('builds a sample from counter deltas, zero on the first snapshot', () => {
    const a = { stats: { bytesWrite: 100, bytesRetransmit: 1, bytesInvalid: 0 }, bus: null };
    const b = { stats: { bytesWrite: 160, bytesRetransmit: 4, bytesInvalid: 2 }, bus: null };
    expect(linkSample(10, null, a)).toEqual(sample(10));
    expect(linkSample(11, a, b)).toEqual(sample(11, { write: 60, retransmit: 3, invalid: 2 }));
  });

  it('counts CAN rx/tx errors as bus errors', () => {
    const a = { stats: {}, bus: { state: 'active', rxError: 1, txError: 0 } };
    const b = { stats: {}, bus: { state: 'active', rxError: 3, txError: 1 } };
    expect(linkSample(1, a, b).busErrors).toBe(3);
  });

  it('keeps only the last window', () => {
    let w: LinkSample[] = [];
    for (let t = 0; t <= 100; t += 10) w = pushLinkSample(w, sample(t), 60);
    expect(w[0]!.t).toBe(50);
    expect(w.at(-1)!.t).toBe(100);
  });

  it('is unknown without a snapshot and ok on a quiet link', () => {
    expect(mcuLinkStatus([], null).severity).toBe('unknown');
    expect(mcuLinkStatus([sample(1, { write: 5000 })], snap())).toMatchObject({
      severity: 'ok',
      reasons: [],
    });
  });

  it('ignores a few retransmitted bytes on an idle link', () => {
    const w = [sample(1, { write: 200, retransmit: 20 })]; // 10%, but under the byte floor
    expect(mcuLinkStatus(w, snap()).severity).toBe('ok');
  });

  it('warns above 1% and goes critical above 5% retransmits', () => {
    const warn = mcuLinkStatus([sample(1, { write: 10000, retransmit: 200 })], snap());
    expect(warn.severity).toBe('warn');
    expect(warn.reasons).toEqual(['retransmit']);

    const crit = mcuLinkStatus([sample(1, { write: 10000, retransmit: 800 })], snap());
    expect(crit.severity).toBe('crit');
    expect(crit.retransmitRatio).toBeCloseTo(0.08);
  });

  it('warns on invalid bytes and on a busy MCU', () => {
    expect(mcuLinkStatus([sample(1, { invalid: 1 })], snap()).reasons).toEqual(['invalid']);
    expect(mcuLinkStatus([], snap(0.9)).reasons).toEqual(['highLoad']);
    expect(mcuLinkStatus([], snap(0.85)).severity).toBe('ok');
  });

  it('rates the CAN bus state and errors', () => {
    const active = parseCanbus({ bus_state: 'active' });
    const passive = parseCanbus({ bus_state: 'passive' });
    expect(mcuLinkStatus([], snap(0.01, passive)).severity).toBe('crit');
    expect(mcuLinkStatus([sample(1, { busErrors: 2 })], snap(0.01, active))).toMatchObject({
      severity: 'warn',
      reasons: ['busErrors'],
    });
  });
});

describe('decodeDrvStatus', () => {
  it('treats a missing drv_status as "not responding"', () => {
    for (const raw of [null, undefined, 'x']) {
      expect(decodeDrvStatus(raw)).toMatchObject({ responding: false, severity: 'warn' });
    }
  });

  it('is ok when no error flag is set, and keeps numeric fields', () => {
    const d = decodeDrvStatus({ otpw: 0, ot: false, s2ga: null, cs_actual: 12, stealth: 1 });
    expect(d).toMatchObject({ responding: true, errors: [], severity: 'ok' });
    expect(d.values).toEqual({ cs_actual: 12, stealth: 1 });
  });

  it('flags a pre-warning as a warning', () => {
    const d = decodeDrvStatus({ otpw: 1 });
    expect(d.errors).toEqual(['otpw']);
    expect(d.critical).toEqual([]);
    expect(d.severity).toBe('warn');
  });

  it('flags overtemperature and short-to-ground as critical', () => {
    const d = decodeDrvStatus({ ot: 1, s2ga: true, otpw: 1 });
    expect(d.critical).toEqual(['ot', 's2ga']);
    expect(d.severity).toBe('crit');
  });

  it('reports driver temperature thresholds as a warning', () => {
    const d = decodeDrvStatus({ t120: 1, t143: 0 });
    expect(d.temp).toEqual(['t120']);
    expect(d.severity).toBe('warn');
  });

  it('shares the flag predicate with the notifications', () => {
    expect(isFlagSet(1)).toBe(true);
    expect(isFlagSet(true)).toBe(true);
    expect(isFlagSet(0)).toBe(false);
    expect(isFlagSet(false)).toBe(false);
    expect(isFlagSet(null)).toBe(false);
    expect(isFlagSet(undefined)).toBe(false);
  });
});

describe('tmcState', () => {
  const silent = decodeDrvStatus(null);
  const talking = decodeDrvStatus({ otpw: 1 });

  it('a driver of a disabled motor is idle, not an error: Klipper only reads it while the motor is on', () => {
    expect(tmcState(silent, false)).toEqual({ severity: 'unknown', idle: true, noResponse: false });
  });

  it('is idle too when the motor state is unknown', () => {
    expect(tmcState(silent, null)).toEqual({ severity: 'unknown', idle: true, noResponse: false });
  });

  it('a silent driver of an enabled motor is a real problem', () => {
    expect(tmcState(silent, true)).toEqual({ severity: 'warn', idle: false, noResponse: true });
  });

  it('judges a responding driver by its flags regardless of the motor', () => {
    expect(tmcState(talking, false)).toEqual({ severity: 'warn', idle: false, noResponse: false });
    expect(tmcState(decodeDrvStatus({}), true)).toEqual({ severity: 'ok', idle: false, noResponse: false });
  });
});

describe('summarize', () => {
  const base = { klippyReady: true, host: 'ok' as const, mcus: ['ok' as const], drivers: ['ok' as const] };

  it('reports drivers as idle only when every one of them is', () => {
    const two = { ...base, drivers: ['unknown' as const, 'unknown' as const] };
    expect(summarize({ ...two, driversIdle: 2 })).toMatchObject({ drivers: 'unknown', driversIdle: true });
    expect(summarize({ ...two, driversIdle: 1 }).driversIdle).toBe(false);
    expect(summarize({ ...base, drivers: [] }).driversIdle).toBe(false);
    expect(summarize({ ...two, driversIdle: 2, klippyReady: false }).driversIdle).toBe(false);
  });

  it('idle drivers never raise attention', () => {
    expect(summarize({ ...base, drivers: ['unknown'], driversIdle: 1 }).attention).toBe(false);
  });

  it('is calm when everything is ok', () => {
    expect(summarize(base)).toMatchObject({ host: 'ok', mcu: 'ok', drivers: 'ok', attention: false });
  });

  it('counts MCUs and drivers with problems and raises attention', () => {
    const s = summarize({ ...base, mcus: ['ok', 'warn', 'crit'], drivers: ['warn', 'ok'] });
    expect(s).toMatchObject({ mcu: 'crit', mcuIssues: 2, drivers: 'warn', driverIssues: 1, attention: true });
  });

  it('flags the host alone', () => {
    expect(summarize({ ...base, host: 'crit' }).attention).toBe(true);
  });

  it('does not trust stale MCU / driver data while Klipper is not ready', () => {
    const s = summarize({ ...base, klippyReady: false, mcus: ['crit'], drivers: ['crit'] });
    expect(s).toMatchObject({ mcu: 'unknown', drivers: 'unknown', mcuIssues: 0, driverIssues: 0, attention: false });
  });

  it('is unknown, not ok, when nothing is configured', () => {
    expect(summarize({ ...base, mcus: [], drivers: [] })).toMatchObject({ mcu: 'unknown', drivers: 'unknown' });
  });
});

describe('health model', () => {
  const mcuDelta = (stats: Record<string, number>, extra: Record<string, unknown> = {}) => ({
    mcu: { mcu_version: 'v0.12', mcu_constants: { CLOCK_FREQ: 72000000 }, last_stats: stats, ...extra },
  });

  it('builds an MCU with version, clock and a history point per update', () => {
    const m = createHealthModel();
    const r = m.apply(mcuDelta({ mcu_awake: 0.02, mcu_task_avg: 0.000004, srtt: 0.001, bytes_write: 100 }), 10);
    const mcu = r.mcus![0]!;
    expect(mcu).toMatchObject({ name: 'mcu', short: 'mcu', version: 'v0.12', freq: 72000000 });
    expect(mcu.history).toHaveLength(1);
    expect(mcu.history[0]).toMatchObject({ t: 10, awake: 2, srttMs: 1, retransBps: null });
    expect(mcu.history[0]!.taskUs).toBeCloseTo(4);
  });

  it('turns cumulative counters into per-second retransmit rate', () => {
    const m = createHealthModel();
    m.apply(mcuDelta({ bytes_write: 1000, bytes_retransmit: 0 }), 10);
    const r = m.apply(mcuDelta({ bytes_write: 3000, bytes_retransmit: 200 }), 12);
    expect(r.mcus![0]!.history.at(-1)!.retransBps).toBeCloseTo(100);
  });

  it('survives an MCU restart (counters go back to zero)', () => {
    const m = createHealthModel();
    m.apply(mcuDelta({ bytes_write: 9000, bytes_retransmit: 500 }), 10);
    const r = m.apply(mcuDelta({ bytes_write: 40, bytes_retransmit: 0 }), 11);
    expect(r.mcus![0]!.history.at(-1)!.retransBps).toBe(0);
    expect(r.mcus![0]!.link.severity).not.toBe('crit');
  });

  it('keeps version and constants when a later delta only carries stats', () => {
    const m = createHealthModel();
    m.apply(mcuDelta({ mcu_awake: 0.1 }), 1);
    const r = m.apply({ mcu: { last_stats: { mcu_awake: 0.2 } } }, 2);
    expect(r.mcus![0]).toMatchObject({ version: 'v0.12', freq: 72000000 });
    expect(r.mcus![0]!.history).toHaveLength(2);
  });

  it('caps the history', () => {
    const m = createHealthModel();
    for (let i = 0; i < HEALTH_CAP + 50; i++) m.apply(mcuDelta({ mcu_awake: 0.1 }), i);
    expect(m.mcus[0]!.history).toHaveLength(HEALTH_CAP);
  });

  it('goes critical on heavy retransmits and recovers when the window moves on', () => {
    const m = createHealthModel();
    m.apply(mcuDelta({ bytes_write: 0, bytes_retransmit: 0 }), 0);
    let r = m.apply(mcuDelta({ bytes_write: 10000, bytes_retransmit: 900 }), 1);
    expect(r.mcus![0]!.link.severity).toBe('crit');

    r = m.apply(mcuDelta({ bytes_write: 20000, bytes_retransmit: 900 }), 100);
    expect(r.mcus![0]!.link.severity).toBe('ok');
  });

  it('joins canbus_stats to its MCU by name and reacts to the bus state', () => {
    const m = createHealthModel();
    m.apply({ 'mcu EBB': { last_stats: { mcu_awake: 0.01 } }, 'canbus_stats EBB': { bus_state: 'active' } }, 1);
    expect(m.mcus[0]).toMatchObject({ short: 'EBB', bus: { state: 'active' } });
    expect(m.mcus[0]!.link.severity).toBe('ok');

    const r = m.apply({ 'canbus_stats EBB': { bus_state: 'passive' } }, 2);
    expect(r.mcus![0]!.link).toMatchObject({ severity: 'crit', reasons: ['busState'] });
  });

  it('counts new CAN errors that arrive together with MCU stats', () => {
    const m = createHealthModel();
    const d = (rx: number) => ({
      'mcu EBB': { last_stats: { mcu_awake: 0.01 } },
      'canbus_stats EBB': { bus_state: 'active', rx_error: rx, tx_error: 0 },
    });
    m.apply(d(0), 1);
    const r = m.apply(d(3), 2);
    expect(r.mcus![0]!.link.reasons).toContain('busErrors');
  });

  it('sorts MCUs by name with the main one first', () => {
    const m = createHealthModel();
    m.apply({ 'mcu EBB': { last_stats: {} }, mcu: { last_stats: {} }, 'mcu Z': { last_stats: {} } }, 1);
    expect(m.mcus.map((x) => x.name)).toEqual(['mcu', 'mcu EBB', 'mcu Z']);
  });

  it('tracks TMC drivers and latches flags seen during the session', () => {
    const m = createHealthModel();
    let r = m.apply({ 'tmc2209 stepper_x': { drv_status: { otpw: 1, cs_actual: 9 }, run_current: 0.8 } }, 1, 5000);
    const d = r.tmc![0]!;
    expect(d).toMatchObject({ type: 'tmc2209', stepper: 'stepper_x', runCurrent: 0.8 });
    expect(d.decoded.severity).toBe('warn');
    expect(d.seen).toEqual({ otpw: 5000 });

    r = m.apply({ 'tmc2209 stepper_x': { drv_status: { otpw: 0 } } }, 2, 9000);
    expect(r.tmc![0]!.decoded.severity).toBe('ok');
    expect(r.tmc![0]!.seen).toEqual({ otpw: 5000 });
  });

  it('keeps the last drv_status when only the temperature changes, but not when it turns null', () => {
    const m = createHealthModel();
    m.apply({ 'tmc2240 stepper_y': { drv_status: { ot: 1 } } }, 1);
    let r = m.apply({ 'tmc2240 stepper_y': { temperature: 41.5 } }, 2);
    expect(r.tmc![0]).toMatchObject({ temperature: 41.5 });
    expect(r.tmc![0]!.decoded.critical).toEqual(['ot']);

    r = m.apply({ 'tmc2240 stepper_y': { drv_status: null } }, 3);
    expect(r.tmc![0]!.decoded.responding).toBe(false);
  });

  describe('motor state (stepper_enable)', () => {
    const off = { stepper_enable: { steppers: { stepper_x: false, stepper_y: true } } };

    it('does not call a disabled motor’s silent driver an error', () => {
      const m = createHealthModel();
      m.apply({ ...off, 'tmc2209 stepper_x': { drv_status: null } }, 1);
      expect(m.tmc[0]).toMatchObject({ stepper: 'stepper_x', motorOn: false, idle: true, severity: 'unknown' });
    });

    it('flags a silent driver only while its motor is enabled', () => {
      const m = createHealthModel();
      m.apply({ ...off, 'tmc2209 stepper_y': { drv_status: null } }, 1);
      expect(m.tmc[0]).toMatchObject({ motorOn: true, noResponse: true, severity: 'warn' });
    });

    it('re-evaluates drivers that are not in the delta when the motors switch', () => {
      const m = createHealthModel();
      m.apply({ ...off, 'tmc2209 stepper_x': { drv_status: null } }, 1);
      const r = m.apply({ stepper_enable: { steppers: { stepper_x: true } } }, 2);
      expect(r.tmc![0]).toMatchObject({ motorOn: true, noResponse: true, idle: false });

      const back = m.apply({ stepper_enable: { steppers: { stepper_x: false } } }, 3);
      expect(back.tmc![0]).toMatchObject({ motorOn: false, idle: true, severity: 'unknown' });
    });

    it('reads a driver the moment its motor wakes up and answers', () => {
      const m = createHealthModel();
      m.apply({ ...off, 'tmc2209 stepper_x': { drv_status: null } }, 1);
      const r = m.apply(
        { stepper_enable: { steppers: { stepper_x: true } }, 'tmc2209 stepper_x': { drv_status: { otpw: 0 } } },
        2,
      );
      expect(r.tmc![0]).toMatchObject({ idle: false, noResponse: false, severity: 'ok' });
    });

    it('keeps the flags seen earlier while the motor is off', () => {
      const m = createHealthModel();
      m.apply({ ...off, 'tmc2209 stepper_y': { drv_status: { otpw: 1 } } }, 1, 7000);
      m.apply({ stepper_enable: { steppers: { stepper_y: false } }, 'tmc2209 stepper_y': { drv_status: null } }, 2);
      expect(m.tmc[0]).toMatchObject({ idle: true });
      expect(m.tmc[0]!.seen).toEqual({ otpw: 7000 });
    });

    it('treats a stepper missing from stepper_enable as unknown, hence idle', () => {
      const m = createHealthModel();
      m.apply({ ...off, 'tmc2209 extruder': { drv_status: null } }, 1);
      expect(m.tmc[0]).toMatchObject({ motorOn: null, idle: true });
    });
  });

  describe('Klipper restart (holdOff)', () => {
    const burst = (n: number) => ({
      mcu: { last_stats: { mcu_awake: 0.01, bytes_write: n * 10000, bytes_retransmit: n * 2000 } },
    });

    it('does not rate the retransmit burst of a restarting MCU', () => {
      const m = createHealthModel();
      m.apply(burst(0), 0);
      m.holdOff(30);
      const r = m.apply(burst(1), 5);
      expect(r.mcus![0]!.link).toMatchObject({ severity: 'ok', reasons: [] });
    });

    it('stays quiet for as long as Klipper is not ready', () => {
      const m = createHealthModel();
      m.apply(burst(0), 0);
      m.holdOff(Infinity);
      expect(m.apply(burst(1), 1000).mcus![0]!.link.severity).toBe('ok');
    });

    it('rates the link again once the quiet period is over, from a clean baseline', () => {
      const m = createHealthModel();
      m.apply(burst(0), 0);
      m.holdOff(30);
      m.apply(burst(1), 5); // всплеск при рестарте — не считается
      const calm = m.apply({ mcu: { last_stats: { bytes_write: 30000, bytes_retransmit: 2000 } } }, 40);
      expect(calm.mcus![0]!.link.severity).toBe('ok'); // старый всплеск в окно не попал

      const bad = m.apply({ mcu: { last_stats: { bytes_write: 40000, bytes_retransmit: 4500 } } }, 41);
      expect(bad.mcus![0]!.link.severity).toBe('crit'); // новые ретрансмиты после паузы видны
    });

    it('still records the burst on the chart', () => {
      const m = createHealthModel();
      m.apply(burst(0), 0);
      m.holdOff(30);
      const r = m.apply(burst(1), 5);
      expect(r.mcus![0]!.history.at(-1)!.retransBps).toBeGreaterThan(0);
    });
  });

  it('reports toolhead stalls and ignores unrelated objects', () => {
    const m = createHealthModel();
    expect(m.apply({ toolhead: { stalls: 3 }, extruder: { temperature: 20 } }, 1)).toEqual({
      mcus: null,
      tmc: null,
      stalls: 3,
    });
    expect(m.apply(null, 1)).toEqual({ mcus: null, tmc: null, stalls: undefined });
  });

  it('drops objects that disappeared from the config', () => {
    const m = createHealthModel();
    m.apply({ mcu: { last_stats: {} }, 'mcu EBB': { last_stats: {} }, 'tmc2209 stepper_x': { drv_status: {} } }, 1);
    const kept = m.retain(new Set(['mcu']));
    expect(kept.mcus.map((x) => x.name)).toEqual(['mcu']);
    expect(kept.tmc).toEqual([]);
  });
});
