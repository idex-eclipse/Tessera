import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';

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
  { id: 'live', titleKey: 'widgets.status.groupLive', fields: ['speed', 'flow', 'filament'] },
  { id: 'time', titleKey: 'widgets.status.groupTime', fields: ['slicer', 'elapsed', 'total'] },
  { id: 'forecast', titleKey: 'widgets.status.groupForecast', fields: ['layer', 'remaining', 'eta'] },
];

export const DEFAULT_FIELDS: StatusFieldId[] = FIELD_GROUPS.flatMap((g) => g.fields);

export function readEnabledFields(api: PluginApi): StatusFieldId[] {
  const stored = api.settings.get<StatusFieldId[]>('status.fields');
  if (Array.isArray(stored)) return DEFAULT_FIELDS.filter((f) => stored.includes(f));
  return [...DEFAULT_FIELDS];
}

// ------------------------------------------------------------------
// Module-state: legacy-поток (активный принтер). Виджет и баннер
// статуса шарят его, как раньше.
// ------------------------------------------------------------------
let model = $state<PrintStatusModel>(empty());

// Fleet-кэш модели per-printer: мгновенная отрисовка карточки из
// последнего известного состояния, пока subscribe-дельты не догнали.
const fleetModelCache = new Map<string, PrintStatusModel>();

const KLIPPY_EVENTS = [
  'notify_klippy_shutdown',
  'notify_klippy_ready',
  'notify_klippy_disconnected',
  'notify_klippy_started',
];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// math (progress/ETA/flowrate)

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

/** Flow */
export function computeFlow(m: PrintStatusModel): number | null {
  if (m.liveExtruderVelocity == null) return null;
  const r = m.filamentDiameter / 2;
  return m.liveExtruderVelocity * Math.PI * r * r;
}

export function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

export function fmtClock(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ------------------------------------------------------------------
// hook
// ------------------------------------------------------------------

/**
 * Хук статуса печати.
 *
 * Без printerId — прежнее поведение: активный принтер, module-state,
 * ресет/реинициализация на onPrinterChange.
 *
 * С printerId — fleet-режим: instance-local state (N карточек = N
 * независимых сторов), статическая привязка к принтеру,
 * model кэшируется per-printer (мгновенная отрисовка при remount).
 */
export function usePrintStatus(api: PluginApi, printerId?: string) {
  const fleet = printerId !== undefined;

  // Fleet: состояние экземпляра.
  let localModel = $state<PrintStatusModel>(
    fleet
      ? (fleetModelCache.get(printerId as string) ?? empty())
      : empty(),
  );

  const getModel = (): PrintStatusModel => (fleet ? localModel : model);
  const setModel = (m: PrintStatusModel): void => {
    if (fleet) {
      localModel = m;
      fleetModelCache.set(printerId as string, m);
    } else {
      model = m;
    }
  };

  let generation = 0;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return fleet ? api.moonrakerFor(printerId as string) : api.moonraker();
    } catch {
      return null;
    }
  }

  async function loadKlippy(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const info = await h.request<any>('server.info').catch(() => null);
    if (gen !== generation) return;
    const next = { ...getModel(), klippyReady: info?.klippy_state === 'ready' };
    setModel(next);
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
    if (d && d > 0) setModel({ ...getModel(), filamentDiameter: d });
  }

  async function loadMetadata(gen: number): Promise<void> {
    const h = safeHandle();
    const fn = getModel().filename;
    if (!h || !fn) return;
    const md = await h.request<any>('server.files.metadata', { filename: fn }).catch(() => null);
    if (gen !== generation) return;
    setModel({
      ...getModel(),
      estimatedTime: num(md?.estimated_time),
      filamentTotal: num(md?.filament_total),
    });
  }

  function applyDelta(d: any): void {
    const ps = d?.print_stats;
    const vs = d?.virtual_sdcard;
    const mr = d?.motion_report;

    const current = getModel();
    const next = { ...current };
    let filenameChanged = false;

    if (ps) {
      if (typeof ps.state === 'string') next.state = ps.state;
      if (typeof ps.message === 'string') next.message = ps.message;
      if (typeof ps.filename === 'string' && ps.filename !== current.filename) {
        next.filename = ps.filename;
        filenameChanged = true;
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

    setModel(next);
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
    if (!fleet && !api.printer.url) return;

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
          const current = getModel();
          setModel({ ...empty(), filamentDiameter: current.filamentDiameter });
        }
      }));
    }

    await loadKlippy(gen);
    await loadMetadata(gen);
  }

  init();

  if (fleet) {
    onDestroy(() => {
      teardown();
    });
  } else {
    const offPrinter = api.onPrinterChange(() => {
      teardown();
      model = empty();
      void init();
    });

    onDestroy(() => {
      teardown();
      offPrinter();
    });
  }

  return {
    get model() {
      return getModel();
    },
  };
}