import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILAMENT_ALERT_STATE,
  evaluateFilamentAlerts,
  type FilamentAlertSnapshot,
  type FilamentAlertState,
} from '../data/filament-alerts.svelte.ts';
import type { FilamentState } from '../data/use-filament.svelte.ts';

const SENSOR = { id: 'filament_switch_sensor runout', kind: 'switch', name: 'runout' } as const;

/** Builds a complete Klipper status without inventing unrelated sensor fields. */
function state(enabled: boolean, detected: boolean): FilamentState {
  return { enabled, detected, isActive: false, flowComp: false, diameter: null, raw: null };
}

/** Supplies one sensor snapshot while keeping each test's print state explicit. */
function snapshot(printState: string, enabled: boolean, detected: boolean): FilamentAlertSnapshot {
  return {
    ready: true,
    printState,
    sensors: [SENSOR],
    states: { [SENSOR.id]: state(enabled, detected) },
  };
}

describe('filament runout alerts', () => {
  it.each(['printing', 'paused'])('notifies once on a loss during %s and keeps the alarm until recovery', (printState) => {
    let previous: FilamentAlertState = EMPTY_FILAMENT_ALERT_STATE;
    let result = evaluateFilamentAlerts(previous, snapshot(printState, true, true));
    expect(result.triggered).toEqual([]);
    previous = result.next;

    result = evaluateFilamentAlerts(previous, snapshot(printState, true, false));
    expect(result.triggered).toEqual([SENSOR]);
    expect(result.next.active).toEqual([SENSOR.id]);
    previous = result.next;

    result = evaluateFilamentAlerts(previous, snapshot('standby', true, false));
    expect(result.triggered).toEqual([]);
    expect(result.next.active).toEqual([SENSOR.id]);
    result = evaluateFilamentAlerts(result.next, snapshot('standby', true, true));
    expect(result.next.active).toEqual([]);
  });

  it('shows an already missing sensor as critical without a startup notification', () => {
    const result = evaluateFilamentAlerts(EMPTY_FILAMENT_ALERT_STATE, snapshot('paused', true, false));
    expect(result.next.active).toEqual([SENSOR.id]);
    expect(result.triggered).toEqual([]);
  });

  it('does not notify in idle or for a disabled sensor, and disabling clears an alarm', () => {
    const loaded = evaluateFilamentAlerts(EMPTY_FILAMENT_ALERT_STATE, snapshot('standby', true, true));
    const idle = evaluateFilamentAlerts(loaded.next, snapshot('standby', true, false));
    expect(idle.triggered).toEqual([]);
    expect(idle.next.active).toEqual([]);

    const printing = evaluateFilamentAlerts(idle.next, snapshot('printing', true, false));
    expect(printing.triggered).toEqual([]);
    expect(printing.next.active).toEqual([SENSOR.id]);
    const disabled = evaluateFilamentAlerts(printing.next, snapshot('printing', false, false));
    expect(disabled.triggered).toEqual([]);
    expect(disabled.next.active).toEqual([]);
  });

  it('preserves a latched alarm while disconnected and drops removed sensors', () => {
    const alarm = evaluateFilamentAlerts(EMPTY_FILAMENT_ALERT_STATE, snapshot('printing', true, false));
    const offline = evaluateFilamentAlerts(alarm.next, { ...snapshot('printing', true, false), ready: false });
    expect(offline.next.active).toEqual([SENSOR.id]);
    expect(offline.next.baseline).toEqual({});

    const removed = evaluateFilamentAlerts(offline.next, {
      ready: true,
      printState: 'standby',
      sensors: [],
      states: {},
    });
    expect(removed.next.active).toEqual([]);
  });
});
