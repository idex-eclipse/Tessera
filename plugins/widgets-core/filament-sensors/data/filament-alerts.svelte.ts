import type { FilamentSensor, FilamentState } from './use-filament.svelte.ts';

/** One printer's observed sensor values and runout alarms. */
export interface FilamentAlertState {
  baseline: Readonly<Record<string, { enabled: boolean; detected: boolean }>>;
  active: readonly string[];
}

/** Inputs from the printer-bound filament store and print status subscription. */
export interface FilamentAlertSnapshot {
  ready: boolean;
  printState: string | null;
  sensors: readonly FilamentSensor[];
  states: Readonly<Record<string, FilamentState>>;
}

/** A fresh monitor has no baseline, so its first snapshot cannot create a notification. */
export const EMPTY_FILAMENT_ALERT_STATE: FilamentAlertState = { baseline: {}, active: [] };

/** Keeps an alarm until recovery while notifying only on a seen filament-loss edge. */
export function evaluateFilamentAlerts(
  previous: FilamentAlertState,
  snapshot: FilamentAlertSnapshot,
): { next: FilamentAlertState; triggered: FilamentSensor[] } {
  // A reconnect must not turn cached measurements into a new runout event.
  if (!snapshot.ready) {
    return { next: { baseline: {}, active: previous.active }, triggered: [] };
  }

  const printing = snapshot.printState === 'printing' || snapshot.printState === 'paused';
  const active = new Set(previous.active);
  const baseline: Record<string, { enabled: boolean; detected: boolean }> = {};
  const triggered: FilamentSensor[] = [];
  const known = new Set(snapshot.sensors.map((sensor) => sensor.id));

  for (const sensor of snapshot.sensors) {
    const state = snapshot.states[sensor.id];
    if (!state) continue;

    const before = previous.baseline[sensor.id];
    if (!state.enabled || state.detected) {
      active.delete(sensor.id);
    } else if (printing) {
      active.add(sensor.id);
      if (before?.enabled && before.detected) triggered.push(sensor);
    }
    baseline[sensor.id] = { enabled: state.enabled, detected: state.detected };
  }

  // A removed sensor cannot keep a printer's Fleet Health indicator red.
  for (const id of active) if (!known.has(id)) active.delete(id);
  return { next: { baseline, active: [...active] }, triggered };
}

// This plugin-owned state bridges its persistent monitor and its Fleet contribution.
let activeByPrinter = $state<Record<string, readonly string[]>>({});

/** Returns current alarmed sensor IDs for the named printer. */
export function filamentAlertsFor(printerId: string): readonly string[] {
  return activeByPrinter[printerId] ?? [];
}

/** Replaces one printer's alarm list only when it has actually changed. */
export function setFilamentAlerts(printerId: string, ids: readonly string[]): void {
  const previous = activeByPrinter[printerId] ?? [];
  if (previous.length === ids.length && previous.every((id, index) => id === ids[index])) return;
  activeByPrinter = { ...activeByPrinter, [printerId]: [...ids] };
}

/** Releases alarms when a printer or the monitoring plugin is removed. */
export function clearFilamentAlerts(printerId: string): void {
  if (!(printerId in activeByPrinter)) return;
  const next = { ...activeByPrinter };
  delete next[printerId];
  activeByPrinter = next;
}
