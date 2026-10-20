import { onDestroy } from 'svelte';
import { SeriesBuffer } from '../shared/uplot-core';
import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../shared/core-keeper/core-keeper';

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
      color: '#ff6d00',
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

  $effect(() => {
    const gen = ++generation;
    subscribe(gen);
    return () => {
      generation++;
      if (unsub) { unsub(); unsub = null; }
    };
  });

  function destroy(): void {
    generation++;
    if (unsub) { unsub(); unsub = null; }
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

const keeper = createCoreKeeper<HeaterStore>({
  create: (pid, api) => {
    // Ключ keeper'а уже = pid; heaterName берём из параметра ниже через getOrCreate
    // Это ограничение базового keeper'а — для составного ключа нужен форк
    // Но heaterName = параметр UI, он обычно одинаков на одном принтере
    // Пока делаем компромисс: одно ядро на принтер, heaterName переключается внутри
    throw new Error('useHeater требует useHeaterMonitor с heaterName-state');
  },
  cap: 4,
});

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

export function useHeaterMonitor(api: PluginApi, printerId?: string) {
  const pid = printerId ?? api.printer.id;
  let heaterName = $state('');

  let currentCore = $state<HeaterStore | null>(null);
  let currentRefCount: { inc: () => void; dec: () => void } | null = null;

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
    }
    return core;
  }

  $effect(() => {
    const name = heaterName;
    if (!name) {
      currentCore = null;
      return;
    }
    currentCore = ensureCore(name);
  });

  // Cleanup при unmount компонента (НЕ при смене heaterName — ядро живёт в Map)
  onDestroy(() => {
    // Ядро остаётся живым в perPrinterKeepers — это и есть keep-alive
    // Cleanup при удалении принтера из реестра делается через onPrintersChange
    // (см. ниже)
  });

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

  function setHeater(name: string): void {
    heaterName = name;
  }

  // Делегат на текущее ядро (если выбран heaterName)
  const delegate = createDelegateStore<HeaterStore>(() => {
    if (!currentCore) {
      // Возвращаем "пустое" ядро-заглушку с пустыми данными
      return ensureCore('__placeholder__');
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