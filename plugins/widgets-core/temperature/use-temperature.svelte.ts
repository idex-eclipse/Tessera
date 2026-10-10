import { onDestroy } from 'svelte';

import type { PluginApi } from '../../../plugin-sdk/src/types';

import {
  buildTargetGcode,
  classifySensor,
  displayName,
  sensorSortKey,
  type SensorKind,
} from './data';
import { SeriesBuffer } from '../../shared/uplot-core/series-buffer';

// ------------------------------------------------------------------
// Module-level prefs: шапка и виджет — разные custom-элементы, но один
// модуль → $state-мутация здесь сразу отражается во всех читателях (без F5).
// ------------------------------------------------------------------

export interface TempColumns {
  power: boolean;
  rate: boolean;
  current: boolean;
  target: boolean;
}

const DEFAULT_COLUMNS: TempColumns = {
  power: true,
  rate: true,
  current: true,
  target: true,
};

let columns = $state<TempColumns>({ ...DEFAULT_COLUMNS });

export function useTemperaturePrefs(api: PluginApi) {
  function load(): void {
    columns = {
      ...DEFAULT_COLUMNS,
      ...(api.settings.get<Partial<TempColumns>>('temperature.columns') ?? {}),
    };
  }

  load();

  const off = api.settings.onChange((k, v) => {
    if (k === 'temperature.columns' && v && typeof v === 'object') {
      columns = { ...DEFAULT_COLUMNS, ...(v as Partial<TempColumns>) };
    }
  });
  const offPrinter = api.onPrinterChange(() => load());
  onDestroy(() => {
    off();
    offPrinter();
  });

  function setColumn(key: keyof TempColumns, value: boolean): void {
    columns = { ...columns, [key]: value };
    api.settings.set('temperature.columns', columns);
  }

  return {
    get columns() {
      return columns;
    },
    setColumn,
  };
}

// ------------------------------------------------------------------
// Данные сенсоров и буферы
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

export function useTemperatureData(api: PluginApi) {
  let sensors = $state<TemperatureSensor[]>([]);
  let klippyState = $state<string>('unknown');
  let connected = $state<boolean>(false);
  let tick = $state(0);

  const buffers = new Map<string, SensorBuffers>();

  let generation = 0;
  let unsubStatus: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  function safeHandle() {
    try {
      return api.moonraker();
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

    for (const u of unsubs.splice(0)) u();
    buffers.clear();
  }

  async function init(): Promise<void> {
    const gen = ++generation;

    sensors = [];
    klippyState = 'unknown';
    connected = false;

    if (!api.printer.url) return;

    const h = safeHandle();
    if (!h) return;

    connected = h.readyState === 'open';

    unsubs.push(
      h.onConnectionStatusChange((s) => {
        connected = s === 'open';

        // Страховка: повторный refresh при каждом открытии соединения
        if (s === 'open' && gen === generation) {
          void refresh(gen);
        }
      }),
    );

    unsubs.push(
      h.onReady(() => {
        // ВАЖНО: refresh, а не reseed — чтобы обновился klippyState
        if (gen === generation) void refresh(gen);
      }),
    );

    for (const ev of KLIPPY_EVENTS) {
      unsubs.push(
        h.onNotify(ev, () => {
          if (gen === generation) void refresh(gen);
        }),
      );
    }

    unsubs.push(
      h.onNotify('notify_config_changed', () => {
        if (gen === generation) void refreshLimits(gen);
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

  async function reseed(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h || gen !== generation) return;

    let store: any = null;
    try {
      store = await h.request('server.temperature_store');
    } catch {
      return;
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
      const powers: number[] = entry?.powers ?? [];
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
        speed: null,
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
  }

  /** Лимиты целевой температуры: min_temp/max_temp из configfile.settings.
   *  Ключи секций совпадают с именами объектов температуры (lowercase). */
  async function refreshLimits(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h || gen !== generation) return;

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

    for (const s of sensors) {
      const sec =
        (settings as Record<string, any>)[s.name] ??
        (settings as Record<string, any>)[s.name.toLowerCase()];
      if (!sec || typeof sec !== 'object') continue;
      s.minTemp = typeof sec.min_temp === 'number' ? sec.min_temp : null;
      s.maxTemp = typeof sec.max_temp === 'number' ? sec.max_temp : null;
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
        : s.kind === 'fan' ? ['temperature', 'target', 'power', 'speed']
        : ['temperature', 'target', 'power'];
    }

    if (Object.keys(objects).length === 0) return;

    unsubStatus = h.subscribe(
      objects,
      (delta: any) => {
        if (gen === generation) onDelta(delta);
      },
      { immediate: false },
    );
  }

  function onDelta(delta: Record<string, any>): void {
    // целая секунда: в один и тот же тик попадают все сенсоры,
    // seed-времена из temperature_store тоже целые — ось монотонна и стабильна
    const t = Math.floor(Date.now() / 1000);

    // 1) применяем свежие значения из дельты
    for (const s of sensors) {
      const d = delta[s.name];
      if (!d) continue;

      if (typeof d.temperature === 'number') s.temperature = d.temperature;
      if (typeof d.target === 'number' && s.kind !== 'sensor') s.target = d.target;
      if (typeof d.power === 'number' && s.kind !== 'sensor') s.power = d.power;
      if (typeof d.speed === 'number' && s.kind === 'fan') s.speed = d.speed;
    }

    // 2) единый временной тик: пушим ВСЕ сенсоры одним t (zero-order hold),
    //    чтобы концы буферов совпадали и референс оси X не осциллировал
    let pushed = false;
    for (const s of sensors) {
      const buf = buffers.get(s.name);
      if (!buf) continue;

      const times = buf.temp.timesArray;
      // эта секунда уже записана (вторая дельта за ту же секунду) — не дублируем
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
  // Boot
  // ------------------------------------------------------------------

  init();

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    init();
  });

  onDestroy(() => {
    teardown();
    offPrinter();
  });

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
    toggleChart,
    togglePower,
    setTarget,
  };
}