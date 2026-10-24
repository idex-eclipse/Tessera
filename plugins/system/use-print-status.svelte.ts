import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../shared/core-keeper/core-keeper';

export type ProgressMode = 'file' | 'time' | 'filament';
export type StatusPlacement = 'widget' | 'banner' | 'both';

export interface PrintStatusModel {
  klippyReady: boolean;
  state: string;
  message: string;
  filename: string;
  printDuration: number;
  totalDuration: number;
  filamentUsed: number | null; // mm
  fileProgress: number | null; // 0..1
  liveVelocity: number | null;
  liveExtruderVelocity: number | null;
  currentLayer: number | null;
  totalLayer: number | null;
  estimatedTime: number | null; // sec
  filamentTotal: number | null; // mm
  filamentDiameter: number;
}

function empty(): PrintStatusModel {
  return {
    klippyReady: false,
    state: 'standby',
    message: '',
    filename: '',
    printDuration: 0,
    totalDuration: 0,
    filamentUsed: null,
    fileProgress: null,
    liveVelocity: null,
    liveExtruderVelocity: null,
    currentLayer: null,
    totalLayer: null,
    estimatedTime: null,
    filamentTotal: null,
    filamentDiameter: 1.75,
  };
}

export type StatusFieldId =
  | 'speed' | 'flow' | 'filament'
  | 'slicer' | 'elapsed' | 'total'
  | 'layer' | 'remaining' | 'eta';

export const FIELD_GROUPS: Array<{ id: string; titleKey: string; fields: StatusFieldId[] }> = [
  { id: 'live', titleKey: 'system.status.groupLive', fields: ['speed', 'flow', 'filament'] },
  { id: 'time', titleKey: 'system.status.groupTime', fields: ['slicer', 'elapsed', 'total'] },
  { id: 'forecast', titleKey: 'system.status.groupForecast', fields: ['layer', 'remaining', 'eta'] },
];

export const DEFAULT_FIELDS: StatusFieldId[] = FIELD_GROUPS.flatMap((g) => g.fields);

export function readEnabledFields(api: PluginApi): StatusFieldId[] {
  const stored = api.settings.get<StatusFieldId[]>('status.fields');
  if (Array.isArray(stored)) return DEFAULT_FIELDS.filter((f) => stored.includes(f));
  return [...DEFAULT_FIELDS];
}

const KLIPPY_EVENTS = [
  'notify_klippy_shutdown',
  'notify_klippy_ready',
  'notify_klippy_disconnected',
  'notify_klippy_started',
];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ------------------------------------------------------------------
// Math (progress/ETA/flowrate) — чистые функции, остаются module-level
// ------------------------------------------------------------------

export function computeProgress(m: PrintStatusModel, mode: ProgressMode): number | null {
  if (mode === 'time') {
    if (!m.estimatedTime || m.estimatedTime <= 0) return null;
    return Math.min(1, m.printDuration / m.estimatedTime);
  }
  if (mode === 'filament') {
    if (!m.filamentTotal || m.filamentTotal <= 0 || m.filamentUsed == null) return null;
    return Math.min(1, m.filamentUsed / m.filamentTotal);
  }
  return m.fileProgress;
}

export function computeRemaining(m: PrintStatusModel, mode: ProgressMode): number | null {
  if (mode === 'time') {
    if (!m.estimatedTime) return null;
    return Math.max(0, m.estimatedTime - m.printDuration);
  }
  if (mode === 'filament') {
    if (m.filamentTotal == null || m.filamentUsed == null) return null;
    const rate = m.printDuration > 1 ? m.filamentUsed / m.printDuration : null;
    if (!rate || rate <= 0) return null;
    return Math.max(0, (m.filamentTotal - m.filamentUsed) / rate);
  }
  const p = m.fileProgress;
  if (p == null || p <= 0.001) return null;
  return Math.max(0, (m.printDuration * (1 - p)) / p);
}

export function computeEta(m: PrintStatusModel, mode: ProgressMode): Date | null {
  const rem = computeRemaining(m, mode);
  if (rem == null) return null;
  return new Date(Date.now() + rem * 1000);
}

export function computeFlow(m: PrintStatusModel): number | null {
  if (m.liveExtruderVelocity == null) return null;
  const r = m.filamentDiameter / 2;
  return m.liveExtruderVelocity * Math.PI * r * r;
}

export interface DurationUnits {
  h: string;
  m: string;
  s: string;
}

const DEFAULT_UNITS: DurationUnits = { h: 'h', m: 'm', s: 's' };

/** Единицы времени из i18n плагина (раньше были зашиты латиницей). */
export function durationUnits(t: (key: string) => string): DurationUnits {
  return { h: t('system.units.h'), m: t('system.units.m'), s: t('system.units.s') };
}

export function fmtDuration(sec: number | null, u: DurationUnits = DEFAULT_UNITS): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}${u.h} ${m}${u.m}`;
  if (m > 0) return `${m}${u.m} ${ss}${u.s}`;
  return `${ss}${u.s}`;
}

/** locale — язык интерфейса (api.i18n.locale), а не язык браузера. */
export function fmtClock(d: Date | null, locale?: string): string {
  if (!d) return '—';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// Legacy-режим (без printerId) = делегат, следующий за активным принтером.
// Fleet-режим (с printerId) = прямое ядро с удержанием.
// ------------------------------------------------------------------
function createPrintStatusCore(api: PluginApi, printerId: string) {
  let model = $state<PrintStatusModel>(empty());

  let generation = 0;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  async function loadKlippy(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const info = await h.request<any>('server.info').catch(() => null);
    if (gen !== generation) return;
    const next = { ...model, klippyReady: info?.klippy_state === 'ready' };
    model = next;
    if (next.klippyReady) void loadDiameter(gen);
  }

  async function loadDiameter(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const res = await h
      .request<any>('printer.objects.query', { objects: { configfile: ['settings'] } })
      .catch(() => null);
    if (gen !== generation) return;
    const d = num(res?.status?.configfile?.settings?.extruder?.filament_diameter);
    if (d && d > 0) model = { ...model, filamentDiameter: d };
  }

  async function loadMetadata(gen: number): Promise<void> {
    const h = safeHandle();
    const fn = model.filename;
    if (!h || !fn) return;
    const md = await h.request<any>('server.files.metadata', { filename: fn }).catch(() => null);
    if (gen !== generation) return;
    model = {
      ...model,
      estimatedTime: num(md?.estimated_time),
      filamentTotal: num(md?.filament_total),
    };
  }

  function applyDelta(d: any): void {
    const ps = d?.print_stats;
    const vs = d?.virtual_sdcard;
    const mr = d?.motion_report;

    const next = { ...model };
    let filenameChanged = false;

    if (ps) {
      if (typeof ps.state === 'string') next.state = ps.state;
      if (typeof ps.message === 'string') next.message = ps.message;
      if (typeof ps.filename === 'string' && ps.filename !== model.filename) {
        next.filename = ps.filename;
        filenameChanged = true;
        // метаданные прежнего файла (оценка времени, расход) к новому не относятся;
        // при пустом имени (печать завершена) loadMetadata ничего не загрузит —
        // без сброса остались бы устаревшие значения
        next.estimatedTime = null;
        next.filamentTotal = null;
      }
      const pd = num(ps.print_duration);
      if (pd != null) next.printDuration = pd;
      const td = num(ps.total_duration);
      if (td != null) next.totalDuration = td;
      const fu = num(ps.filament_used);
      if (fu != null) next.filamentUsed = fu;
      next.currentLayer = num(ps.info?.current_layer) ?? next.currentLayer;
      next.totalLayer = num(ps.info?.total_layer) ?? next.totalLayer;
    }
    if (vs) {
      const p = num(vs.progress);
      if (p != null) next.fileProgress = p;
    }
    if (mr) {
      const v = num(mr.live_velocity);
      if (v != null) next.liveVelocity = v;
      const ev = num(mr.live_extruder_velocity);
      if (ev != null) next.liveExtruderVelocity = ev;
    }

    model = next;
    if (filenameChanged) void loadMetadata(generation);
  }

  async function reseed(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const res = await h
      .request<any>('printer.objects.query', {
        objects: {
          print_stats: [
            'state', 'message', 'filename', 'print_duration', 'total_duration',
            'filament_used', 'info',
          ],
          virtual_sdcard: ['progress'],
          motion_report: ['live_velocity', 'live_extruder_velocity'],
        },
      })
      .catch(() => null);
    if (gen !== generation) return;
    if (res?.status) applyDelta(res.status);
  }

  function teardown(): void {
    generation++;
    for (const u of unsubs.splice(0)) u();
  }

  async function init(): Promise<void> {
    const gen = ++generation;
    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.subscribe(
        {
          print_stats: [
            'state', 'message', 'filename', 'print_duration', 'total_duration',
            'filament_used', 'info',
          ],
          virtual_sdcard: ['progress'],
          motion_report: ['live_velocity', 'live_extruder_velocity'],
        },
        (delta: any) => {
          if (gen === generation) applyDelta(delta);
        },
        { immediate: true },
      ),
    );

    unsubs.push(h.onReady(() => {
      if (gen === generation) {
        void loadKlippy(gen);
        void loadMetadata(gen);
      }
    }));

    for (const ev of KLIPPY_EVENTS) {
      unsubs.push(h.onNotify(ev, () => {
        if (gen !== generation) return;
        void loadKlippy(gen);
        if (ev === 'notify_klippy_ready') {
          void reseed(gen);
        } else {
          model = { ...empty(), filamentDiameter: model.filamentDiameter };
        }
      }));
    }

    await loadKlippy(gen);
    await loadMetadata(gen);
  }

  init();

  function destroy(): void {
    teardown();
  }

  return {
    get model() {
      return model;
    },
    destroy,
  };
}

export type PrintStatusStore = ReturnType<typeof createPrintStatusCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<PrintStatusStore>({
  create: (pid, api) => createPrintStatusCore(api, pid),
  cap: 4,
});

/**
 * Хук статуса печати.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * refcount на текущего принтера, ядра других принтеров живут в keeper по
 * политике keep-alive. С printerId — fleet: прямое ядро с удержанием.
 */
export function usePrintStatus(api: PluginApi, printerId?: string): PrintStatusStore {
  if (printerId !== undefined) {
    const core = keeper.acquire(printerId, api);
    const offPrinters = api.onPrintersChange((printers) => {
      keeper.prune(printers.map((p) => p.id));
    });
    onDestroy(() => {
      offPrinters();
      keeper.release(printerId);
    });
    return core;
  }

  let heldPid = api.printer.id;
  keeper.acquire(heldPid, api);

  const offPrinter = api.onPrinterChange((p) => {
    keeper.release(heldPid);
    heldPid = p.id;
    keeper.acquire(heldPid, api);
  });

  const offPrinters = api.onPrintersChange((printers) => {
    keeper.prune(printers.map((p) => p.id));
  });

  onDestroy(() => {
    offPrinter();
    offPrinters();
    keeper.release(heldPid);
  });

  // Делегат: каждое чтение уходит в ядро ТЕКУЩЕГО активного принтера;
  // сигнал api.printer.id даёт реактивность смены вкладки.
  return createDelegateStore<PrintStatusStore>(() => keeper.get(api.printer.id, api));
}