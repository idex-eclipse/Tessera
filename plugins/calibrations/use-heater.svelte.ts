/**
 * Хук данных одного нагревателя для Heaters-панели.
 * Подписывается на temperature/target/power, ведёт SeriesBuffer,
 * возвращает совместимые с UPlotChart sensors/buffers/tick.
 */
import { onDestroy } from 'svelte';

import { SeriesBuffer } from '../shared/uplot-core';
import type { PluginApi } from '../../plugin-sdk/src/types';

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

export function useHeaterMonitor(api: PluginApi) {
  let heaterName = $state('');

  let sensors = $state<HeaterSensors[]>([]);
  let tick = $state(0);
  const buffers = new Map<string, HeaterBuffers>();

  let unsub: (() => void) | null = null;
  let generation = 0;

  function teardown(): void {
    generation++;
    if (unsub) {
      unsub();
      unsub = null;
    }
    buffers.clear();
    sensors = [];
    tick = 0;
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

  function displayName(name: string): string {
    if (name === 'heater_bed') return 'Heater Bed';
    if (/^extruder\d*$/.test(name)) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    if (name.startsWith('heater_generic ')) {
      const rest = name.replace(/^heater_generic /, '');
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return name;
  }

  /** Reseed буферов из истории Moonraker (последние 20 минут или до перезагрузки Klipper). */
  async function reseed(name: string, gen: number): Promise<void> {
    const h = api.moonraker();
    let store: any = null;
    try {
      store = await h.request<any>('server.temperature_store');
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

  function subscribe(name: string): void {
    const gen = ++generation;
    teardown();
    generation = gen;

    if (!name) return;

    sensors = [
      {
        name,
        displayName: displayName(name),
        color: '#ff6d00',
        temperature: null,
        target: null,
        power: null,
      },
    ];

    // Reseed из истории
    void reseed(name, gen);

    const h = api.moonraker();
    try {
      unsub = h.subscribe(
        { [name]: ['temperature', 'target', 'power'] },
        (delta: any) => {
          if (gen !== generation) return;
          const d = delta?.[name];
          if (!d) return;
          const s = sensors[0];
          if (!s) return;

          // 1) применяем свежие поля к состоянию (дельта разреженная)
          if (typeof d.temperature === 'number') s.temperature = d.temperature;
          if (typeof d.target === 'number') s.target = d.target;
          if (typeof d.power === 'number') s.power = d.power;

          // 2) единый тик: пушим ВСЕ серии из последнего известного состояния.
          //    Паттерн widgets-core/temperature: поле, не пришедшее в дельте,
          //    повторяется из состояния → буферы не голодают при константных
          //    target/power, а изменение, съеденное коллизией секунд,
          //    самовосстанавливается на следующем тике.
          const t = Math.floor(Date.now() / 1000);
          const b = ensureBuffers(name);
          const lastT = b.temp.timesArray[b.temp.timesArray.length - 1];
          if (lastT === t) return;   // эта секунда уже записана — не дублируем

          if (s.temperature != null) b.temp.push(t, s.temperature);
          if (s.target != null) b.target.push(t, s.target);
          if (s.power != null) b.power.push(t, s.power);
          tick++;
        },
        { immediate: false },
      );
    } catch (e) {
      console.warn('[heaters] subscribe failed for', name, e);
    }
  }

  $effect(() => {
    subscribe(heaterName);
  });

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    if (heaterName) subscribe(heaterName);
  });

  onDestroy(() => {
    teardown();
    offPrinter();
  });

  function setHeater(name: string): void {
    heaterName = name;
  }

  return {
    get heaterName() {
      return heaterName;
    },
    setHeater,
    get sensors() {
      return sensors;
    },
    buffers,
    get tick() {
      return tick;
    },
  };
}