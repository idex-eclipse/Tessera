import type {
  MpuParams,
  NotificationActionInput,
  NotificationSeverity,
} from '../../../plugin-sdk/src/types';

import type { SettingsStore } from './settings-store.svelte.ts';

/**
 * Центр уведомлений: хранилище, фильтр и дедуп. Единственный вход — push().
 *
 * Хост не знает, откуда пришло уведомление (Klipper, плагин, гард): ему важны
 * только принтер, автор (pluginId проставляет хост, плагин его не передаёт),
 * важность и уже локализованный текст. Плагины пишут сюда через
 * api.notifications.push и ничего не читают — иначе это стал бы канал между плагинами.
 *
 * Интерфейс (колокольчик, список, тосты) — components/notifications/.
 * Переживает только фильтр и звук (settings.ui.notifications); история живёт в памяти.
 */

export interface NotificationItem {
  id: string;
  printerId: string;
  /** Автор уведомления; для хостовых (гард) — HOST_NOTIFICATION_SOURCE. */
  pluginId: string;
  severity: NotificationSeverity;
  /** Локализованная подпись источника от автора; без неё UI показывает имя плагина. */
  label?: string;
  text: string;
  /** Opaque plugin actions or the host's private, declarative Settings navigation. */
  actions?: NotificationAction[];
  /** unix ms */
  time: number;
  seen: boolean;
  dismissed: boolean;
}

export interface NotificationPush {
  printerId: string;
  pluginId: string;
  severity: NotificationSeverity;
  text: string;
  label?: string;
  actions?: NotificationAction[];
}

/** A host-only action kept outside the public PluginApi notification contract. */
export interface HostSettingsNotificationAction {
  kind: 'host-settings';
  section: 'about' | 'plugins';
}

/** Stored actions are either plugin-owned Custom Elements or trusted host navigation. */
export type NotificationAction = NotificationActionInput | HostSettingsNotificationAction;

/** pluginId для уведомлений, которые создаёт сам хост (fail-closed таймауты гардов). */
export const HOST_NOTIFICATION_SOURCE = '@host';

export const HISTORY_CAP = 200;
export const TOAST_CAP = 5;
export const DEDUP_MS = 100;
export const TEXT_MAX = 240;
export const LABEL_MAX = 40;
export const NOTIFICATION_ACTION_CAP = 2;

const CUSTOM_ELEMENT_NAME_RE = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;
const PARAM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DEDUP_PRUNE_AT = 500;
const DEDUP_KEEP_MS = 60_000;

const SEVERITIES: readonly NotificationSeverity[] = ['critical', 'error', 'info'];

export type NotificationCenter = ReturnType<typeof createNotificationCenter>;

/** Copies the narrow CE contract so a plugin cannot mutate notification history after push(). */
function sanitizePluginActions(raw: unknown): NotificationActionInput[] {
  if (!Array.isArray(raw)) return [];
  const actions: NotificationActionInput[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as { element?: unknown; params?: unknown };
    if (typeof record.element !== 'string' || !CUSTOM_ELEMENT_NAME_RE.test(record.element)) continue;

    const params: MpuParams = {};
    if (record.params && typeof record.params === 'object' && !Array.isArray(record.params)) {
      for (const [key, value] of Object.entries(record.params)) {
        if (PARAM_KEY_RE.test(key) && typeof value === 'string') params[key] = value;
      }
    }
    actions.push({
      element: record.element,
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
    if (actions.length >= NOTIFICATION_ACTION_CAP) break;
  }
  return actions;
}

/** Accepts host navigation only from the trusted host author and copies its narrow payload. */
function sanitizeHostActions(raw: unknown): HostSettingsNotificationAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: HostSettingsNotificationAction[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as { kind?: unknown; section?: unknown };
    if (record.kind !== 'host-settings') continue;
    if (record.section !== 'about' && record.section !== 'plugins') continue;
    actions.push({ kind: 'host-settings', section: record.section });
    if (actions.length >= NOTIFICATION_ACTION_CAP) break;
  }
  return actions;
}

/** Скомпилированные паттерны (регистронезависимо); невалидный regex пропускается. */
function compilePatterns(list: readonly string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of list) {
    if (!p) continue;
    try {
      out.push(new RegExp(p, 'i'));
    } catch {
      /* невалидный regex — пропускаем */
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createNotificationCenter(
  settings: Pick<SettingsStore, 'ui' | 'setNotificationSettings'>,
) {
  let items = $state<NotificationItem[]>([]);
  let nextId = 1;
  let open = $state(false);

  // Дедуп per (printerId, pluginId, normalized-text)
  const dedup = new Map<string, number>();
  let audioCtx: AudioContext | null = null;

  // Паттерны живут в settings.ui (сохраняются и переживают импорт); компилируем по ссылке
  let compiledFor: readonly string[] | null = null;
  let compiled: RegExp[] = [];

  function ignores(): RegExp[] {
    const list = settings.ui.notifications.ignoredPatterns;
    if (list !== compiledFor) {
      compiled = compilePatterns(list);
      compiledFor = list;
    }
    return compiled;
  }

  function isIgnored(text: string): boolean {
    return ignores().some((re) => re.test(text));
  }

  function dedupKey(n: NotificationPush): string {
    return `${n.printerId}|${n.pluginId}|${n.text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
  }

  function push(n: NotificationPush): void {
    if (!SEVERITIES.includes(n.severity)) return;

    let text = String(n.text ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (!text) return;
    if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX - 1) + '…';

    // единая точка фильтрации: сюда приходят все плагины и хост
    if (isIgnored(text)) return;

    const label =
      typeof n.label === 'string' && n.label.trim()
        ? n.label.trim().slice(0, LABEL_MAX)
        : undefined;
    // Plugin input can never acquire host navigation by casting at runtime.
    const actions = n.pluginId === HOST_NOTIFICATION_SOURCE
      ? sanitizeHostActions(n.actions)
      : sanitizePluginActions(n.actions);

    const now = Date.now();
    const key = dedupKey({ ...n, text });
    const last = dedup.get(key);
    if (last && now - last < DEDUP_MS) return;
    dedup.set(key, now);

    // карта дедупа не должна расти бесконечно (уникальные тексты накапливались вечно)
    if (dedup.size > DEDUP_PRUNE_AT) {
      const cutoff = now - DEDUP_KEEP_MS;
      for (const [k, t] of dedup) if (t < cutoff) dedup.delete(k);
    }

    const item: NotificationItem = {
      id: `n${nextId++}`,
      printerId: n.printerId,
      pluginId: n.pluginId,
      severity: n.severity,
      ...(label ? { label } : {}),
      ...(actions.length > 0 ? { actions } : {}),
      text,
      time: now,
      seen: false,
      dismissed: false,
    };
    items = [item, ...items.slice(0, HISTORY_CAP - 1)];

    if (item.severity === 'critical' && settings.ui.notifications.soundEnabled) playBeep();
  }

  function dismiss(id: string): void {
    items = items.map((n) => (n.id === id ? { ...n, dismissed: true, seen: true } : n));
  }

  function dismissAll(): void {
    items = items.map((n) => ({ ...n, dismissed: true, seen: true }));
  }

  function markSeen(id: string): void {
    items = items.map((n) => (n.id === id ? { ...n, seen: true } : n));
  }

  function setIgnoredPatterns(list: string[]): void {
    settings.setNotificationSettings({ ignoredPatterns: [...list] });
    // паттерн должен убрать и то, что уже в истории, иначе кажется, что он не сработал
    items = items.filter((n) => !isIgnored(n.text));
  }

  /** «Игнорировать это уведомление»: точный паттерн по тексту. */
  function ignoreText(text: string): void {
    const p = `^${escapeRegExp(text)}$`;
    const current = settings.ui.notifications.ignoredPatterns;
    if (current.includes(p)) return;
    setIgnoredPatterns([...current, p]);
  }

  function setSoundEnabled(v: boolean): void {
    settings.setNotificationSettings({ soundEnabled: v });
  }

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

  // Геттеры читают $state напрямую, поэтому реактивны в любом потребителе
  return {
    get items() {
      return items;
    },
    get activeToasts() {
      return items.filter((n) => !n.dismissed).slice(0, TOAST_CAP);
    },
    get unseenCount() {
      return items.filter((n) => !n.seen).length;
    },
    get ignoredPatterns() {
      return settings.ui.notifications.ignoredPatterns;
    },
    get soundEnabled() {
      return settings.ui.notifications.soundEnabled;
    },
    /** Открыта ли панель списка. */
    get open() {
      return open;
    },
    setOpen(v: boolean): void {
      open = v;
    },
    toggle(): void {
      open = !open;
    },

    push,
    dismiss,
    dismissAll,
    markSeen,
    setIgnoredPatterns,
    ignoreText,
    setSoundEnabled,
  };
}
