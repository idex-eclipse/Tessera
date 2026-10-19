import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../../shared/core-keeper/core-keeper';

export interface OutputItem {
  id: string; // 'fan' / 'fan_generic extruder' / 'output_pin led' / 'heater_fan x'…
  kind:
    | 'fan'
    | 'fan_generic'
    | 'temperature_fan'
    | 'heater_fan'
    | 'controller_fan'
    | 'output_pin';
  name: string; // command name
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** klipper controlled */
  readOnly: boolean;
}

function prettify(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ------------------------------------------------------------------
// Module-level кэш метаданных (items) per-printer.
// Инвалидация по notify_klippy_ready / notify_config_changed.
// Долгоживущий — без TTL; перечитывание только при инвалидации.
// ------------------------------------------------------------------
interface MetaCacheEntry {
  items: OutputItem[];
  ts: number;
}
const metaCache = new Map<string, MetaCacheEntry>();

function invalidateMeta(printerId: string): void {
  metaCache.delete(printerId);
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// Legacy-режим (без printerId) = делегат, следующий за активным принтером.
// Fleet-режим (с printerId) = прямое ядро с удержанием.
// ------------------------------------------------------------------
function createOutputsCore(api: PluginApi, printerId: string) {
  let items = $state<OutputItem[]>([]);
  let values = $state<Record<string, number>>({});

  let generation = 0;
  let unsubMeta: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function script(cmd: string): void {
    safeHandle()
      ?.request('printer.gcode.script', { script: cmd })
      .catch((e) => console.error('[outputs] gcode failed:', cmd, e));
  }

  function applyDelta(d: any): void {
    if (!d) return;
    let changed = false;
    const next = { ...values };
    for (const it of items) {
      const obj = d[it.id];
      if (!obj) continue;
      const raw = it.kind === 'output_pin' ? num(obj.value) : num(obj.speed);
      if (raw != null) {
        next[it.id] = raw;
        changed = true;
      }
    }
    if (changed) values = next;
  }

  // Метаданные: управляемые выходы из конфига + авто-венты из objects.list
  async function loadMeta(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    // Проверяем кэш
    const cached = metaCache.get(printerId);
    if (cached) {
      items = cached.items;
    } else {
      // Cache-miss: два параллельных запроса
      const [list, cfgRes] = await Promise.all([
        h.request<any>('printer.objects.list').catch(() => null),
        h.request<any>('printer.objects.query', { objects: { configfile: ['settings'] } }).catch(() => null),
      ]);
      if (gen !== generation || !list) return;

      const objects: string[] = list.objects ?? [];
      const settings = (cfgRes?.status?.configfile?.settings ?? {}) as Record<string, any>;

      const next: OutputItem[] = [];

      // --- управляемые: [fan] ---
      if (objects.includes('fan')) {
        next.push({
          id: 'fan',
          kind: 'fan',
          name: 'fan',
          label: 'Fan',
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 0,
          readOnly: false,
        });
      }

      // --- управляемые: fan_generic / output_pin (из конфига) ---
      for (const key of Object.keys(settings)) {
        if (key.startsWith('fan_generic ')) {
          const name = key.slice('fan_generic '.length);
          next.push({
            id: key,
            kind: 'fan_generic',
            name,
            label: prettify(name),
            min: 0,
            max: 1,
            step: 0.01,
            decimals: 0,
            readOnly: false,
          });
        } else if (key.startsWith('output_pin ')) {
          const cfg = settings[key] ?? {};
          if (cfg.static === true) continue; // static-пин не управляется SET_PIN
          const name = key.slice('output_pin '.length);
          const min = Number(cfg.minimum ?? 0);
          const max = Number(cfg.maximum ?? 1);
          const pwm = cfg.pwm !== false;
          next.push({
            id: key,
            kind: 'output_pin',
            name,
            label: prettify(name),
            min,
            max,
            step: pwm ? Math.max((max - min) / 100, 0.01) : 1,
            decimals: pwm ? 2 : 0,
            readOnly: false,
          });
        }
      }

      // --- авто-вентиляторы: статус-объекты из objects.list ---
      for (const obj of objects) {
        const kind = obj.startsWith('heater_fan ')
          ? ('heater_fan' as const)
          : obj.startsWith('controller_fan ')
            ? ('controller_fan' as const)
            : obj.startsWith('temperature_fan ')
              ? ('temperature_fan' as const)
              : null;
        if (!kind) continue;
        const name = obj.slice(obj.indexOf(' ') + 1);
        next.push({
          id: obj,
          kind,
          name,
          label: prettify(name),
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 0,
          readOnly: true,
        });
      }

      items = next;
      metaCache.set(printerId, { items: next, ts: Date.now() });
    }

    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }

    if (items.length === 0) return;

    // подписка: output_pin → 'value', всё остальное (включая авто-венты) → 'speed'
    const subObjects: Record<string, string[]> = {};
    for (const it of items) subObjects[it.id] = it.kind === 'output_pin' ? ['value'] : ['speed'];

    unsubMeta = h.subscribe(
      subObjects,
      (d: any) => {
        if (gen === generation) applyDelta(d);
      },
      { immediate: true },
    );

    // SEED: значения вентиляторов/пинов меняются редко — после F5 дельты их не принесут
    const seeded = await h
      .request<any>('printer.objects.query', {
        objects: Object.fromEntries(items.map((it) => [it.id, null])),
      })
      .catch(() => null);
    if (gen === generation && seeded?.status) applyDelta(seeded.status);
  }

  // Actions
  function setValue(id: string, raw: number): void {
    const it = items.find((x) => x.id === id);
    if (!it || it.readOnly) return;

    if (it.kind === 'fan') {
      script(raw <= 0 ? 'M107' : `M106 S${Math.round(raw * 255)}`);
    } else if (it.kind === 'fan_generic') {
      script(`SET_FAN_SPEED FAN=${it.name} SPEED=${Math.round(raw * 10000) / 10000}`);
    } else {
      script(`SET_PIN PIN=${it.name} VALUE=${raw}`);
    }
  }

  // Lifecycle
  function teardown(): void {
    generation++;
    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }
    for (const u of unsubs.splice(0)) u();
  }

  async function init(): Promise<void> {
    const gen = ++generation;
    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void loadMeta(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (gen !== generation) return;
        invalidateMeta(printerId);
        void loadMeta(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_config_changed', () => {
        if (gen !== generation) return;
        invalidateMeta(printerId);
        void loadMeta(gen);
      }),
    );

    await loadMeta(gen);
  }

  init();

  function destroy(): void {
    teardown();
  }

  return {
    get items() {
      return items;
    },
    get values() {
      return values;
    },
    setValue,
    destroy,
  };
}

export type OutputsStore = ReturnType<typeof createOutputsCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<OutputsStore>({
  create: (pid, api) => createOutputsCore(api, pid),
  cap: 4,
});

/**
 * Хук выходов (вентиляторы/пины).
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * refcount на текущего принтера, ядра других принтеров живут в keeper по
 * политике keep-alive. С printerId — fleet: прямое ядро с удержанием.
 *
 * Метаданные (items) кэшируются per-printer; инвалидация по
 * notify_klippy_ready / notify_config_changed (SAVE_CONFIG).
 */
export function useOutputs(api: PluginApi, printerId?: string): OutputsStore {
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
  return createDelegateStore<OutputsStore>(() => keeper.get(api.printer.id, api));
}