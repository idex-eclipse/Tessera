import type { PluginApi } from '../../plugin-sdk/src/types';

import { parseMacroParams, type MacroParam } from '../shared/macro-params';

import type { BuiltinHelp } from './gcode-builtins';
import { isPrintActive } from './print-safety';

/**
 * Console log = Moonraker `server.gcode_store` (single source of truth,
 * same on every device).
 * Live updates: notify_gcode_response / own sends trigger a debounced
 * refetch; a slow poll covers silent commands from other clients.
 *
 * Per-printer subscriptions with keep-alive: подписки и poll живут для всех
 * принтеров, не только активного. При переключении принтеров state мгновенно
 * доступен (без loading). Жизненный цикл — по счётчику потребителей: пока смонтирована
 * хотя бы одна поверхность консоли (страница / виджет), подписки живы; когда не осталось
 * ни одной — всё отключается (иначе poll 500 строк каждые 2 с шёл бы вечно),
 * накопленные строки остаются до удаления принтера.
 */

export type ConsoleLineKind = 'sent' | 'response' | 'system';

export interface ConsoleLine {
  id: string;
  kind: ConsoleLineKind;
  text: string;
  time: string;
}

interface GcodeStoreEntry {
  message?: string;
  time?: number;
  type?: string; // 'command' | 'response'
}

const STORE_COUNT = 500;
const POLL_MS = 2_000;
const REFRESH_DEBOUNCE_MS = 300;

let storeLinesByPrinter = $state<Record<string, ConsoleLine[]>>({});
let connectedByPrinter = $state<Record<string, boolean>>({});
let pausedByPrinter = $state<Record<string, boolean>>({});
let printStateByPrinter = $state<Record<string, string>>({});

/** Защита от гонки ответов: применяется только самый свежий запрос store. */
const loadSeq = new Map<string, number>();

let noteId = 0;

// Per-printer subscriptions (вместо одного dataUnsubs)
const dataUnsubsByPrinter = new Map<string, Array<() => void>>();
const pollTimersByPrinter = new Map<string, ReturnType<typeof setInterval>>();
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

let printersUnsub: (() => void) | null = null;
let settingsUnsub: (() => void) | null = null;
let consumers = 0;

function now(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export function getLines(printerId: string): ConsoleLine[] {
  return [...(storeLinesByPrinter[printerId] ?? [])];
}

export function isConnected(printerId: string): boolean {
  return connectedByPrinter[printerId] ?? false;
}

/** Идёт ли на принтере печать (или пауза) — для подтверждения перезапуска. */
export function isPrinting(printerId: string): boolean {
  return isPrintActive(printStateByPrinter[printerId]);
}

/**
 * Clears the local view and pauses auto-refresh until new activity,
 * so the console doesn't repopulate from the store on the next poll.
 */
export function clearLines(printerId: string): void {
  loadSeq.set(printerId, (loadSeq.get(printerId) ?? 0) + 1); // ответ запроса «в полёте» устарел
  storeLinesByPrinter[printerId] = [];
  pausedByPrinter[printerId] = true;
}

/** Принудительно перечитать store (снимает паузу после «Очистить»). */
export function refreshNow(api: PluginApi, printerId: string): void {
  pausedByPrinter[printerId] = false;
  void refreshFromStore(api, printerId);
}

export async function sendCommand(
  api: PluginApi,
  printerId: string,
  script: string,
): Promise<void> {
  pausedByPrinter[printerId] = false;
  try {
    await api.moonrakerFor(printerId).request('printer.gcode.script', { script });
    scheduleRefresh(api, printerId);
  } catch (e) {
    // ошибка уже залогирована центром уведомлений
  }
}

/**
 * Подключает подписки ко ВСЕМ принтерам (per-printer keep-alive). Вызывается каждой
 * смонтированной поверхностью консоли; возвращает функцию отключения (вызвать в
 * onDestroy). Подписки создаются при первом потребителе и снимаются при последнем.
 */
export function attach(api: PluginApi): () => void {
  consumers++;
  start(api);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers = Math.max(0, consumers - 1);
    if (consumers === 0) stop();
  };
}

function stop(): void {
  printersUnsub?.();
  printersUnsub = null;
  settingsUnsub?.();
  settingsUnsub = null;
  for (const pid of Array.from(dataUnsubsByPrinter.keys())) unsubscribePrinter(pid);
}

function start(api: PluginApi): void {
  if (printersUnsub) return; // already attached

  printersUnsub = api.onPrintersChange((printers) => {
    const alive = new Set(printers.map((p) => p.id));

    // Unsubscribe removed printers (+ drop their state)
    for (const pid of Array.from(dataUnsubsByPrinter.keys())) {
      if (!alive.has(pid)) {
        unsubscribePrinter(pid);
        dropPrinterState(pid);
      }
    }

    // Subscribe new printers
    for (const p of printers) {
      if (!dataUnsubsByPrinter.has(p.id)) {
        subscribeForPrinter(api, p.id);
      }
    }
  });

  if (!settingsUnsub) {
    settingsUnsub = api.settings.onChange(() => {
      reloadPrefs(api);
    });
  }

  // Initial subscribe for all existing printers
  for (const p of api.printers) {
    subscribeForPrinter(api, p.id);
  }
}

// ------------------------------------------------------------------
// Store sync
// ------------------------------------------------------------------

function scheduleRefresh(api: PluginApi, printerId: string): void {
  if (pausedByPrinter[printerId]) return;

  const existing = refreshTimers.get(printerId);
  if (existing) clearTimeout(existing);

  refreshTimers.set(
    printerId,
    setTimeout(() => {
      refreshTimers.delete(printerId);
      void refreshFromStore(api, printerId);
    }, REFRESH_DEBOUNCE_MS),
  );
}

async function refreshFromStore(api: PluginApi, printerId: string): Promise<void> {
  const seq = (loadSeq.get(printerId) ?? 0) + 1;
  loadSeq.set(printerId, seq);
  try {
    const res = await api
      .moonrakerFor(printerId)
      .request<any>('server.gcode_store', { count: STORE_COUNT });
    // за время запроса пришёл более свежий (или «Очистить») — этот ответ устарел
    if (loadSeq.get(printerId) !== seq) return;
    const entries: GcodeStoreEntry[] = Array.isArray(res) ? res : (res?.gcode_store ?? []);
    storeLinesByPrinter[printerId] = mapEntries(entries);
  } catch {
    // offline / klippy not ready — retry via onReady / poll
  }
}

function formatStoreTime(t?: number): string {
  if (typeof t !== 'number' || !Number.isFinite(t)) return '';
  return new Date(t * 1000).toLocaleTimeString(undefined, { hour12: false });
}

function mapEntries(entries: GcodeStoreEntry[]): ConsoleLine[] {
  const sorted = [...entries].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const lines: ConsoleLine[] = [];

  const seen = new Map<string, number>();

  for (const e of sorted) {
    if (!e || typeof e.message !== 'string') continue;
    const time = (e.time ?? 0).toFixed(3);
    const key = `${time}|${e.message}`;
    const dupIdx = seen.get(key) ?? 0;
    seen.set(key, dupIdx + 1);

    lines.push({
      id: `${key}|${dupIdx}`,
      kind: e.type === 'command' ? 'sent' : 'response',
      text: e.message,
      time: formatStoreTime(e.time),
    });
  }

  return lines;
}

// ------------------------------------------------------------------
// Subscriptions (per-printer)
// ------------------------------------------------------------------

function subscribeForPrinter(api: PluginApi, printerId: string): void {
  // Unsubscribe if already subscribed (shouldn't happen, but safety)
  unsubscribePrinter(printerId);
  pausedByPrinter[printerId] = false;

  const unsubs: Array<() => void> = [];

  ensureHistoryLoaded(api, printerId);
  ensurePrefsLoaded(api, printerId);
  void refreshHelp(api, printerId);

  let h;
  try {
    h = api.moonrakerFor(printerId);
  } catch {
    return;
  }

  connectedByPrinter[printerId] = h.readyState === 'open';

  // Статус соединения — только в бейдж, не в лог.
  unsubs.push(
    h.onConnectionStatusChange((s) => {
      connectedByPrinter[printerId] = s === 'open';
    }),
  );

  unsubs.push(
    h.onReady(() => {
      pausedByPrinter[printerId] = false;
      void refreshHelp(api, printerId);
      void refreshFromStore(api, printerId);
    }),
  );

  // Любой gcode-ответ (в т.ч. на команды с других клиентов) → рефетч store.
  unsubs.push(
    h.onNotify('notify_gcode_response', () => {
      pausedByPrinter[printerId] = false;
      scheduleRefresh(api, printerId);
    }),
  );

  unsubs.push(
    h.onNotify('notify_config_changed', () => {
      void refreshHelp(api, printerId);
    }),
  );

  // Состояние печати — для подтверждения RESTART / FIRMWARE_RESTART при вводе.
  unsubs.push(
    h.subscribe(
      { print_stats: ['state'] },
      (delta: any) => {
        const st = delta?.print_stats?.state;
        if (typeof st === 'string') printStateByPrinter[printerId] = st;
      },
      { immediate: true },
    ),
  );

  // Страховка: «молчаливые» команды с других клиентов. Скрытая вкладка не опрашивается.
  const poll = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!pausedByPrinter[printerId]) void refreshFromStore(api, printerId);
  }, POLL_MS);
  pollTimersByPrinter.set(printerId, poll);

  unsubs.push(() => {
    clearInterval(poll);
    pollTimersByPrinter.delete(printerId);
  });

  // Первичный seed (если сокет уже открыт; иначе дождёмся onReady).
  void refreshFromStore(api, printerId);

  dataUnsubsByPrinter.set(printerId, unsubs);
}

function unsubscribePrinter(printerId: string): void {
  const unsubs = dataUnsubsByPrinter.get(printerId);
  if (unsubs) {
    for (const u of unsubs) u();
    dataUnsubsByPrinter.delete(printerId);
  }

  const poll = pollTimersByPrinter.get(printerId);
  if (poll) {
    clearInterval(poll);
    pollTimersByPrinter.delete(printerId);
  }

  const refresh = refreshTimers.get(printerId);
  if (refresh) {
    clearTimeout(refresh);
    refreshTimers.delete(printerId);
  }

  // накопленные строки остаются (keep-alive); полная очистка — dropPrinterState
}

/** Принтер удалён из реестра: забыть всё, что о нём накоплено. */
function dropPrinterState(printerId: string): void {
  delete storeLinesByPrinter[printerId];
  delete connectedByPrinter[printerId];
  delete pausedByPrinter[printerId];
  delete printStateByPrinter[printerId];
  loadSeq.delete(printerId);
}

// ------------------------------------------------------------------
// G-code help (autocomplete) + shared input history
// ------------------------------------------------------------------

export interface Suggestion {
  kind: 'command' | 'param';
  name: string;
  help?: string;
  signature?: string;
  params?: MacroParam[];
  param?: MacroParam;
  insert: string;
  replaceToken: boolean;
}

export function matchSuggestions(
  commands: Record<string, string>,
  macroParams: Record<string, MacroParam[]>,
  builtins: Record<string, BuiltinHelp>,
  input: string,
): Suggestion[] {
  const firstSpace = input.indexOf(' ');

  // ---------- param-mode: первый токен — макрос с параметрами ----------
  if (firstSpace !== -1) {
    const first = input.slice(0, firstSpace).trim();
    if (!first) return [];
    const key = Object.keys(macroParams).find(
      (k) => k.toUpperCase() === first.toUpperCase(),
    );
    if (!key) return [];

    const rest = input.slice(firstSpace + 1);
    const tokens = rest.split(/\s+/);
    const current = tokens[tokens.length - 1] ?? '';
    // пользователь дописывает значение (X=10…) — не мешаем
    if (current.includes('=')) return [];

    // параметры, уже внесённые как NAME=…, не предлагаем повторно
    const used = new Set(
      tokens
        .filter((t) => t.includes('='))
        .map((t) => (t.split('=')[0] ?? '').toUpperCase()),
    );
    const cur = current.toUpperCase();

    return (macroParams[key] ?? [])
      .filter((p) => !used.has(p.name.toUpperCase()) && p.name.toUpperCase().startsWith(cur))
      .map((p) => ({
        kind: 'param' as const,
        name: p.name,
        param: p,
        insert: `${p.name}=`,
        replaceToken: true,
      }));
  }

  // ---------- command-mode: прежний матчинг имён команд ----------
  const token = input.trimStart().toUpperCase();
  if (token === '') return [];

  const names = Array.from(new Set([...Object.keys(commands), ...Object.keys(builtins)]));
  const prefix = names.filter((n) => n.toUpperCase().startsWith(token)).sort();
  const substring = names
    .filter((n) => !n.toUpperCase().startsWith(token) && n.toUpperCase().includes(token))
    .sort();

  return [...prefix, ...substring].map((name) => {
    const b = builtins[name];
    return {
      kind: 'command' as const,
      name,
      // приоритет описания: Moonraker help → локализованный builtin
      help: commands[name] ?? b?.help,
      signature: b && b.params ? b.params : undefined,
      params: macroParams[name],
      insert: `${name} `,
      replaceToken: false,
    };
  });
}

let helpByPrinter = $state<Record<string, Record<string, string>>>({});

let macroParamsByPrinter = $state<Record<string, Record<string, MacroParam[]>>>({});

export function getMacroParams(printerId: string): Record<string, MacroParam[]> {
  return macroParamsByPrinter[printerId] ?? {};
}

export function isMacroName(name: string): boolean {
  return /^T\d+$/i.test(name) || /^[A-Za-z_]\w*$/.test(name);
}

let historyByPrinter = $state<Record<string, string[]>>({});
const historyLoaded = new Set<string>();

export function getCommands(printerId: string): Record<string, string> {
  return helpByPrinter[printerId] ?? {};
}

export function getHistory(printerId: string): string[] {
  return historyByPrinter[printerId] ?? [];
}

export function pushHistory(
  api: PluginApi,
  printerId: string,
  script: string,
): void {
  ensureHistoryLoaded(api, printerId);

  const arr = historyByPrinter[printerId] ?? [];
  const next = arr[arr.length - 1] === script ? arr : [...arr.slice(-49), script];

  historyByPrinter[printerId] = next;
  api.settingsFor(printerId).set('history', next);
}

function ensureHistoryLoaded(api: PluginApi, printerId: string): void {
  if (historyLoaded.has(printerId)) return;
  historyLoaded.add(printerId);

  const stored = api.settingsFor(printerId).get<string[]>('history');
  if (Array.isArray(stored)) {
    historyByPrinter[printerId] = stored.filter((s) => typeof s === 'string');
  }
}

function reloadPrefs(api: PluginApi): void {
  // При смене sync-флага namespace меняется, перечитываем всё заново
  historyLoaded.clear();
  prefsLoaded.clear();

  for (const pid of Object.keys(historyByPrinter)) {
    const stored = api.settingsFor(pid).get<string[]>('history');
    if (Array.isArray(stored)) {
      historyByPrinter[pid] = stored.filter((s) => typeof s === 'string');
    } else {
      historyByPrinter[pid] = [];
    }
  }

  for (const pid of Object.keys(prefsByPrinter)) {
    prefsByPrinter[pid] = sanitizePrefs(
      api.settingsFor(pid).get<Partial<ConsolePrefs>>('consolePrefs'),
    );
  }
}

export async function refreshHelp(api: PluginApi, printerId: string): Promise<void> {
  if (!printerId) return;

  try {
    const h = api.moonrakerFor(printerId);
    const [help, cfgRes] = await Promise.all([
      h.request<Record<string, string>>('printer.gcode.help'),
      h
        .request<any>('printer.objects.query', {
          objects: { configfile: ['config', 'settings'] },
        })
        .catch(() => null),
    ]);
    if (help && typeof help === 'object') helpByPrinter[printerId] = help;

    const cfg = cfgRes?.status?.configfile ?? {};
    // config = сырые секции (регистр и тела гарантированы); settings — фолбэк.
    // Разнос регистра между источниками схлопнется ниже кейс-нечувствительным матчингом.
    const sections: Record<string, any> = { ...(cfg.settings ?? {}), ...(cfg.config ?? {}) };

    const helpKeys = Object.keys(help ?? {});
    const mp: Record<string, MacroParam[]> = {};
    for (const [section, v] of Object.entries(sections)) {
      if (!section.startsWith('gcode_macro ')) continue;
      const body = typeof v?.gcode === 'string' ? v.gcode : null;
      if (!body) continue;
      const raw = section.slice('gcode_macro '.length);
      // ключ = написание из help, иначе lookup по имени команды промахнётся
      const key = helpKeys.find((k) => k.toUpperCase() === raw.toUpperCase()) ?? raw;
      const params = parseMacroParams(body);
      if (params.length > 0) mp[key] = params;
    }
    macroParamsByPrinter[printerId] = mp;
  } catch {
    // retry on notify_klippy_ready
  }
}

export function matchCommands(
  commands: Record<string, string>,
  input: string,
  limit = 10,
): string[] {
  const token = input.trimStart().toUpperCase();
  if (token === '' || token.includes(' ')) return [];

  const names = Object.keys(commands);
  const prefix = names.filter((n) => n.toUpperCase().startsWith(token)).sort();
  const substring = names
    .filter((n) => !n.toUpperCase().startsWith(token) && n.toUpperCase().includes(token))
    .sort();

  return [...prefix, ...substring].slice(0, limit);
}

// ------------------------------------------------------------------
// Console UI prefs (reverse / autoscroll / filters)
// ------------------------------------------------------------------
export interface ConsolePrefs {
  reverse: boolean;
  autoscroll: boolean;
  filtersEnabled: boolean;
  filters: string[]; // источники регулярок; view-level, store не трогаем
}

const DEFAULT_PREFS: ConsolePrefs = {
  reverse: false,
  autoscroll: true,
  filtersEnabled: true,
  filters: [],
};

let prefsByPrinter = $state<Record<string, ConsolePrefs>>({});
const prefsLoaded = new Set<string>();

/** Пресет: статусные строки температур Klipper (`B:… T0:… T1:…`). */
export const TEMP_FILTER_PRESET = '^\\s*(B|T\\d*):\\d';

function sanitizePrefs(p: Partial<ConsolePrefs> | null | undefined): ConsolePrefs {
  return {
    reverse: typeof p?.reverse === 'boolean' ? p.reverse : DEFAULT_PREFS.reverse,
    autoscroll: typeof p?.autoscroll === 'boolean' ? p.autoscroll : DEFAULT_PREFS.autoscroll,
    filtersEnabled:
      typeof p?.filtersEnabled === 'boolean' ? p.filtersEnabled : DEFAULT_PREFS.filtersEnabled,
    filters: Array.isArray(p?.filters)
      ? p.filters.filter((s): s is string => typeof s === 'string')
      : DEFAULT_PREFS.filters,
  };
}

export function getPrefs(printerId: string): ConsolePrefs {
  return prefsByPrinter[printerId] ?? DEFAULT_PREFS;
}

export function setPrefs(
  api: PluginApi,
  printerId: string,
  patch: Partial<ConsolePrefs>,
): void {
  const next = { ...getPrefs(printerId), ...patch };
  prefsByPrinter[printerId] = next;
  api.settingsFor(printerId).set('consolePrefs', next);
}

function ensurePrefsLoaded(api: PluginApi, printerId: string): void {
  if (prefsLoaded.has(printerId)) return;
  prefsLoaded.add(printerId);

  prefsByPrinter[printerId] = sanitizePrefs(
    api.settingsFor(printerId).get<Partial<ConsolePrefs>>('consolePrefs'),
  );
}

// ------------------------------------------------------------------
// Regex filters (view-level)
// ------------------------------------------------------------------

export interface FilterEntry {
  source: string;
  re: RegExp | null; // null = невалидный паттерн: помечаем в UI, не фильтруем
}

let filterCacheKey: string | null = null;
let filterCache: FilterEntry[] = [];

export function compileFilters(sources: string[]): FilterEntry[] {
  const key = sources.join('\u0000');
  if (key === filterCacheKey) return filterCache;
  filterCacheKey = key;
  filterCache = sources.map((source) => {
    try {
      return { source, re: new RegExp(source) };
    } catch {
      return { source, re: null };
    }
  });
  return filterCache;
}

export function applyFilters(lines: ConsoleLine[], entries: FilterEntry[]): ConsoleLine[] {
  const active = entries.filter((e): e is FilterEntry & { re: RegExp } => e.re !== null);
  if (active.length === 0) return lines;
  return lines.filter((line) => !active.some((e) => e.re.test(line.text)));
}