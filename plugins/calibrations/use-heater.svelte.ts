import { onDestroy, untrack } from 'svelte';
import { SeriesBuffer } from '../shared/uplot-core';
import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';
import { createDelegateStore } from '../shared/core-keeper/core-keeper';

export interface HeaterSensors {
  name: string;
  displayName: string;
  color: string;
  temperature: number | null;
  target: number | null;
  power: number | null;
}

export interface HeaterBuffers {
  temp: SeriesBuffer;
  target: SeriesBuffer;
  power: SeriesBuffer;
}

/**
 * Ключ ядра = printerId + heaterName. Это значит: выбор нагревателя "extruder"
 * на принтере A и "extruder" на принтере B = разные ядра (keep-alive обоих).
 * Смена heaterName на одном принтере = release старого + acquire нового.
 *
 * Альтернатива — одно ядро на принтер с внутренним heaterName-state, но тогда
 * буферы "прошлого" нагревателя теряются при переключении. Текущая схема
 * сохраняет буферы всех посещённых heater'ов (до LRU-капа keeper'а).
 */
/** Цвет серии = CSS-переменная темы (canvas не понимает var(), резолвим локально). */
function themeColor(variable: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function createHeaterCore(api: PluginApi, printerId: string, heaterName: string) {
  const handle: MoonrakerProxyHandle = api.moonrakerFor(printerId);

  let sensors = $state<HeaterSensors[]>([]);
  let tick = $state(0);
  const buffers = new Map<string, HeaterBuffers>();

  let unsub: (() => void) | null = null;
  let generation = 0;

  function displayName(name: string): string {
    if (name === 'heater_bed') return 'Heater Bed';
    if (/^extruder\d*$/.test(name)) return name.charAt(0).toUpperCase() + name.slice(1);
    if (name.startsWith('heater_generic ')) {
      const rest = name.replace(/^heater_generic /, '');
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return name;
  }

  function ensureBuffers(name: string): HeaterBuffers {
    let b = buffers.get(name);
    if (!b) {
      b = {
        temp: new SeriesBuffer(),
        target: new SeriesBuffer(),
        power: new SeriesBuffer(),
      };
      buffers.set(name, b);
    }
    return b;
  }

  async function reseed(name: string, gen: number): Promise<void> {
    let store: any = null;
    try {
      store = await handle.request<any>('server.temperature_store');
    } catch {
      return;
    }
    if (gen !== generation || !store || typeof store !== 'object') return;

    const entry = store[name];
    if (!entry || typeof entry !== 'object') return;

    const temps: number[] = entry?.temperatures ?? [];
    const targets: number[] = entry?.targets ?? [];
    const powers: number[] = entry?.powers ?? [];
    const startTime: number = entry?.start_time ?? 0;

    const buf = ensureBuffers(name);
    buf.temp.clear();
    buf.target.clear();
    buf.power.clear();

    const now = Date.now() / 1000;
    const base = startTime > 0 ? startTime : now - temps.length;

    temps.forEach((t, i) => {
      const time = base + i;
      buf.temp.push(time, t);
      if (targets[i] !== undefined) buf.target.push(time, targets[i]);
      if (powers[i] !== undefined) buf.power.push(time, powers[i]);
    });

    const s = sensors[0];
    if (s) {
      s.temperature = temps[temps.length - 1] ?? null;
      s.target = targets[targets.length - 1] ?? null;
      s.power = powers[powers.length - 1] ?? null;
    }
    tick++;
  }

  function subscribe(gen: number): void {
    if (unsub) { unsub(); unsub = null; }
    if (!heaterName) return;

    sensors = [{
      name: heaterName,
      displayName: displayName(heaterName),
      color: themeColor('--heat', 'orange'),
      temperature: null, target: null, power: null,
    }];

    void reseed(heaterName, gen);

    try {
      unsub = handle.subscribe(
        { [heaterName]: ['temperature', 'target', 'power'] },
        (delta: any) => {
          if (gen !== generation) return;
          const d = delta?.[heaterName];
          if (!d) return;
          const s = sensors[0];
          if (!s) return;

          if (typeof d.temperature === 'number') s.temperature = d.temperature;
          if (typeof d.target === 'number') s.target = d.target;
          if (typeof d.power === 'number') s.power = d.power;

          const t = Math.floor(Date.now() / 1000);
          const b = ensureBuffers(heaterName);
          const lastT = b.temp.timesArray[b.temp.timesArray.length - 1];
          if (lastT === t) return;

          if (s.temperature != null) b.temp.push(t, s.temperature);
          if (s.target != null) b.target.push(t, s.target);
          if (s.power != null) b.power.push(t, s.power);
          tick++;
        },
        { immediate: false },
      );
    } catch (e) {
      console.warn('[heaters] subscribe failed for', heaterName, e);
    }
  }

  // Подписка стартует сразу при создании ядра. Намеренно НЕ $effect: ядро живёт в
  // Map (keep-alive) дольше эффекта, внутри которого его создали, и после
  // пересоздания эффекта осталось бы мёртвым.
  subscribe(++generation);

  // Цвет --heat зависит от темы: обновляем у живого ядра.
  const offTheme = api.onThemeChange(() => {
    const s = sensors[0];
    if (s) s.color = themeColor('--heat', 'orange');
  });

  function destroy(): void {
    generation++;
    if (unsub) { unsub(); unsub = null; }
    offTheme();
    buffers.clear();
  }

  return {
    get heaterName() { return heaterName; },
    get sensors() { return sensors; },
    buffers,
    get tick() { return tick; },
    destroy,
  };
}

export type HeaterStore = ReturnType<typeof createHeaterCore>;

/**
 * useHeaterMonitor — обёртка над keeper'ом для одного выбранного нагревателя.
 *
 * Архитектурно: один keeper на (printerId), heaterName — UI-параметр внутри
 * потребителя. При смене heaterName: release предыдущего + acquire нового ядра,
 * keyed by heaterName.
 *
 * Для простоты и сохранения совместимости с существующими компонентами,
 * используем Map<printerId, Map<heaterName, core>>:
 */
const perPrinterKeepers = new Map<string, Map<string, HeaterStore>>();

/** Максимум keep-alive ядер нагревателей на принтер (вытесняются самые старые). */
const MAX_HEATER_CORES_PER_PRINTER = 3;

function evictOldCores(printerMap: Map<string, HeaterStore>, keep: string): void {
  while (printerMap.size > MAX_HEATER_CORES_PER_PRINTER) {
    const victim = [...printerMap.keys()].find((k) => k !== keep && k !== '');
    if (victim === undefined) return;
    printerMap.get(victim)?.destroy();
    printerMap.delete(victim);
  }
}

export function useHeaterMonitor(api: PluginApi, printerId?: string) {
  const pid = printerId ?? api.printer.id;
  let heaterName = $state('');

  let currentCore = $state<HeaterStore | null>(null);

  function ensureCore(name: string): HeaterStore {
    let printerMap = perPrinterKeepers.get(pid);
    if (!printerMap) {
      printerMap = new Map();
      perPrinterKeepers.set(pid, printerMap);
    }
    let core = printerMap.get(name);
    if (!core) {
      core = createHeaterCore(api, pid, name);
      printerMap.set(name, core);
      evictOldCores(printerMap, name);
    }
    return core;
  }

  // Ядро остаётся живым в perPrinterKeepers (keep-alive) и при unmount компонента, и при
  // смене heaterName; чистка — при удалении принтера из реестра (onPrintersChange).
  const offPrinters = api.onPrintersChange((printers) => {
    const alive = new Set(printers.map((p) => p.id));
    for (const pid of Array.from(perPrinterKeepers.keys())) {
      if (!alive.has(pid)) {
        const printerMap = perPrinterKeepers.get(pid);
        if (printerMap) {
          for (const core of printerMap.values()) core.destroy();
          printerMap.clear();
        }
        perPrinterKeepers.delete(pid);
      }
    }
  });

  onDestroy(() => {
    offPrinters();
  });

  /**
   * Выбор нагревателя — обычное присваивание, без $effect. Вызывается из эффекта
   * компонента, поэтому создание ядра (оно читает и пишет $state) идёт в untrack:
   * иначе его чтения попали бы в зависимости эффекта вызывающего.
   */
  function setHeater(name: string): void {
    if (name === heaterName && (currentCore !== null || !name)) return;
    heaterName = name;
    currentCore = name ? untrack(() => ensureCore(name)) : null;
  }

  // Делегат на текущее ядро (если выбран heaterName)
  const delegate = createDelegateStore<HeaterStore>(() => {
    if (!currentCore) {
      // Пустое ядро-заглушка (имя '' — без подписки и данных)
      return ensureCore('');
    }
    return currentCore;
  });

  return {
    get heaterName() { return heaterName; },
    setHeater,
    get sensors() { return delegate.sensors; },
    get buffers() { return delegate.buffers; },
    get tick() { return delegate.tick; },
  };
}