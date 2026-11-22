/**
 * Read-only snapshot store for active heater deviation alerts.
 *
 * The producer in `notifications.ts` owns detection and publishes through this
 * module; UI consumers (the Heaters panel, the Fleet Health contribution)
 * subscribe without touching Moonraker. Mirrors the filament alert store in
 * `plugins/widgets-core/filament-sensors/data/filament-alerts.svelte.ts`.
 */

/** Read-only alert data exposed to heater UI panels. */
export interface HeaterDeviationAlert {
  printerId: string;
  heaterId: string;
  displayName: string;
  deviation: number;
  target: number;
}

/** Receives immutable snapshots of all active heater deviations. */
export type HeaterDeviationListener = (alerts: readonly HeaterDeviationAlert[]) => void;

// Printer-heater pairs key the map so one heater holds exactly one alert.
const activeAlerts = new Map<string, HeaterDeviationAlert>();
const alertListeners = new Set<HeaterDeviationListener>();

/** Returns copied records so UI consumers cannot mutate producer state. */
function alertSnapshot(): readonly HeaterDeviationAlert[] {
  return Array.from(activeAlerts.values(), (alert) => ({ ...alert }));
}

/** Publishes an immutable snapshot to every mounted consumer. */
function emitAlerts(): void {
  const snapshot = alertSnapshot();
  for (const listener of alertListeners) listener(snapshot);
}

/** Subscribes UI-only consumers to active alerts without exposing Moonraker subscriptions. */
export function subscribeHeaterDeviationAlerts(listener: HeaterDeviationListener): () => void {
  alertListeners.add(listener);
  listener(alertSnapshot());
  return () => alertListeners.delete(listener);
}

/** Length-prefixes the printer id so any pair of names maps to one unique key. */
function alertKey(printerId: string, heaterId: string): string {
  return `${printerId.length}:${printerId}${heaterId}`;
}

/** Publishes or replaces one heater's active deviation alert. */
export function publishHeaterAlert(alert: HeaterDeviationAlert): void {
  activeAlerts.set(alertKey(alert.printerId, alert.heaterId), alert);
  emitAlerts();
}

/** Retracts one heater's alert; silent when that heater had none. */
export function retractHeaterAlert(printerId: string, heaterId: string): void {
  if (activeAlerts.delete(alertKey(printerId, heaterId))) emitAlerts();
}

/** Releases every alert owned by a removed or resetting printer. */
export function clearHeaterAlerts(printerId: string): void {
  let changed = false;
  for (const [key, alert] of activeAlerts) {
    if (alert.printerId !== printerId) continue;
    activeAlerts.delete(key);
    changed = true;
  }
  if (changed) emitAlerts();
}
