import type {
  MoonrakerProxyHandle,
  NotificationSeverity,
  PluginApi,
} from '../../plugin-sdk/src/types.ts';

import { createHealthWatch, type HealthAlert, type HealthWatch } from './health-alerts.ts';
import { CANBUS_FIELDS, MCU_FIELDS } from './health-model.ts';
import {
  isFlagSet,
  matchCanbus,
  matchMcu,
  matchTmc,
  TMC_CRITICAL_FLAGS,
  TMC_ERROR_FLAGS,
} from './health-utils.ts';

/**
 * Продюсеры уведомлений @core/system: всё, что завязано на Klipper и Moonraker.
 * Хранилище, фильтр, дедуп и интерфейс — в центре уведомлений хоста
 * (api.notifications.push); здесь только источники.
 */

const KLIPPER_CRITICAL_RE = /shutdown|mcu |thermistor|heater .* not heating|lost communication|tmc .* reports/i;

/**
 * Внешний вход: макрос Klipper `M118 MPU_NOTIFY <critical|error|info> <текст>`.
 * Klipper отдаёт M118 как `echo: …` в notify_gcode_response.
 */
const MPU_NOTIFY_RE = /^echo:\s*MPU_NOTIFY\s+(critical|error|info)\s+(.+)$/i;

export type GcodeSource = 'macro' | 'gcode';

export interface ParsedGcodeNotification {
  severity: NotificationSeverity;
  /** Ключ подписи источника: system.notifications.src.<source>. */
  source: GcodeSource;
  text: string;
}

/** Строка из notify_gcode_response (строка, массив или объект) → уведомление или null. */
export function parseGcodeResponse(params: unknown): ParsedGcodeNotification | null {
  let line: unknown = '';
  if (typeof params === 'string') {
    line = params;
  } else if (Array.isArray(params)) {
    line = params[0] ?? '';
  } else if (params && typeof params === 'object') {
    const p = params as { message?: unknown; text?: unknown };
    line = String(p.message ?? p.text ?? '');
  }
  if (typeof line !== 'string' || !line.trim()) return null;

  const mpu = line.match(MPU_NOTIFY_RE);
  if (mpu) {
    const text = mpu[2]!.trim().replace(/[\r\n]+/g, ' ');
    if (!text) return null;
    return { severity: mpu[1]!.toLowerCase() as NotificationSeverity, source: 'macro', text };
  }

  if (line.startsWith('!!')) {
    const text = line.slice(2).trim();
    if (!text) return null;
    return {
      severity: KLIPPER_CRITICAL_RE.test(text) ? 'critical' : 'error',
      source: 'gcode',
      text,
    };
  }

  if (line.startsWith('// Unknown')) {
    const text = line.slice(2).trim();
    if (!text) return null;
    return { severity: 'error', source: 'gcode', text };
  }

  return null;
}

interface PrinterSubs {
  generation: number;
  unsubs: Array<() => void>;
  tmcUnsub: (() => void) | null;
  /** подписка на mcu* / canbus_stats* (связь с MCU, шина CAN) */
  healthUnsub: (() => void) | null;
  /** детекторы здоровья: предыдущие статусы и антидребезг этого принтера */
  watch: HealthWatch;
}

/**
 * Запускает продюсеры для всех принтеров и возвращает функцию остановки.
 * Один запуск на приложение: его делает всегда смонтированный оверлей плагина.
 */
export function startNotificationProducers(api: PluginApi): () => void {
  // TMC drv_status: per (printerId:tmcName) → Set<flags>
  const prevFlags = new Map<string, Set<string>>();
  const subsByPrinter = new Map<string, PrinterSubs>();

  function push(
    printerId: string,
    severity: NotificationSeverity,
    source: 'gcode' | 'macro' | 'klippy' | 'tmc' | 'host' | 'mcu',
    text: string,
  ): void {
    api.notifications.push({
      printerId,
      severity,
      label: api.i18n.t(`system.notifications.src.${source}`),
      text,
    });
  }

  // ------------------------------------------------------------------
  // Обработчики источников (все принимают printerId)
  // ------------------------------------------------------------------
  function onGcodeResponse(printerId: string, params: unknown): void {
    const n = parseGcodeResponse(params);
    if (n) push(printerId, n.severity, n.source, n.text);
  }

  function onKlippyShutdown(printerId: string, params: any): void {
    let reason = '';
    if (typeof params === 'string') {
      reason = params;
    } else if (Array.isArray(params)) {
      reason = params[0] ?? '';
    } else if (params && typeof params === 'object') {
      reason = String(params.reason ?? params.message ?? '');
    }
    const text = reason
      ? api.i18n.t('system.notifications.klipperShutdownReason', { reason })
      : api.i18n.t('system.notifications.klipperShutdown');
    push(printerId, 'critical', 'klippy', text);
  }

  function applyTmcDelta(printerId: string, delta: any): void {
    if (!delta || typeof delta !== 'object') return;
    for (const [name, d] of Object.entries(delta)) {
      if (!matchTmc(name)) continue;
      const rec = d as any;
      const drv = rec?.drv_status;
      if (!drv || typeof drv !== 'object') continue;

      const key = `${printerId}:${name}`;
      const prev = prevFlags.get(key) ?? new Set();
      const cur = new Set<string>();
      for (const f of TMC_ERROR_FLAGS) {
        if (isFlagSet(drv[f])) cur.add(f);
      }

      for (const f of cur) {
        if (!prev.has(f)) {
          const text = api.i18n.t('system.notifications.tmcFlag', { name, flag: f });
          push(printerId, TMC_CRITICAL_FLAGS.has(f) ? 'critical' : 'error', 'tmc', text);
        }
      }

      prevFlags.set(key, cur);
    }
  }

  // ------------------------------------------------------------------
  // TMC подписка (feature-detect по objects.list конкретного принтера)
  // ------------------------------------------------------------------
  async function subscribeTmc(printerId: string, gen: number): Promise<void> {
    const ps = subsByPrinter.get(printerId);
    if (!ps || ps.generation !== gen) return;

    if (ps.tmcUnsub) {
      ps.tmcUnsub();
      ps.tmcUnsub = null;
    }

    let h: MoonrakerProxyHandle;
    try {
      h = api.moonrakerFor(printerId);
    } catch {
      return;
    }
    if (h.readyState !== 'open') return;

    const list = await h.request<any>('printer.objects.list').catch(() => null);
    const current = subsByPrinter.get(printerId);
    if (!current || current.generation !== gen || !list) return;

    const names = (list.objects ?? []).filter((n: string) => typeof n === 'string' && matchTmc(n));
    if (names.length === 0) return;

    const objects: Record<string, string[]> = {};
    for (const n of names) objects[n] = ['drv_status', 'temperature'];

    current.tmcUnsub = h.subscribe(
      objects,
      (d: any) => {
        if (current.generation === gen) applyTmcDelta(printerId, d);
      },
      { immediate: true },
    );
  }

  // ------------------------------------------------------------------
  // Здоровье: троттлинг хоста, связь с MCU, шина CAN
  // ------------------------------------------------------------------
  function alertText(a: HealthAlert): string {
    switch (a.kind) {
      case 'throttle':
        return api.i18n.t('system.notifications.throttle', {
          flag: api.i18n.t(`system.throttle.${a.flag}`),
        });
      case 'mcuLink':
        return api.i18n.t('system.notifications.mcuLink', {
          name: a.mcu,
          reason: api.i18n.t(`system.link.reason.${a.reason}`),
        });
      case 'canbus': {
        const key = `system.link.bus.${a.state}`;
        const label = api.i18n.t(key);
        return api.i18n.t('system.notifications.canbus', {
          name: a.mcu,
          state: label === key ? a.state : label,
        });
      }
    }
  }

  function pushAlerts(printerId: string, alerts: HealthAlert[]): void {
    for (const a of alerts) {
      push(printerId, a.severity, a.kind === 'throttle' ? 'host' : 'mcu', alertText(a));
    }
  }

  function onThrottleRaw(printerId: string, ps: PrinterSubs, raw: unknown): void {
    pushAlerts(printerId, ps.watch.onThrottle(raw));
  }

  async function subscribeHealth(printerId: string, gen: number): Promise<void> {
    const ps = subsByPrinter.get(printerId);
    if (!ps || ps.generation !== gen) return;

    if (ps.healthUnsub) {
      ps.healthUnsub();
      ps.healthUnsub = null;
    }

    let h: MoonrakerProxyHandle;
    try {
      h = api.moonrakerFor(printerId);
    } catch {
      return;
    }
    if (h.readyState !== 'open') return;

    // текущее состояние троттлинга — дальше его присылает Moonraker
    void h
      .request<any>('machine.proc_stats')
      .then((res) => {
        if (subsByPrinter.get(printerId)?.generation === gen) {
          onThrottleRaw(printerId, ps, res?.throttled_state);
        }
      })
      .catch(() => {});

    const list = await h.request<any>('printer.objects.list').catch(() => null);
    const current = subsByPrinter.get(printerId);
    if (!current || current.generation !== gen || !list) return;

    const objects: Record<string, string[]> = {};
    const known = new Set<string>();
    for (const n of list.objects ?? []) {
      if (typeof n !== 'string') continue;
      if (matchMcu(n)) objects[n] = MCU_FIELDS;
      else if (matchCanbus(n)) objects[n] = CANBUS_FIELDS;
      else continue;
      known.add(n);
    }
    current.watch.retain(known);
    if (known.size === 0) return;

    current.healthUnsub = h.subscribe(
      objects,
      (d: any) => {
        if (current.generation === gen) pushAlerts(printerId, current.watch.onDelta(d));
      },
      { immediate: true },
    );
  }

  /** Переподписка по тем же триггерам, что и у TMC (ready / открытие соединения / klippy ready). */
  function resubscribe(printerId: string, gen: number): void {
    void subscribeTmc(printerId, gen);
    void subscribeHealth(printerId, gen);
  }

  // ------------------------------------------------------------------
  // Per-printer подписки
  // ------------------------------------------------------------------
  function attachPrinter(printerId: string): void {
    detachPrinter(printerId);

    let h: MoonrakerProxyHandle;
    try {
      h = api.moonrakerFor(printerId);
    } catch {
      return;
    }

    const ps: PrinterSubs = {
      generation: 1,
      unsubs: [],
      tmcUnsub: null,
      healthUnsub: null,
      watch: createHealthWatch(),
    };
    subsByPrinter.set(printerId, ps);
    const gen = ps.generation;

    ps.unsubs.push(
      h.onReady(() => {
        if (ps.generation === gen) resubscribe(printerId, gen);
      }),
    );

    ps.unsubs.push(
      h.onConnectionStatusChange((s) => {
        if (s === 'open' && ps.generation === gen) resubscribe(printerId, gen);
      }),
    );

    ps.unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (ps.generation !== gen) return;
        ps.watch.klippyReady(true);
        resubscribe(printerId, gen);
      }),
    );

    // рестарт Klipper: связь с MCU переустанавливается — ретрансмиты в этот момент штатны
    for (const ev of ['notify_klippy_started', 'notify_klippy_shutdown', 'notify_klippy_disconnected']) {
      ps.unsubs.push(
        h.onNotify(ev, () => {
          if (ps.generation === gen) ps.watch.klippyReady(false);
        }),
      );
    }

    // Moonraker присылает смену троттлинга отдельным событием; на всякий случай
    // слушаем и поле throttled_state в обычном пуше статистики (проверка — по ключу, дёшево)
    ps.unsubs.push(
      h.onNotify('notify_cpu_throttled', (params: any) => {
        if (ps.generation === gen) onThrottleRaw(printerId, ps, Array.isArray(params) ? params[0] : params);
      }),
    );

    ps.unsubs.push(
      h.onNotify('notify_proc_stat_update', (params: any) => {
        if (ps.generation !== gen) return;
        const p = Array.isArray(params) ? params[0] : params;
        if (p && typeof p === 'object' && 'throttled_state' in p) onThrottleRaw(printerId, ps, p.throttled_state);
      }),
    );

    ps.unsubs.push(
      h.onNotify('notify_gcode_response', (line: any) => {
        if (ps.generation === gen) onGcodeResponse(printerId, line);
      }),
    );

    ps.unsubs.push(
      h.onNotify('notify_klippy_shutdown', (params: any) => {
        if (ps.generation === gen) onKlippyShutdown(printerId, params);
      }),
    );

    resubscribe(printerId, gen);
  }

  function detachPrinter(printerId: string): void {
    const ps = subsByPrinter.get(printerId);
    if (!ps) return;
    ps.generation++;
    for (const u of ps.unsubs.splice(0)) u();
    if (ps.tmcUnsub) {
      ps.tmcUnsub();
      ps.tmcUnsub = null;
    }
    if (ps.healthUnsub) {
      ps.healthUnsub();
      ps.healthUnsub = null;
    }
    subsByPrinter.delete(printerId);

    // Cleanup per-printer TMC state (история уведомлений живёт в хосте)
    for (const key of Array.from(prevFlags.keys())) {
      if (key.startsWith(`${printerId}:`)) prevFlags.delete(key);
    }
  }

  function syncPrinters(): void {
    const alive = new Set(api.printers.map((p) => p.id));

    for (const pid of Array.from(subsByPrinter.keys())) {
      if (!alive.has(pid)) detachPrinter(pid);
    }

    for (const p of api.printers) {
      if (!subsByPrinter.has(p.id)) attachPrinter(p.id);
    }
  }

  const offPrinters = api.onPrintersChange(() => syncPrinters());
  syncPrinters();

  return () => {
    offPrinters();
    for (const pid of Array.from(subsByPrinter.keys())) detachPrinter(pid);
  };
}
