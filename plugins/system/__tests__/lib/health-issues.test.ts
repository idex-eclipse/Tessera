import { describe, expect, it } from 'vitest';

import type { McuHealth, TmcDriver } from '../../lib/health-model';
import { collectHealthIssues, countCritical, type HealthIssuesInput } from '../../lib/health-issues';
import { THROTTLE_UNSUPPORTED, type LinkStatus, type ThrottleState } from '../../lib/health-utils';

/** Минимально возможные фикстуры: коллектору нужны link/bus и decoded/severity/idle. */
function mcu(partial: Partial<McuHealth> & { short: string }): McuHealth {
  const link: LinkStatus = partial.link ?? { severity: 'ok', reasons: [], retransmitRatio: 0 };
  return {
    name: `mcu ${partial.short}`,
    version: '',
    build: '',
    freq: null,
    constants: null,
    rawStats: null,
    stats: {},
    bus: null,
    history: [],
    ...partial,
    link,
  };
}

function driver(partial: Partial<TmcDriver> & { name: string }): TmcDriver {
  return {
    type: 'tmc2209',
    stepper: 'stepper_x',
    decoded: { responding: true, errors: [], critical: [], temp: [], values: {}, severity: 'ok' },
    motorOn: true,
    severity: 'ok',
    idle: false,
    noResponse: false,
    temperature: null,
    runCurrent: null,
    holdCurrent: null,
    seen: {},
    ...partial,
  };
}

function input(partial: Partial<HealthIssuesInput> = {}): HealthIssuesInput {
  return {
    klippyReady: true,
    throttle: THROTTLE_UNSUPPORTED,
    cpuTemp: null,
    failedComponents: [],
    warnings: [],
    mcus: [],
    tmc: [],
    ...partial,
  };
}

const throttle = (now: string[]): ThrottleState => ({
  supported: true,
  bits: 0,
  now: now as ThrottleState['now'],
  past: [],
  severity: 'ok',
});

describe('collectHealthIssues', () => {
  it('returns an empty list when everything is fine', () => {
    expect(collectHealthIssues(input())).toEqual([]);
  });

  it('classifies throttling flags by criticality, independent of Klipper state', () => {
    const issues = collectHealthIssues(
      input({ klippyReady: false, throttle: throttle(['undervoltage', 'freqCapped']) }),
    );
    expect(issues).toEqual([
      { severity: 'crit', scope: 'host', target: '', textKey: 'system.throttle.undervoltage' },
      { severity: 'warn', scope: 'host', target: '', textKey: 'system.throttle.freqCapped' },
    ]);
  });

  it('ignores throttling when the host does not report it', () => {
    expect(collectHealthIssues(input({ throttle: throttle([]) }))).toEqual([]);
  });

  it('raises CPU temperature issues at the warn/crit thresholds', () => {
    expect(collectHealthIssues(input({ cpuTemp: 60 }))).toEqual([]);
    expect(collectHealthIssues(input({ cpuTemp: 82.34 }))).toMatchObject([
      { severity: 'warn', textKey: 'fleet.health.cpuTemp', params: { value: '82.3' } },
    ]);
    expect(collectHealthIssues(input({ cpuTemp: 90 }))).toMatchObject([
      { severity: 'crit', textKey: 'fleet.health.cpuTemp' },
    ]);
  });

  it('reports failed Moonraker components as critical and warnings as warn', () => {
    const issues = collectHealthIssues(
      input({ failedComponents: ['mqtt'], warnings: ['Low disk space'] }),
    );
    expect(issues).toEqual([
      { severity: 'crit', scope: 'host', target: '', textKey: 'fleet.health.failedComponent', params: { name: 'mqtt' } },
      { severity: 'warn', scope: 'host', target: '', textKey: 'fleet.health.moonrakerWarning', params: { text: 'Low disk space' } },
    ]);
  });

  it('skips MCU and driver issues while Klipper is not ready', () => {
    const issues = collectHealthIssues(
      input({
        klippyReady: false,
        mcus: [mcu({ short: 'EBB', link: { severity: 'crit', reasons: ['retransmit'], retransmitRatio: 0.1 } })],
        tmc: [driver({ name: 'tmc2209 stepper_x', severity: 'crit' })],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('lists MCU link reasons with the MCU name, deduplicating the bus state reason', () => {
    const issues = collectHealthIssues(
      input({
        mcus: [
          mcu({
            short: 'EBB',
            link: { severity: 'warn', reasons: ['retransmit', 'busState'], retransmitRatio: 0.02 },
            bus: { state: 'warning', rxError: 0, txError: 0, txRetries: 0 },
          }),
        ],
      }),
    );
    expect(issues).toEqual([
      { severity: 'warn', scope: 'mcu', target: 'EBB', textKey: 'system.link.reason.retransmit' },
      { severity: 'warn', scope: 'mcu', target: 'EBB', textKey: 'system.link.bus.warning' },
    ]);
  });

  it('marks a passive CAN bus as critical', () => {
    const issues = collectHealthIssues(
      input({
        mcus: [
          mcu({
            short: 'EBB',
            link: { severity: 'crit', reasons: ['busState'], retransmitRatio: 0 },
            bus: { state: 'passive', rxError: 1, txError: 0, txRetries: 0 },
          }),
        ],
      }),
    );
    expect(issues).toMatchObject([
      { severity: 'crit', textKey: 'system.link.bus.passive' },
    ]);
  });

  it('ignores a healthy CAN bus and an MCU without statistics', () => {
    const issues = collectHealthIssues(
      input({
        mcus: [
          mcu({ short: 'mcu', bus: { state: 'active', rxError: 0, txError: 0, txRetries: 0 } }),
          mcu({ short: 'EBB', link: { severity: 'unknown', reasons: [], retransmitRatio: 0 } }),
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('reports a silent driver as critical and classifies its flags', () => {
    const silent = driver({
      name: 'tmc2209 stepper_x',
      decoded: { responding: false, errors: [], critical: [], temp: [], values: {}, severity: 'warn' },
      severity: 'warn',
      noResponse: true,
    });
    const flagged = driver({
      name: 'tmc2209 stepper_y',
      stepper: 'stepper_y',
      decoded: {
        responding: true,
        errors: ['otpw', 's2ga'],
        critical: ['s2ga'],
        temp: ['t120'],
        values: {},
        severity: 'crit',
      },
      severity: 'crit',
    });
    const issues = collectHealthIssues(input({ tmc: [silent, flagged] }));
    expect(issues).toEqual([
      { severity: 'crit', scope: 'tmc', target: 'stepper_x', textKey: 'system.tmc.noResponse' },
      { severity: 'warn', scope: 'tmc', target: 'stepper_y', textKey: 'system.tmc.flag.otpw' },
      { severity: 'crit', scope: 'tmc', target: 'stepper_y', textKey: 'system.tmc.flag.s2ga' },
      { severity: 'warn', scope: 'tmc', target: 'stepper_y', textKey: 'system.tmc.flag.t120' },
    ]);
  });

  it('skips idle drivers even when the model keeps them at warn', () => {
    const issues = collectHealthIssues(
      input({
        tmc: [
          driver({
            name: 'tmc2209 stepper_x',
            decoded: { responding: false, errors: [], critical: [], temp: [], values: {}, severity: 'warn' },
            severity: 'warn',
            idle: true,
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
  });
});

describe('countCritical', () => {
  it('counts only critical issues', () => {
    const issues = collectHealthIssues(
      input({ throttle: throttle(['undervoltage', 'freqCapped']) }),
    );
    expect(countCritical(issues)).toBe(1);
  });
});
