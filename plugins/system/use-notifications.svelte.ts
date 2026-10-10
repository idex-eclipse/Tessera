import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types.ts';
import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';

export type NotificationSeverity = 'critical' | 'error' | 'info';
export type NotificationSource = 'gcode' | 'klippy' | 'tmc' | 'guard' | 'plugin';

export interface NotificationItem {
  id: string;
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

// Флаги TMC, которые считаем ошибками (drv_status шлёт только ненулевые)
const TMC_ERROR_FLAGS = new Set([
  'ot', 'otpw',
  's2ga', 's2gb', 's2vsa', 's2vsb',
  'ola', 'olb',
]);
// Критические — требуют sticky-тоста
const TMC_CRITICAL_FLAGS = new Set([
  'ot', 's2ga', 's2gb', 's2vsa', 's2vsb',
]);

// Паттерны gcode-ответа, требующие sticky + critical
const KLIPPER_CRITICAL_RE = /shutdown|mcu |thermistor|heater .* not heating|lost communication|tmc .* reports/i;

const MPU_NOTIFY_RE = /^echo:\s*MPU_NOTIFY\s+(critical|error|info)\s+(.+)$/i;
const MPU_TEXT_MAX = 240;

// Глобальный (для всего приложения) state — модульный стейт, как useSystem
let items = $state<NotificationItem[]>([]);
let nextId = 1;

let toastSettings = $state<{ ignoredPatterns: string[]; soundEnabled: boolean }>({
  ignoredPatterns: [],
  soundEnabled: false,
});

// Дедуп-кэш: key → timestamp последнего появления
const dedup = new Map<string, number>();

// Предыдущие drv_status флаги по каждому TMC-объекту — для edge-детекта
const prevFlags = new Map<string, Set<string>>();

let audioCtx: AudioContext | null = null;

export function useNotifications(api: PluginApi) {
  let generation = 0;
  const unsubs: Array<() => void> = [];
  let tmcUnsub: (() => void) | null = null;
  const klippy = useKlippyState(api);

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonraker();
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Настройки (api.settings system.notifications.*)
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

  function dedupKey(n: NotificationItem): string {
    // Дедуп на (source + нормализованный текст)
    return `${n.source}|${n.text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
  }

  function push(n: Omit<NotificationItem, 'id' | 'time' | 'seen' | 'dismissed'>): void {
    const item: NotificationItem = {
      ...n,
      id: `n${nextId++}`,
      time: Date.now(),
      seen: false,
      dismissed: false,
    };
    const key = dedupKey(item);
    const last = dedup.get(key);
    if (last && Date.now() - last < DEDUP_MS) return;
    dedup.set(key, Date.now());

    items = [item, ...items.slice(0, HISTORY_CAP - 1)];

    if (item.severity === 'critical' && toastSettings.soundEnabled) {
      playBeep();
    }
    //console.log('[notifications] pushed:', item);
  }

  // ------------------------------------------------------------------
  // Обработчики источников
  // ------------------------------------------------------------------

  function onGcodeResponse(params: any): void {
    // Moonraker шлёт notify_gcode_response как массив строк ["!! ...", "// ..."],
    // иногда одиночную строку — нормализуем в первую строку
    let line = '';
    if (typeof params === 'string') {
      line = params;
    } else if (Array.isArray(params)) {
      line = params[0] ?? '';
    } else if (params && typeof params === 'object') {
      line = String(params.message ?? params.text ?? '');
    }
    if (typeof line !== 'string' || !line.trim()) return;

    //console.log('[notifications] gcode_response:', line);

    const mpu = line.match(MPU_NOTIFY_RE);
    if (mpu) {
      const severity = mpu[1].toLowerCase() as 'critical' | 'error' | 'info';
      let text = mpu[2].trim().replace(/[\r\n]+/g, ' ');
      if (!text || isIgnored(text)) return;
      if (text.length > MPU_TEXT_MAX) text = text.slice(0, MPU_TEXT_MAX - 1) + '…';
      push({
        severity,
        source: 'plugin',
        text,
        sticky: severity === 'critical',
      });
      return;
    }

    // Klipper error: начинается с '!!'
    if (line.startsWith('!!')) {
      const text = line.slice(2).trim();
      if (!text || isIgnored(text)) return;
      const critical = KLIPPER_CRITICAL_RE.test(text);
      push({
        severity: critical ? 'critical' : 'error',
        source: 'gcode',
        text,
        sticky: critical,
      });
      return;
    }

    // Uknown smth
    if (line.startsWith('// Unknown')) {
      const text = line.slice(2).trim();
      if (!text || isIgnored(text)) return;
      push({
        severity: 'error',
        source: 'gcode',
        text,
        sticky: false,
      });
      return;
    }
  }

  function onKlippyShutdown(params: any): void {
    //console.log('[notifications] klippy_shutdown params:', params);
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
    push({ severity: 'critical', source: 'klippy', text, sticky: true });
  }

  function applyTmcDelta(delta: any): void {
    //console.log('[notifications] tmc delta:', delta);
    if (!delta || typeof delta !== 'object') return;
    for (const [name, d] of Object.entries(delta)) {
      if (!/^tmc\d+ /.test(name) && !/^tmc\d+$/.test(name)) continue;
      const rec = d as any;
      const drv = rec?.drv_status;
      if (!drv || typeof drv !== 'object') continue;

      const prev = prevFlags.get(name) ?? new Set();
      const cur = new Set<string>();
      for (const f of TMC_ERROR_FLAGS) {
        const v = drv[f];
        // флаг пришёл = ненулевое значение (число > 0 или true)
        if (v !== undefined && v !== null && v !== 0 && v !== false) cur.add(f);
      }

      // Edge: новые флаги
      for (const f of cur) {
        if (!prev.has(f)) {
          const text = `TMC ${name}: ${f}`;
          if (isIgnored(text)) continue;
          const critical = TMC_CRITICAL_FLAGS.has(f);
          push({
            severity: critical ? 'critical' : 'error',
            source: 'tmc',
            text,
            sticky: critical,
          });
        }
      }

      prevFlags.set(name, cur);
    }
  }

  // host-core диспатчит mpu:guard-notify (fail-closed таймауты); строковое имя
  // дублируется намеренно: плагины не импортируют host-модули.
  function onGuardNotifyEvent(e: Event): void {
    const d = (e as CustomEvent).detail as
      | { kind: 'decision_timeout' | 'park_timeout' | 'denied'; pluginId: string; guardId: string; method: string, reasonKey?: string }
      | undefined;
    if (!d) return;
    const text =
      d.kind === 'park_timeout'
        ? api.i18n.t('system.notifications.guardParkTimeout', { method: d.method })
        : d.kind === 'decision_timeout'
          ? api.i18n.t('system.notifications.guardDecisionTimeout', {
              guard: d.guardId, plugin: d.pluginId, method: d.method,
            })
          : d.reasonKey
            ? api.i18n.t(d.reasonKey)   // reasonKey плагина резолвится: локали слиты в host-i18n
            : api.i18n.t('system.notifications.guardDenied', { plugin: d.pluginId, method: d.method });
    push({ severity: 'error', source: 'guard', text, sticky: false });
  }

  // ------------------------------------------------------------------
  // TMC подписка (feature-detect по objects.list)
  // ------------------------------------------------------------------

  async function subscribeTmc(gen: number): Promise<void> {
    if (tmcUnsub) { tmcUnsub(); tmcUnsub = null; }
    if (!klippy.ready) return;

    const h = safeHandle();
    if (!h) return;
    const list = await h.request<any>('printer.objects.list').catch(() => null);
    if (gen !== generation || !list) return;
    const names = (list.objects ?? []).filter((n: string) =>
      typeof n === 'string' && (/^tmc\d+ /.test(n) || /^tmc\d+$/.test(n)),
    );
    if (names.length === 0) return;
    //console.log('[notifications] tmc subscribed:', names);

    const objects: Record<string, string[]> = {};
    for (const n of names) objects[n] = ['drv_status', 'temperature'];

    tmcUnsub = h.subscribe(
      objects,
      (d: any) => { if (gen === generation) applyTmcDelta(d); },
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
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
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
  // Lifecycle
  // ------------------------------------------------------------------

  function teardown(): void {
    generation++;
    for (const u of unsubs.splice(0)) u();
    if (tmcUnsub) { tmcUnsub(); tmcUnsub = null; }
    prevFlags.clear();
    // при смене принтера история остаётся — это осознанно (сессия)
  }

  async function init(): Promise<void> {
    loadSettings();
    const gen = ++generation;
    const h = safeHandle();
    window.addEventListener('mpu:guard-notify', onGuardNotifyEvent as EventListener);
    unsubs.push(() => window.removeEventListener('mpu:guard-notify', onGuardNotifyEvent as EventListener));
    if (!h || !api.printer.url) return;
    //console.log('[notifications] init, gen:', gen, 'printer:', api.printer.url);

    unsubs.push(h.onReady(() => {
      if (gen === generation) void subscribeTmc(gen);
    }));

    unsubs.push(h.onConnectionStatusChange((s) => {
      if (s === 'open' && gen === generation) void subscribeTmc(gen);
    }));

    unsubs.push(h.onNotify('notify_klippy_ready', () => {
      if (gen === generation) void subscribeTmc(gen);
    }));

    unsubs.push(h.onNotify('notify_gcode_response', (line: any) => {
      if (gen === generation) onGcodeResponse(line);
    }));

    unsubs.push(h.onNotify('notify_klippy_shutdown', (params: any) => {
      if (gen === generation) onKlippyShutdown(params);
    }));

    void subscribeTmc(gen);
  }

  init();

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    void init();
  });

  const offSettings = api.settings.onChange((k) => {
    if (k.startsWith('system.notifications.')) loadSettings();
  });

  onDestroy(() => {
    teardown();
    offPrinter();
    offSettings();
  });

  // ------------------------------------------------------------------
  // Public
  // ------------------------------------------------------------------

  let activeToasts = $derived.by(() => {
    const visible = items.filter((n) => !n.dismissed);
    return visible.slice(0, TOAST_CAP);
  });

  return {
    get items() { return items; },
    get activeToasts() { return activeToasts; },
    get unseenCount() { return items.filter((n) => !n.seen).length; },
    get settings() { return toastSettings; },
    dismiss,
    dismissAll,
    markSeen,
    setIgnoredPatterns,
    setSoundEnabled,
  };
}

export type NotificationsStore = ReturnType<typeof useNotifications>;