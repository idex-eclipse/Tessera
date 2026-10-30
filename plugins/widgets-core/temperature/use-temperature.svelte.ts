import { onDestroy } from 'svelte';

import type { PluginApi } from '../../../plugin-sdk/src/types';

import {
  buildTargetGcode,
  classifySensor,
  displayName,
  sensorSortKey,
  type SensorKind,
} from './data';
import {
  HOLD_MAX_MINUTES,
  HOLD_OFF,
  holdRemainingMs,
  sameHold,
  stepHold,
  type HoldState,
} from './hold-timer';
import { SeriesBuffer } from '../../shared/uplot-core/series-buffer';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../../shared/core-keeper/core-keeper';

// ------------------------------------------------------------------
// Module-level prefs: настройки отображения виджета (колонки графика) —
// общие для всех принтеров, не привязаны к пер-принтер состоянию.
// Оставлены без изменений.
// ------------------------------------------------------------------

export interface TempColumns {
  power: boolean;
  rate: boolean;
  current: boolean;
  target: boolean;
  /** таймер «время включения»: пока колонка скрыта, таймер не работает */
  hold: boolean;
}

const DEFAULT_COLUMNS: TempColumns = {
  power: true,
  rate: true,
  current: true,
  target: true,
  hold: false,
};

/** auto — таблица, пока помещается, иначе карточки; table / cards — принудительно. */
export type TempViewMode = 'auto' | 'table' | 'cards';

const VIEW_MODES: readonly TempViewMode[] = ['auto', 'table', 'cards'];

const COLUMNS_KEY = 'temperature.columns';
const VIEW_MODE_KEY = 'temperature.viewMode';
const HOLD_MINUTES_KEY = 'temperature.holdMinutes';

let columns = $state<TempColumns>({ ...DEFAULT_COLUMNS });
let viewMode = $state<TempViewMode>('auto');

function parseViewMode(v: unknown): TempViewMode {
  return VIEW_MODES.includes(v as TempViewMode) ? (v as TempViewMode) : 'auto';
}

export function useTemperaturePrefs(api: PluginApi) {
  function load(): void {
    columns = {
      ...DEFAULT_COLUMNS,
      ...(api.settings.get<Partial<TempColumns>>(COLUMNS_KEY) ?? {}),
    };
    viewMode = parseViewMode(api.settings.get(VIEW_MODE_KEY));
  }

  load();

  const off = api.settings.onChange((k, v) => {
    if (k === COLUMNS_KEY && v && typeof v === 'object') {
      columns = { ...DEFAULT_COLUMNS, ...(v as Partial<TempColumns>) };
    } else if (k === VIEW_MODE_KEY) {
      viewMode = parseViewMode(v);
    }
  });
  const offPrinter = api.onPrinterChange(() => load());
  onDestroy(() => {
    off();
    offPrinter();
  });

  function setColumn(key: keyof TempColumns, value: boolean): void {
    columns = { ...columns, [key]: value };
    api.settings.set(COLUMNS_KEY, columns);
  }

  function setViewMode(mode: TempViewMode): void {
    viewMode = mode;
    api.settings.set(VIEW_MODE_KEY, mode);
  }

  return {
    get columns() {
      return columns;
    },
    get viewMode() {
      return viewMode;
    },
    setColumn,
    setViewMode,
  };
}

// ------------------------------------------------------------------
// Типы / палитра
// ------------------------------------------------------------------

export interface TemperatureSensor {
  name: string;
  displayName: string;
  kind: SensorKind;
  color: string;
  temperature: number | null;
  target: number | null;
  power: number | null;
  rate: number | null;
  speed: number | null;
  minTemp: number | null;
  maxTemp: number | null;
  chartVisible: boolean;
  powerVisible: boolean;
}

export interface SensorBuffers {
  temp: SeriesBuffer;
  target: SeriesBuffer;
  power: SeriesBuffer;
}

const PALETTE = [
  '#ff6d00', '#ffab40', '#40c4ff', '#b388ff', '#69f0ae',
  '#ffd740', '#ff8a80', '#80d8ff', '#ccff90', '#f8bbd0',
];

const KLIPPY_EVENTS = [
  'notify_klippy_shutdown',
  'notify_klippy_ready',
  'notify_klippy_disconnected',
  'notify_klippy_started',
];

function lastOf(arr: number[]): number | null {
  const v = arr[arr.length - 1];
  return v === undefined ? null : v;
}

// ------------------------------------------------------------------
// Module-level кэши (per-printer, вне ядер — общие для всех инстансов).
// - reseedCache: ответ temperature_store (~1200с истории) — тяжёлый запрос;
//   инвалидация по klippy-жизненному циклу и config-changed;
// - limitsCache: min_temp/max_temp из configfile.settings;
//   инвалидация та же, TTL длиннее (конфиг меняется редко).
// ------------------------------------------------------------------

const RESEED_TTL_MS = 5 * 60_000;
const LIMITS_TTL_MS = 30 * 60_000;

interface ReseedCacheEntry {
  store: any;
  ts: number;
}
const reseedCache = new Map<string, ReseedCacheEntry>();

interface LimitsMap { [sensor: string]: { min: number | null; max: number | null } }
interface LimitsCacheEntry { limits: LimitsMap; ts: number }
const limitsCache = new Map<string, LimitsCacheEntry>();

function invalidatePrinterCaches(printerId: string): void {
  reseedCache.delete(printerId);
  limitsCache.delete(printerId);
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру. Виджет дашборда
// и fleet-карточка одного принтера делят ОДИН core: один набор подписок,
// один набор буферов графиков, один tick.
// ------------------------------------------------------------------
function createTemperatureCore(api: PluginApi, printerId: string) {
  let sensors = $state<TemperatureSensor[]>([]);
  let klippyState = $state<string>('unknown');
  let connected = $state<boolean>(false);
  let tick = $state(0);

  const buffers = new Map<string, SensorBuffers>();

  // ---- таймер «время включения» (работает в браузере) ----
  const settingsApi = api.settingsFor(printerId);
  let holdMinutes = $state<Record<string, number>>(readHoldMinutes());
  let holdColumnOn = $state(readHoldColumn());
  let holds = $state<Record<string, HoldState>>({});
  let holdNow = $state(Date.now());
  let printing = false;
  let holdInterval: ReturnType<typeof setInterval> | null = null;

  function readHoldMinutes(): Record<string, number> {
    const raw = settingsApi.get<Record<string, unknown>>(HOLD_MINUTES_KEY);
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.min(v, HOLD_MAX_MINUTES);
      }
    }
    return out;
  }

  function readHoldColumn(): boolean {
    const cols = settingsApi.get<Partial<TempColumns>>(COLUMNS_KEY);
    return cols?.hold ?? DEFAULT_COLUMNS.hold;
  }

  let generation = 0;
  let unsubStatus: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  function safeHandle() {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  function teardown(): void {
    generation++;

    if (unsubStatus) {
      unsubStatus();
      unsubStatus = null;
    }

    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }

    for (const u of unsubs.splice(0)) u();
    // buffers не чистим: ядро умирает полностью только при prune/evict,
    // а на klippy-событии делаем reseed, который сам сбросит буферы.
  }

  async function init(): Promise<void> {
    const gen = ++generation;

    // настройки читаются раньше handle: таймер не должен зависеть от соединения
    unsubs.push(
      settingsApi.onChange((k, v) => {
        if (k === HOLD_MINUTES_KEY) holdMinutes = readHoldMinutes();
        else if (k === COLUMNS_KEY) holdColumnOn = readHoldColumn();
        evalHolds();
      }),
    );
    holdInterval = setInterval(onHoldTick, 1000);

    const h = safeHandle();
    if (!h) return;

    connected = h.readyState === 'open';

    unsubs.push(
      h.onConnectionStatusChange((s) => {
        connected = s === 'open';
        if (s === 'open' && gen === generation) {
          // история из кэша за время обрыва устарела: иначе график получит провал
          invalidatePrinterCaches(printerId);
          void refresh(gen);
        }
      }),
    );

    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void refresh(gen);
      }),
    );

    for (const ev of KLIPPY_EVENTS) {
      unsubs.push(
        h.onNotify(ev, () => {
          if (gen !== generation) return;
          invalidatePrinterCaches(printerId);
          void refresh(gen);
        }),
      );
    }

    unsubs.push(
      h.onNotify('notify_config_changed', () => {
        if (gen !== generation) return;
        invalidatePrinterCaches(printerId);
        void refresh(gen);
      }),
    );

    await refresh(gen);
  }

  // ------------------------------------------------------------------
  // Klipper state + seed + subscribe
  // ------------------------------------------------------------------

  async function refresh(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h || gen !== generation) return;

    let info: any = null;
    try {
      info = await h.request('server.info');
    } catch {
      console.debug('[temp] server.info request failed:');
      info = null;
    }

    if (gen !== generation) return;

    klippyState = info?.klippy_state ?? info?.state ?? 'unknown';

    if (klippyState !== 'ready') {
      sensors = [];
      if (unsubStatus) {
        unsubStatus();
        unsubStatus = null;
      }
      return;
    }

    await reseed(gen);
    await refreshLimits(gen);
    ensureSubscription(gen);
  }

  /**
   * Reseed: берём историю из temperature_store (кэш per-printer; при промахе
   * запрашиваем и кэшируем). Буферы существующих сенсоров переиспользуются
   * (clear + refill), новые сенсоры получают новые буферы, удалённые остаются
   * в buffers до следующего prune.
   */
  async function reseed(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h || gen !== generation) return;

    let store: any = null;
    const cached = reseedCache.get(printerId);
    if (cached && Date.now() - cached.ts < RESEED_TTL_MS) {
      store = cached.store;
    } else {
      try {
        store = await h.request('server.temperature_store');
        if (gen !== generation || !store || typeof store !== 'object') return;
        reseedCache.set(printerId, { store, ts: Date.now() });
      } catch {
        return;
      }
    }

    if (gen !== generation || !store || typeof store !== 'object') return;

    const next: TemperatureSensor[] = [];
    let colorIndex = 0;

    for (const [name, entry] of Object.entries(store as Record<string, any>)) {
      const kind = classifySensor(name);
      if (!kind) continue;

      const prev = sensors.find((s) => s.name === name);

      const temps: number[] = entry?.temperatures ?? [];
      const targets: number[] = entry?.targets ?? [];
      // у вентиляторов Moonraker отдаёт скорость в `speeds`, а не `powers`
      const powers: number[] = entry?.powers ?? entry?.speeds ?? [];
      const startTime: number = entry?.start_time ?? 0;

      let buf = buffers.get(name);
      if (!buf) {
        buf = {
          temp: new SeriesBuffer(),
          target: new SeriesBuffer(),
          power: new SeriesBuffer(),
        };
        buffers.set(name, buf);
      }

      buf.temp.clear();
      buf.target.clear();
      buf.power.clear();

      const now = Date.now() / 1000;
      const base = startTime > 0 ? startTime : now - temps.length;

      temps.forEach((t, i) => {
        const time = base + i;
        buf!.temp.push(time, t);
        if (targets[i] !== undefined) buf!.target.push(time, targets[i]);
        if (powers[i] !== undefined) buf!.power.push(time, powers[i]);
      });

      next.push({
        name,
        displayName: displayName(name),
        kind,
        color: PALETTE[colorIndex++ % PALETTE.length] ?? '#9e9e9e',
        temperature: lastOf(temps),
        target: kind !== 'sensor' ? lastOf(targets) : null,
        power: kind !== 'sensor' ? lastOf(powers) : null,
        rate: buf.temp.rate(),
        speed: kind === 'fan' ? lastOf(powers) : null,
        minTemp: prev?.minTemp ?? null,
        maxTemp: prev?.maxTemp ?? null,
        chartVisible: prev?.chartVisible ?? true,
        powerVisible: prev?.powerVisible ?? false,
      });
    }

    next.sort(
      (a, b) =>
        sensorSortKey(a.name, a.kind) - sensorSortKey(b.name, b.kind) ||
        a.displayName.localeCompare(b.displayName),
    );

    sensors = next;
    tick++;
    evalHolds();
  }

  // ------------------------------------------------------------------
  // Limits
  // ------------------------------------------------------------------

  async function refreshLimits(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h || gen !== generation) return;

    let limits: LimitsMap | null = null;
    const cached = limitsCache.get(printerId);
    if (cached && Date.now() - cached.ts < LIMITS_TTL_MS) {
      limits = cached.limits;
    } else {
      let res: any = null;
      try {
        res = await h.request('printer.objects.query', {
          objects: { configfile: ['settings'] },
        });
      } catch {
        return;
      }
      if (gen !== generation) return;

      const settings = res?.status?.configfile?.settings;
      if (!settings || typeof settings !== 'object') return;

      const next: LimitsMap = {};
      for (const s of sensors) {
        const sec =
          (settings as Record<string, any>)[s.name] ??
          (settings as Record<string, any>)[s.name.toLowerCase()];
        if (!sec || typeof sec !== 'object') {
          next[s.name] = { min: null, max: null };
          continue;
        }
        next[s.name] = {
          min: typeof sec.min_temp === 'number' ? sec.min_temp : null,
          max: typeof sec.max_temp === 'number' ? sec.max_temp : null,
        };
      }
      limits = next;
      limitsCache.set(printerId, { limits, ts: Date.now() });
    }

    for (const s of sensors) {
      const lim = limits[s.name];
      s.minTemp = lim?.min ?? null;
      s.maxTemp = lim?.max ?? null;
    }
  }

  function ensureSubscription(gen: number): void {
    const h = safeHandle();
    if (!h || gen !== generation) return;

    if (unsubStatus) {
      unsubStatus();
      unsubStatus = null;
    }

    const objects: Record<string, string[]> = {};
    for (const s of sensors) {
      objects[s.name] =
        s.kind === 'sensor' ? ['temperature']
        : s.kind === 'fan' ? ['temperature', 'target', 'speed']
        : ['temperature', 'target', 'power'];
    }

    if (Object.keys(objects).length === 0) return;

    objects.print_stats = ['state']; // таймер нагревателя не работает во время печати

    unsubStatus = h.subscribe(
      objects,
      (delta: any) => {
        if (gen === generation) onDelta(delta);
      },
      { immediate: true }, // baseline-snapshot сеет мгновенно
    );
  }

  function onDelta(delta: Record<string, any>): void {
    const t = Math.floor(Date.now() / 1000);

    // new value
    for (const s of sensors) {
      const d = delta[s.name];
      if (!d) continue;

      if (typeof d.temperature === 'number') s.temperature = d.temperature;
      if (typeof d.target === 'number' && s.kind !== 'sensor') s.target = d.target;
      if (typeof d.power === 'number' && s.kind !== 'sensor') s.power = d.power;
      if (typeof d.speed === 'number' && s.kind === 'fan') {
        s.speed = d.speed;
        s.power = d.speed; // таблица и график читают мощность вентилятора из power
      }
    }

    const ps = delta.print_stats?.state;
    if (typeof ps === 'string') printing = ps === 'printing' || ps === 'paused';

    // push tick
    let pushed = false;
    for (const s of sensors) {
      const buf = buffers.get(s.name);
      if (!buf) continue;

      const times = buf.temp.timesArray;
      if (times.length > 0 && times[times.length - 1] === t) continue;

      if (s.temperature != null) buf.temp.push(t, s.temperature);
      if (s.kind !== 'sensor') {
        if (s.target != null) buf.target.push(t, s.target);
        const pwr = s.kind === 'fan' ? (s.speed ?? s.power) : s.power;
        if (pwr != null) buf.power.push(t, pwr);
      }

      pushed = true;
      s.rate = buf.temp.rate();
    }

    if (pushed) tick++;
    evalHolds();
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  function toggleChart(name: string): void {
    const s = sensors.find((x) => x.name === name);
    if (s) s.chartVisible = !s.chartVisible;
  }

  function togglePower(name: string): void {
    const s = sensors.find((x) => x.name === name);
    if (s) s.powerVisible = !s.powerVisible;
  }

  async function setTarget(name: string, value: number): Promise<void> {
    const s = sensors.find((x) => x.name === name);
    if (!s) return;

    const gcode = buildTargetGcode(name, s.kind, value);
    if (!gcode) return;

    const h = safeHandle();
    if (!h) return;

    try {
      await h.request('printer.gcode.script', { script: gcode });
    } catch (e) {
      console.error('[temperature] setTarget failed:', gcode, e);
    }
  }

  // ------------------------------------------------------------------
  // Hold timer: «включить нагреватель на N минут после достижения цели».
  // Отсчёт идёт в браузере; при потере связи нагреватель остаётся включённым,
  // страховка — idle_timeout Klipper. Во время печати не взводится и сбрасывается.
  // ------------------------------------------------------------------

  const RETRY_FIRE_MS = 5000;

  function effectiveMinutes(name: string): number {
    return holdColumnOn ? (holdMinutes[name] ?? 0) : 0;
  }

  function evalHolds(): void {
    const now = Date.now();
    const next: Record<string, HoldState> = {};
    let changed = false;

    for (const s of sensors) {
      if (s.kind !== 'heater') continue;

      const prev = holds[s.name] ?? HOLD_OFF;
      const minutes = effectiveMinutes(s.name);
      const res = stepHold(prev, {
        target: s.target,
        temperature: s.temperature,
        minutes,
        blocked: printing,
        now,
      });

      let state = res.state;
      // нет связи — выключить не получится: ждём в holding, сработает после реконнекта
      if (res.fire && !connected) state = prev;
      else if (res.fire) void fireHold(s.name, minutes);

      if (state.phase !== 'off') next[s.name] = state;
      if (!sameHold(state, prev)) changed = true;
    }

    if (Object.keys(holds).length !== Object.keys(next).length) changed = true;
    if (changed) holds = next;
    if (Object.values(next).some((h) => h.phase === 'holding')) holdNow = now;
  }

  async function fireHold(name: string, minutes: number): Promise<void> {
    const h = safeHandle();
    const gcode = buildTargetGcode(name, 'heater', 0);
    try {
      if (!h || !gcode) throw new Error('no handle');
      await h.request('printer.gcode.script', { script: gcode });
    } catch (e) {
      console.error('[temperature] hold off failed, retry:', name, e);
      // вернуть в holding так, чтобы повтор случился через RETRY_FIRE_MS
      const cur = holds[name];
      if (cur && cur.phase === 'done') {
        holds = {
          ...holds,
          [name]: { ...cur, phase: 'holding', startedAt: Date.now() - minutes * 60_000 + RETRY_FIRE_MS },
        };
      }
    }
  }

  function onHoldTick(): void {
    evalHolds();
  }

  function setHoldMinutes(name: string, minutes: number): void {
    if (!Number.isFinite(minutes) || minutes < 0) return;
    const m = Math.min(minutes, HOLD_MAX_MINUTES);
    const next = { ...holdMinutes };
    if (m > 0) next[name] = m;
    else delete next[name];
    holdMinutes = next;
    settingsApi.set(HOLD_MINUTES_KEY, next);
    evalHolds();
  }

  /** Состояние таймера строки: фаза и остаток (с) для UI */
  function holdStatus(name: string): { phase: HoldState['phase']; remainingMs: number | null } {
    const st = holds[name] ?? HOLD_OFF;
    return { phase: st.phase, remainingMs: holdRemainingMs(st, effectiveMinutes(name), holdNow) };
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  init();

  function destroy(): void {
    teardown();
  }

  return {
    get sensors() {
      return sensors;
    },
    get klippyState() {
      return klippyState;
    },
    get connected() {
      return connected;
    },
    get tick() {
      return tick;
    },
    buffers,
    get holdMinutes() {
      return holdMinutes;
    },
    holdStatus,
    setHoldMinutes,
    toggleChart,
    togglePower,
    setTarget,
    destroy,
  };
}

export type TemperatureStore = ReturnType<typeof createTemperatureCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount потребителей
// (keep-alive, LRU cap 4). Буферы графиков сохраняются между
// переключениями принтеров — самый заметный UX-выигрыш.
// ------------------------------------------------------------------
const keeper = createCoreKeeper<TemperatureStore>({
  create: (pid, api) => createTemperatureCore(api, pid),
  cap: 4,
});

/**
 * Хук данных температур.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * refcount на текущего принтера, ядра других принтеров живут в keeper по
 * политике keep-alive. С printerId — fleet/явная привязка: прямое ядро с
 * удержанием.
 */
export function useTemperatureData(api: PluginApi, printerId?: string): TemperatureStore {
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
  return createDelegateStore<TemperatureStore>(() => keeper.get(api.printer.id, api));
}