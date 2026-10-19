import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types.ts';

export type NotificationSeverity = 'critical' | 'error' | 'info';
export type NotificationSource = 'gcode' | 'klippy' | 'tmc' | 'guard' | 'plugin';

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

const TMC_ERROR_FLAGS = new Set([
  'ot', 'otpw',
  's2ga', 's2gb', 's2vsa', 's2vsb',
  'ola', 'olb',
]);
const TMC_CRITICAL_FLAGS = new Set([
  'ot', 's2ga', 's2gb', 's2vsa', 's2vsb',
]);

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
}
const subsByPrinter = new Map<string, PrinterSubs>();

// ------------------------------------------------------------------
// Хук: один агрегатор на всё приложение
// ------------------------------------------------------------------
export function useNotifications(api: PluginApi) {
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
      const severity = mpu[1].toLowerCase() as 'critical' | 'error' | 'info';
      let text = mpu[2].trim().replace(/[\r\n]+/g, ' ');
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
    const text = reason ? `Klipper shutdown: ${reason}` : 'Klipper shutdown';
    if (isIgnored(text)) return;
    push(printerId, { severity: 'critical', source: 'klippy', text, sticky: true });
  }

  function applyTmcDelta(printerId: string, delta: any): void {
    if (!delta || typeof delta !== 'object') return;
    for (const [name, d] of Object.entries(delta)) {
      if (!/^tmc\d+ /.test(name) && !/^tmc\d+$/.test(name)) continue;
      const rec = d as any;
      const drv = rec?.drv_status;
      if (!drv || typeof drv !== 'object') continue;

      const key = `${printerId}:${name}`;
      const prev = prevFlags.get(key) ?? new Set();
      const cur = new Set<string>();
      for (const f of TMC_ERROR_FLAGS) {
        const v = drv[f];
        if (v !== undefined && v !== null && v !== 0 && v !== false) cur.add(f);
      }

      for (const f of cur) {
        if (!prev.has(f)) {
          const text = `TMC ${name}: ${f}`;
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

    const names = (list.objects ?? []).filter(
      (n: string) => typeof n === 'string' && (/^tmc\d+ /.test(n) || /^tmc\d+$/.test(n)),
    );
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
    };
    subsByPrinter.set(printerId, ps);
    const gen = ps.generation;

    // Guard events — один listener на всё приложение (окно-событие)
    // подписывается в init; здесь только per-printer moonraker listeners

    ps.unsubs.push(
      h.onReady(() => {
        if (ps.generation === gen) void subscribeTmc(printerId, gen);
      }),
    );

    ps.unsubs.push(
      h.onConnectionStatusChange((s) => {
        if (s === 'open' && ps.generation === gen) void subscribeTmc(printerId, gen);
      }),
    );

    ps.unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (ps.generation === gen) void subscribeTmc(printerId, gen);
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

    void subscribeTmc(printerId, gen);
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
  loadSettings();

  const offPrinters = api.onPrintersChange(() => syncPrinters());

  const offSettings = api.settings.onChange((k) => {
    if (k.startsWith('system.notifications.')) loadSettings();
  });

  window.addEventListener('mpu:guard-notify', onGuardNotifyEvent as EventListener);

  // Initial subscribe for all existing printers
  syncPrinters();

  onDestroy(() => {
    offPrinters();
    offSettings();
    window.removeEventListener('mpu:guard-notify', onGuardNotifyEvent as EventListener);

    for (const pid of Array.from(subsByPrinter.keys())) {
      detachPrinter(pid);
    }
  });

  // ------------------------------------------------------------------
  // Public
  // ------------------------------------------------------------------
  let activeToasts = $derived.by(() => {
    const visible = items.filter((n) => !n.dismissed);
    return visible.slice(0, TOAST_CAP);
  });

  return {
    get items() {
      return items;
    },
    get activeToasts() {
      return activeToasts;
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
}

export type NotificationsStore = ReturnType<typeof useNotifications>;