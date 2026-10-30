import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types.ts';

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

export type NotificationSeverity = 'critical' | 'error' | 'info';
export type NotificationSource = 'gcode' | 'klippy' | 'tmc' | 'guard' | 'plugin' | 'host' | 'mcu';

export interface NotificationItem {
  id: string;
  printerId: string;
  severity: NotificationSeverity;
  source: NotificationSource;
  text: string;
  time: number;   // unix ms
  seen: boolean;
  dismissed: boolean;
  /** sticky-флаг: toast живёт до явного закрытия пользователем */
  sticky: boolean;
}

const HISTORY_CAP = 200;
const TOAST_CAP = 5;
const DEDUP_MS = 100;

const KLIPPER_CRITICAL_RE = /shutdown|mcu |thermistor|heater .* not heating|lost communication|tmc .* reports/i;

const MPU_NOTIFY_RE = /^echo:\s*MPU_NOTIFY\s+(critical|error|info)\s+(.+)$/i;
const MPU_TEXT_MAX = 240;

// ------------------------------------------------------------------
// Module-level: глобальный центр (агрегатор всех принтеров)
// ------------------------------------------------------------------
let items = $state<NotificationItem[]>([]);
let nextId = 1;

let toastSettings = $state<{ ignoredPatterns: string[]; soundEnabled: boolean }>({
  ignoredPatterns: [],
  soundEnabled: false,
});

// Дедуп per (printerId, source, normalized-text)
const dedup = new Map<string, number>();

// TMC drv_status: per (printerId:tmcName) → Set<flags>
const prevFlags = new Map<string, Set<string>>();

let audioCtx: AudioContext | null = null;

// Per-printer subscriptions (вместо одного generation + unsubs)
interface PrinterSubs {
  generation: number;
  unsubs: Array<() => void>;
  tmcUnsub: (() => void) | null;
  /** подписка на mcu* / canbus_stats* (связь с MCU, шина CAN) */
  healthUnsub: (() => void) | null;
  /** детекторы здоровья: предыдущие статусы и антидребезг этого принтера */
  watch: HealthWatch;
}
const subsByPrinter = new Map<string, PrinterSubs>();

// ------------------------------------------------------------------
// Агрегатор: ОДИН на приложение, живёт, пока есть хотя бы один потребитель
// ------------------------------------------------------------------
function createAggregator(api: PluginApi) {
  // ------------------------------------------------------------------
  // Settings (device-global, sync-aware через api.settings)
  // ------------------------------------------------------------------
  function loadSettings(): void {
    const ignored = api.settings.get<string[]>('system.notifications.ignoredPatterns') ?? [];
    const sound = api.settings.get<boolean>('system.notifications.soundEnabled') ?? false;
    toastSettings = { ignoredPatterns: ignored, soundEnabled: sound };
  }

  function setIgnoredPatterns(list: string[]): void {
    api.settings.set('system.notifications.ignoredPatterns', list);
    toastSettings.ignoredPatterns = [...list];
  }

  function setSoundEnabled(v: boolean): void {
    api.settings.set('system.notifications.soundEnabled', v);
    toastSettings.soundEnabled = v;
  }

  // ------------------------------------------------------------------
  // Вставка + дедуп
  // ------------------------------------------------------------------
  const DEDUP_PRUNE_AT = 500;
  const DEDUP_KEEP_MS = 60_000;
  function isIgnored(text: string): boolean {
    for (const p of toastSettings.ignoredPatterns) {
      if (!p) continue;
      try {
        if (new RegExp(p).test(text)) return true;
      } catch {
        /* невалидный regex — пропускаем */
      }
    }
    return false;
  }

  function dedupKey(printerId: string, n: NotificationItem): string {
    return `${printerId}|${n.source}|${n.text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
  }

  function push(
    printerId: string,
    n: Omit<NotificationItem, 'id' | 'time' | 'seen' | 'dismissed' | 'printerId'>,
  ): void {
    const item: NotificationItem = {
      ...n,
      printerId,
      id: `n${nextId++}`,
      time: Date.now(),
      seen: false,
      dismissed: false,
    };
    const key = dedupKey(printerId, item);
    const last = dedup.get(key);
    if (last && Date.now() - last < DEDUP_MS) return;
    dedup.set(key, Date.now());

    // карта дедупа не должна расти бесконечно (уникальные тексты накапливались вечно)
    if (dedup.size > DEDUP_PRUNE_AT) {
      const cutoff = Date.now() - DEDUP_KEEP_MS;
      for (const [k, t] of dedup) if (t < cutoff) dedup.delete(k);
    }

    items = [item, ...items.slice(0, HISTORY_CAP - 1)];

    if (item.severity === 'critical' && toastSettings.soundEnabled) {
      playBeep();
    }
  }

  // ------------------------------------------------------------------
  // Обработчики источников (все принимают printerId)
  // ------------------------------------------------------------------
  function onGcodeResponse(printerId: string, params: any): void {
    let line = '';
    if (typeof params === 'string') {
      line = params;
    } else if (Array.isArray(params)) {
      line = params[0] ?? '';
    } else if (params && typeof params === 'object') {
      line = String(params.message ?? params.text ?? '');
    }
    if (typeof line !== 'string' || !line.trim()) return;

    const mpu = line.match(MPU_NOTIFY_RE);
    if (mpu) {
      const severity = mpu[1]!.toLowerCase() as 'critical' | 'error' | 'info';
      let text = mpu[2]!.trim().replace(/[\r\n]+/g, ' ');
      if (!text || isIgnored(text)) return;
      if (text.length > MPU_TEXT_MAX) text = text.slice(0, MPU_TEXT_MAX - 1) + '…';
      push(printerId, {
        severity,
        source: 'plugin',
        text,
        sticky: severity === 'critical',
      });
      return;
    }

    if (line.startsWith('!!')) {
      const text = line.slice(2).trim();
      if (!text || isIgnored(text)) return;
      const critical = KLIPPER_CRITICAL_RE.test(text);
      push(printerId, {
        severity: critical ? 'critical' : 'error',
        source: 'gcode',
        text,
        sticky: critical,
      });
      return;
    }

    if (line.startsWith('// Unknown')) {
      const text = line.slice(2).trim();
      if (!text || isIgnored(text)) return;
      push(printerId, {
        severity: 'error',
        source: 'gcode',
        text,
        sticky: false,
      });
      return;
    }
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
    if (isIgnored(text)) return;
    push(printerId, { severity: 'critical', source: 'klippy', text, sticky: true });
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
          if (isIgnored(text)) continue;
          const critical = TMC_CRITICAL_FLAGS.has(f);
          push(printerId, {
            severity: critical ? 'critical' : 'error',
            source: 'tmc',
            text,
            sticky: critical,
          });
        }
      }

      prevFlags.set(key, cur);
    }
  }

  // host-core диспатчит mpu:guard-notify (fail-closed таймауты). target-scoped
  // гарды (Фаза 2) несут targetPrinterId в detail — атрибутация по принтеру.
  function onGuardNotifyEvent(e: Event): void {
    const d = (e as CustomEvent).detail as
      | {
          kind: 'decision_timeout' | 'park_timeout' | 'denied';
          pluginId: string;
          guardId: string;
          method: string;
          targetPrinterId?: string;
          reasonKey?: string;
        }
      | undefined;
    if (!d) return;
    const printerId = d.targetPrinterId ?? api.printer.id;
    const text =
      d.kind === 'park_timeout'
        ? api.i18n.t('system.notifications.guardParkTimeout', { method: d.method })
        : d.kind === 'decision_timeout'
          ? api.i18n.t('system.notifications.guardDecisionTimeout', {
              guard: d.guardId,
              plugin: d.pluginId,
              method: d.method,
            })
          : d.reasonKey
            ? api.i18n.t(d.reasonKey)
            : api.i18n.t('system.notifications.guardDenied', {
                plugin: d.pluginId,
                method: d.method,
              });
    push(printerId, { severity: 'error', source: 'guard', text, sticky: false });
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
      const text = alertText(a);
      if (isIgnored(text)) continue;
      push(printerId, {
        severity: a.severity,
        source: a.kind === 'throttle' ? 'host' : 'mcu',
        text,
        sticky: a.sticky,
      });
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
  // Действия
  // ------------------------------------------------------------------
  function dismiss(id: string): void {
    items = items.map((n) => (n.id === id ? { ...n, dismissed: true, seen: true } : n));
  }

  function dismissAll(): void {
    items = items.map((n) => ({ ...n, dismissed: true, seen: true }));
  }

  function markSeen(id: string): void {
    items = items.map((n) => (n.id === id ? { ...n, seen: true } : n));
  }

  // ------------------------------------------------------------------
  // Звук
  // ------------------------------------------------------------------
  function playBeep(): void {
    try {
      const Ctx = (window.AudioContext ||
        (window as any).webkitAudioContext) as typeof AudioContext;
      if (!audioCtx) audioCtx = new Ctx();
      const ctx = audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.26);
    } catch {
      /* звук недоступен — молча */
    }
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

    // Guard events — один listener на всё приложение (окно-событие)
    // подписывается в init; здесь только per-printer moonraker listeners

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

    // Cleanup per-printer TMC state (не теряем глобальную историю)
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

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------
  // api.settings.onChange привязан к принтеру, активному в момент подписки, и вызывает
  // колбэк с ключом '' (а не именем ключа) — поэтому фильтр по префиксу здесь не
  // работал, и настройки не перечитывались; перечитываем всё и переподписываемся
  // при смене принтера.
  const offs: Array<() => void> = [];
  let offSettings: (() => void) | null = null;

  function start(): void {
    loadSettings();

    offs.push(api.onPrintersChange(() => syncPrinters()));

    offSettings = api.settings.onChange(() => loadSettings());
    offs.push(
      api.onPrinterChange(() => {
        offSettings?.();
        offSettings = api.settings.onChange(() => loadSettings());
        loadSettings();
      }),
    );
    offs.push(() => offSettings?.());

    window.addEventListener('mpu:guard-notify', onGuardNotifyEvent as EventListener);
    offs.push(() => window.removeEventListener('mpu:guard-notify', onGuardNotifyEvent as EventListener));

    // Initial subscribe for all existing printers
    syncPrinters();
  }

  function stop(): void {
    for (const off of offs.splice(0)) off();
    offSettings = null;
    for (const pid of Array.from(subsByPrinter.keys())) detachPrinter(pid);
  }

  // ------------------------------------------------------------------
  // Public
  // ------------------------------------------------------------------
  // Не $derived: агрегатор создаётся в инициализации первого потребителя, и derived
  // уничтожается вместе с его компонентом (например, при перемонтировании правой
  // панели) — после этого тосты переставали реагировать на dismiss. Геттер читает
  // модульный $state напрямую, поэтому реактивен в любом потребителе.
  const store = {
    get items() {
      return items;
    },
    get activeToasts() {
      return items.filter((n) => !n.dismissed).slice(0, TOAST_CAP);
    },
    get unseenCount() {
      return items.filter((n) => !n.seen).length;
    },
    get settings() {
      return toastSettings;
    },
    dismiss,
    dismissAll,
    markSeen,
    setIgnoredPatterns,
    setSoundEnabled,
  };

  return { store, start, stop, push };
}

let aggregator: ReturnType<typeof createAggregator> | null = null;
let consumers = 0;

/**
 * Хук уведомлений. Потребителей несколько (оверлей, стек тостов, правая панель), а
 * подписки на принтеры — одни: агрегатор стартует с первым потребителем и
 * останавливается с последним. Раньше onDestroy ЛЮБОГО потребителя (например,
 * правой панели при её перемонтировании) снимал подписки у всех остальных.
 */
export function useNotifications(api: PluginApi) {
  aggregator ??= createAggregator(api);
  if (consumers++ === 0) aggregator.start();

  onDestroy(() => {
    if (--consumers === 0) aggregator?.stop();
  });

  return aggregator.store;
}

/**
 * Локальное уведомление от самого плагина (например, ошибка действия в правой
 * панели). Работает, пока смонтирован хотя бы один потребитель (оверлей
 * уведомлений смонтирован всегда).
 */
export function notifyLocal(
  printerId: string,
  n: Omit<NotificationItem, 'id' | 'time' | 'seen' | 'dismissed' | 'printerId'>,
): void {
  aggregator?.push(printerId, n);
}

export type NotificationsStore = ReturnType<typeof useNotifications>;