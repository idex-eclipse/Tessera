import type {
  MoonrakerProxyHandle,
  NotificationActionInput,
  PluginApi,
  PluginSettingsApi,
} from '../../plugin-sdk/src/types';

import { asNumber } from '../shared/settings/parsers';

import { scanPidActivity, type GcodeStoreEntry } from './lib/gcode-scanner';

const DEFAULT_THRESHOLD = 5;
const SETTLE_MS = 45_000;
const HOLD_MS = 20_000;
const PRINT_HOLD_MS = 40_000;
const REPEAT_MS = 300_000;
const GCODE_STORE_COUNT = 200;
const GCODE_REFRESH_DELAY_MS = 500;
const PAGE_ACTION_ELEMENT = 'mpu-calibrations-notification-page-action';

/** Detector phases preserve the previous cooldown and rearm behavior. */
type DeviationPhase = 'idle' | 'settle' | 'watch' | 'alert' | 'cooldown';

/** Wall-clock state retained independently for every discovered heater. */
export interface HeaterDeviationState {
  phase: DeviationPhase;
  phaseSince: number;
  outsideSince: number | null;
  lastAlertAt: number | null;
  active: boolean;
}

/** Normalized input consumed by the pure deviation detector. */
export interface HeaterDeviationSample {
  deviation: number;
  threshold: number;
  printing: boolean;
  suppressed: boolean;
}

/** Detector output for one status update. */
export interface HeaterDeviationStep {
  state: HeaterDeviationState;
  notify: boolean;
}

/** Creates a fresh detector that must first observe a settled heater. */
export function initialHeaterDeviationState(now = 0): HeaterDeviationState {
  return {
    phase: 'idle',
    phaseSince: now,
    outsideSince: null,
    lastAlertAt: null,
    active: false,
  };
}

/** Advances the wall-clock detector without assuming a fixed Moonraker update frequency. */
export function advanceHeaterDeviation(
  previous: HeaterDeviationState,
  sample: HeaterDeviationSample,
  now: number,
): HeaterDeviationStep {
  if (sample.suppressed || !Number.isFinite(sample.deviation) || sample.threshold <= 0) {
    return { state: initialHeaterDeviationState(now), notify: false };
  }

  const state = { ...previous };
  const within = sample.deviation <= sample.threshold;
  const recovered = sample.deviation < sample.threshold / 2;

  if (state.phase === 'idle') {
    if (within) {
      state.phase = 'settle';
      state.phaseSince = now;
    }
    return { state, notify: false };
  }

  if (state.phase === 'settle') {
    if (!within) return { state: initialHeaterDeviationState(now), notify: false };
    if (now - state.phaseSince >= SETTLE_MS) {
      state.phase = 'watch';
      state.phaseSince = now;
      state.outsideSince = null;
    }
    return { state, notify: false };
  }

  if (state.phase === 'watch') {
    if (within) {
      state.outsideSince = null;
      return { state, notify: false };
    }
    state.outsideSince ??= now;
    const hold = sample.printing ? PRINT_HOLD_MS : HOLD_MS;
    if (now - state.outsideSince >= hold) {
      state.phase = 'alert';
      state.phaseSince = now;
      state.lastAlertAt = now;
      state.active = true;
      return { state, notify: true };
    }
    return { state, notify: false };
  }

  if (state.phase === 'alert') {
    if (recovered) {
      state.phase = 'cooldown';
      state.phaseSince = now;
      state.outsideSince = null;
      state.active = false;
      return { state, notify: false };
    }
    if (state.lastAlertAt !== null && now - state.lastAlertAt >= REPEAT_MS) {
      state.lastAlertAt = now;
      return { state, notify: true };
    }
    return { state, notify: false };
  }

  if (!within) {
    state.phase = 'watch';
    state.phaseSince = now;
    state.outsideSince = now;
  } else if (now - state.phaseSince >= REPEAT_MS) {
    state.phase = 'watch';
    state.phaseSince = now;
    state.outsideSince = null;
  }
  return { state, notify: false };
}

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

const activeAlerts = new Map<string, HeaterDeviationAlert>();
const alertListeners = new Set<HeaterDeviationListener>();

/** Returns copied records so UI consumers cannot mutate producer state. */
function alertSnapshot(): readonly HeaterDeviationAlert[] {
  return Array.from(activeAlerts.values(), (alert) => ({ ...alert }));
}

/** Publishes an immutable snapshot to every mounted Heaters panel. */
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

function alertKey(printerId: string, objectName: string): string {
  return `${printerId}\u0000${objectName}`;
}

function removePrinterAlerts(printerId: string): void {
  let changed = false;
  for (const [key, alert] of activeAlerts) {
    if (alert.printerId !== printerId) continue;
    activeAlerts.delete(key);
    changed = true;
  }
  if (changed) emitAlerts();
}

/** Maps a Moonraker object name to the shorter identifier used by the UI route. */
interface HeaterDescriptor {
  objectName: string;
  heaterId: string;
  displayName: string;
}

/** Mutable measurements and detector state for one Moonraker heater object. */
interface HeaterWatch extends HeaterDescriptor {
  temperature: number | null;
  target: number | null;
  detector: HeaterDeviationState;
}

/** Owns every subscription and detector associated with one registered printer. */
interface PrinterWatch {
  printerId: string;
  generation: number;
  discovery: number;
  handle: MoonrakerProxyHandle;
  settings: PluginSettingsApi;
  threshold: number;
  printing: boolean;
  pidHeater: string;
  heaters: Map<string, HeaterWatch>;
  unsubs: Array<() => void>;
  statusUnsub: (() => void) | null;
  gcodeRefreshTimer: ReturnType<typeof setTimeout> | null;
}

/** Recognizes Klipper heater objects while preserving their exact subscription names. */
function heaterDescriptor(objectName: string): HeaterDescriptor | null {
  if (objectName === 'heater_bed') {
    return { objectName, heaterId: objectName, displayName: 'Heater Bed' };
  }
  if (/^extruder\d*$/.test(objectName)) {
    return {
      objectName,
      heaterId: objectName,
      displayName: objectName.charAt(0).toUpperCase() + objectName.slice(1),
    };
  }
  if (objectName.startsWith('heater_generic ')) {
    const heaterId = objectName.slice('heater_generic '.length).trim();
    if (!heaterId) return null;
    return {
      objectName,
      heaterId,
      displayName: heaterId.charAt(0).toUpperCase() + heaterId.slice(1),
    };
  }
  return null;
}

/** Applies the same finite-number validation and fallback as the heater settings UI. */
function readThreshold(settings: PluginSettingsApi): number {
  return asNumber()(settings.get('deviationThreshold'), DEFAULT_THRESHOLD);
}

/** Captures the originating printer and heater instead of following later UI selection. */
function pageAction(printerId: string, heaterId: string): NotificationActionInput {
  return {
    element: PAGE_ACTION_ELEMENT,
    params: {
      printerId,
      pageId: 'calibrations',
      section: 'heaters',
      heater: heaterId,
      labelKey: 'calibrations.heaters.openHeaters',
    },
  };
}

/** Matches both ordinary object names and shortened heater_generic UI identifiers. */
function pidSuppresses(watch: PrinterWatch, heater: HeaterWatch): boolean {
  return watch.pidHeater === heater.objectName || watch.pidHeater === heater.heaterId;
}

/** Starts the per-printer producer and returns a complete teardown function. */
export function startNotificationProducers(api: PluginApi): () => void {
  const watches = new Map<string, PrinterWatch>();

  /** Clears unfinished detector cycles whenever their assumptions become stale. */
  function resetWatch(watch: PrinterWatch): void {
    const now = Date.now();
    for (const heater of watch.heaters.values()) heater.detector = initialHeaterDeviationState(now);
    removePrinterAlerts(watch.printerId);
  }

  /** Publishes a localized alert with a stable deep link to its source heater. */
  function publishDeviation(watch: PrinterWatch, heater: HeaterWatch, deviation: number): void {
    const target = heater.target ?? 0;
    api.notifications.push({
      printerId: watch.printerId,
      severity: 'error',
      text: api.i18n.t('calibrations.heaters.deviationAlert', {
        heater: heater.displayName,
        dev: deviation.toFixed(1),
        target: target.toFixed(0),
      }),
      actions: [pageAction(watch.printerId, heater.heaterId)],
    });
  }

  /** Advances one heater using its latest complete temperature/target pair. */
  function updateHeater(watch: PrinterWatch, heater: HeaterWatch): void {
    if (heater.temperature === null || heater.target === null || heater.target <= 0) {
      heater.detector = initialHeaterDeviationState(Date.now());
      if (activeAlerts.delete(alertKey(watch.printerId, heater.objectName))) emitAlerts();
      return;
    }

    const deviation = Math.abs(heater.temperature - heater.target);
    const step = advanceHeaterDeviation(
      heater.detector,
      {
        deviation,
        threshold: watch.threshold,
        printing: watch.printing,
        suppressed: pidSuppresses(watch, heater),
      },
      Date.now(),
    );
    heater.detector = step.state;

    const key = alertKey(watch.printerId, heater.objectName);
    if (step.state.active) {
      activeAlerts.set(key, {
        printerId: watch.printerId,
        heaterId: heater.heaterId,
        displayName: heater.displayName,
        deviation,
        target: heater.target,
      });
      emitAlerts();
    } else if (activeAlerts.delete(key)) {
      emitAlerts();
    }

    if (step.notify) publishDeviation(watch, heater, deviation);
  }

  /** Applies a partial Moonraker status update without erasing retained fields. */
  function applyStatusDelta(watch: PrinterWatch, delta: unknown): void {
    if (!delta || typeof delta !== 'object') return;
    const record = delta as Record<string, unknown>;
    const printStats = record.print_stats;
    if (printStats && typeof printStats === 'object') {
      const state = (printStats as Record<string, unknown>).state;
      if (typeof state === 'string') watch.printing = state === 'printing' || state === 'paused';
    }

    for (const heater of watch.heaters.values()) {
      const raw = record[heater.objectName];
      if (!raw || typeof raw !== 'object') continue;
      const status = raw as Record<string, unknown>;
      if (typeof status.temperature === 'number') heater.temperature = status.temperature;
      if (typeof status.target === 'number') heater.target = status.target;
      updateHeater(watch, heater);
    }
  }

  /** Reconstructs PID suppression from the chronological g-code store. */
  async function refreshPidActivity(watch: PrinterWatch, generation: number): Promise<void> {
    if (watch.handle.readyState !== 'open') return;
    const response = await watch.handle
      .request<unknown>('server.gcode_store', { count: GCODE_STORE_COUNT })
      .catch(() => null);
    if (watch.generation !== generation || response === null) return;
    const rawEntries = Array.isArray(response)
      ? response
      : response && typeof response === 'object'
        ? (response as Record<string, unknown>).gcode_store
        : null;
    const entries = Array.isArray(rawEntries)
      ? rawEntries.filter((entry): entry is GcodeStoreEntry => (
          Boolean(entry) && typeof entry === 'object' && typeof (entry as { message?: unknown }).message === 'string'
        ))
      : [];
    const activity = scanPidActivity(entries);
    const previous = watch.pidHeater;
    watch.pidHeater = activity.active ? activity.heater : '';
    if (previous !== watch.pidHeater) resetWatch(watch);
  }

  /** Coalesces noisy g-code responses into one store refresh. */
  function schedulePidRefresh(watch: PrinterWatch, generation: number): void {
    if (watch.gcodeRefreshTimer !== null) return;
    watch.gcodeRefreshTimer = setTimeout(() => {
      watch.gcodeRefreshTimer = null;
      if (watch.generation === generation) void refreshPidActivity(watch, generation);
    }, GCODE_REFRESH_DELAY_MS);
  }

  /** Rediscovers heaters and installs one combined status subscription. */
  async function subscribeStatus(watch: PrinterWatch, generation: number): Promise<void> {
    const discovery = ++watch.discovery;
    if (watch.statusUnsub) {
      watch.statusUnsub();
      watch.statusUnsub = null;
    }
    if (watch.handle.readyState !== 'open') return;

    const response = await watch.handle.request<unknown>('printer.objects.list').catch(() => null);
    if (
      watch.generation !== generation ||
      watch.discovery !== discovery ||
      !response ||
      typeof response !== 'object'
    ) return;
    const rawObjects = (response as Record<string, unknown>).objects;
    const descriptors = Array.isArray(rawObjects)
      ? rawObjects
          .filter((name): name is string => typeof name === 'string')
          .map(heaterDescriptor)
          .filter((heater): heater is HeaterDescriptor => heater !== null)
      : [];

    const now = Date.now();
    const next = new Map<string, HeaterWatch>();
    for (const descriptor of descriptors) {
      const previous = watch.heaters.get(descriptor.objectName);
      next.set(descriptor.objectName, previous ?? {
        ...descriptor,
        temperature: null,
        target: null,
        detector: initialHeaterDeviationState(now),
      });
    }
    watch.heaters = next;
    removePrinterAlerts(watch.printerId);

    const objects: Record<string, string[]> = { print_stats: ['state'] };
    for (const descriptor of descriptors) objects[descriptor.objectName] = ['temperature', 'target'];
    watch.statusUnsub = watch.handle.subscribe(
      objects,
      (delta) => {
        if (watch.generation === generation) applyStatusDelta(watch, delta);
      },
      { immediate: true },
    );
    void refreshPidActivity(watch, generation);
  }

  /** Creates a complete watcher lifecycle for a newly registered printer. */
  function attachPrinter(printerId: string): void {
    detachPrinter(printerId);
    let handle: MoonrakerProxyHandle;
    let settings: PluginSettingsApi;
    try {
      handle = api.moonrakerFor(printerId);
      settings = api.settingsFor(printerId);
    } catch {
      return;
    }

    const watch: PrinterWatch = {
      printerId,
      generation: 1,
      discovery: 0,
      handle,
      settings,
      threshold: readThreshold(settings),
      printing: false,
      pidHeater: '',
      heaters: new Map(),
      unsubs: [],
      statusUnsub: null,
      gcodeRefreshTimer: null,
    };
    watches.set(printerId, watch);
    const generation = watch.generation;

    watch.unsubs.push(settings.onChange(() => {
      const next = readThreshold(settings);
      if (next === watch.threshold) return;
      watch.threshold = next;
      resetWatch(watch);
    }));
    watch.unsubs.push(handle.onReady(() => {
      if (watch.generation === generation) void subscribeStatus(watch, generation);
    }));
    watch.unsubs.push(handle.onConnectionStatusChange((status) => {
      if (watch.generation !== generation) return;
      if (status === 'open') void subscribeStatus(watch, generation);
      else {
        watch.discovery++;
        if (watch.statusUnsub) {
          watch.statusUnsub();
          watch.statusUnsub = null;
        }
        resetWatch(watch);
      }
    }));
    watch.unsubs.push(handle.onNotify('notify_klippy_ready', () => {
      if (watch.generation !== generation) return;
      watch.pidHeater = '';
      resetWatch(watch);
      void subscribeStatus(watch, generation);
    }));
    watch.unsubs.push(handle.onNotify('notify_config_changed', () => {
      if (watch.generation !== generation) return;
      resetWatch(watch);
      void subscribeStatus(watch, generation);
    }));
    watch.unsubs.push(handle.onNotify('notify_klippy_shutdown', () => {
      if (watch.generation !== generation) return;
      watch.pidHeater = '';
      resetWatch(watch);
    }));
    watch.unsubs.push(handle.onNotify('notify_klippy_started', () => {
      if (watch.generation !== generation) return;
      watch.pidHeater = '';
      resetWatch(watch);
    }));
    watch.unsubs.push(handle.onNotify('notify_klippy_disconnected', () => {
      if (watch.generation !== generation) return;
      watch.pidHeater = '';
      resetWatch(watch);
    }));
    watch.unsubs.push(handle.onNotify('notify_gcode_response', () => {
      if (watch.generation === generation) schedulePidRefresh(watch, generation);
    }));

    void subscribeStatus(watch, generation);
  }

  /** Releases every resource and visible alert owned by a removed printer. */
  function detachPrinter(printerId: string): void {
    const watch = watches.get(printerId);
    if (!watch) return;
    watch.generation++;
    watch.discovery++;
    for (const unsubscribe of watch.unsubs.splice(0)) unsubscribe();
    if (watch.statusUnsub) watch.statusUnsub();
    if (watch.gcodeRefreshTimer !== null) clearTimeout(watch.gcodeRefreshTimer);
    watches.delete(printerId);
    removePrinterAlerts(printerId);
  }

  /** Reconciles watchers against the host's current printer registry. */
  function syncPrinters(): void {
    const alive = new Set(api.printers.map((printer) => printer.id));
    for (const printerId of Array.from(watches.keys())) {
      if (!alive.has(printerId)) detachPrinter(printerId);
    }
    for (const printer of api.printers) {
      if (!watches.has(printer.id)) attachPrinter(printer.id);
    }
  }

  const offPrinters = api.onPrintersChange(syncPrinters);
  syncPrinters();

  return () => {
    offPrinters();
    for (const printerId of Array.from(watches.keys())) detachPrinter(printerId);
  };
}
