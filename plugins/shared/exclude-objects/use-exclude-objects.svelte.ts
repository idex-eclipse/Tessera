import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../../shared/core-keeper/core-keeper';

export interface ExcludeObject {
  name: string;
  polygon: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
  excluded: boolean;
  current: boolean;
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// Legacy-режим (без printerId) = делегат, следующий за активным принтером.
// Fleet-режим (с printerId) = прямое ядро с удержанием.
// ------------------------------------------------------------------
function createExcludeObjectsCore(api: PluginApi, printerId: string | null) {
  const fleet = printerId !== null;

  let available = $state(false);
  let objects = $state<ExcludeObject[]>([]);

  let generation = 0;
  let unsub: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return fleet ? api.moonrakerFor(printerId as string) : api.moonraker();
    } catch {
      return null;
    }
  }

  async function detectAndSubscribe(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h || gen !== generation) return;

    const list = await h.request<any>('printer.objects.list').catch(() => null);
    if (gen !== generation) return;
    const has = ((list?.objects ?? []) as string[]).includes('exclude_object');
    available = has;

    if (unsub) {
      unsub();
      unsub = null;
    }
    if (!has) {
      objects = [];
      return;
    }

    unsub = h.subscribe(
      { exclude_object: ['objects', 'excluded_objects', 'current_object'] },
      (d: any) => {
        if (gen === generation) applyDelta(d);
      },
      { immediate: true },
    );
  }

  function applyDelta(d: any): void {
    const eo = d?.exclude_object;
    if (!eo) return;
    const excluded = new Set<string>(
      Array.isArray(eo.excluded_objects) ? eo.excluded_objects : [],
    );
    const current: string | null =
      typeof eo.current_object === 'string' ? eo.current_object : null;
    const raw: any[] = Array.isArray(eo.objects) ? eo.objects : [];

    const next: ExcludeObject[] = [];
    for (const o of raw) {
      if (!o || typeof o.name !== 'string') continue;
      const poly: Array<{ x: number; y: number }> = Array.isArray(o.polygon)
        ? o.polygon
            .map((pt: any) =>
              Array.isArray(pt) && pt.length >= 2
                ? { x: Number(pt[0]), y: Number(pt[1]) }
                : null,
            )
            .filter(
              (p: any): p is { x: number; y: number } =>
                p != null && Number.isFinite(p.x) && Number.isFinite(p.y),
            )
        : [];
      const c =
        Array.isArray(o.center) && o.center.length >= 2
          ? { x: Number(o.center[0]), y: Number(o.center[1]) }
          : centroid(poly);
      next.push({
        name: o.name,
        polygon: poly,
        center: c,
        excluded: excluded.has(o.name),
        current: current === o.name,
      });
    }
    objects = next;
  }

  function centroid(poly: Array<{ x: number; y: number }>): { x: number; y: number } {
    if (poly.length === 0) return { x: 0, y: 0 };
    let sx = 0,
      sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }

  async function exclude(name: string): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    await h
      .request('printer.gcode.script', { script: `EXCLUDE_OBJECT NAME=${name}` })
      .catch((e) => console.error('[exclude] failed:', name, e));
  }

  async function init(): Promise<void> {
    const gen = ++generation;
    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void detectAndSubscribe(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (gen === generation) void detectAndSubscribe(gen);
      }),
    );

    await detectAndSubscribe(gen);
  }

  function teardown(): void {
    generation++;
    if (unsub) {
      unsub();
      unsub = null;
    }
    for (const u of unsubs.splice(0)) u();
    objects = [];
    available = false;
  }

  init();

  let offPrinter: () => void = () => {};

  if (!fleet) {
    offPrinter = api.onPrinterChange(() => {
      teardown();
      void init();
    });
  }

  function destroy(): void {
    offPrinter();
    teardown();
  }

  return {
    get available() {
      return available;
    },
    get objects() {
      return objects;
    },
    exclude,
    destroy,
  };
}

export type ExcludeObjectsStore = ReturnType<typeof createExcludeObjectsCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount потребителей
// (keep-alive, LRU cap 4).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<ExcludeObjectsStore>({
  create: (pid, api) => createExcludeObjectsCore(api, pid),
  cap: 4,
});

/**
 * Хук exclude_object.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * refcount на текущего принтера, ядра других принтеров живут в keeper по
 * политике keep-alive. С printerId — fleet/явная привязка: прямое ядро с
 * удержанием.
 */
export function useExcludeObjects(
  api: PluginApi,
  printerId?: string,
): ExcludeObjectsStore {
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
  return createDelegateStore<ExcludeObjectsStore>(() =>
    keeper.get(api.printer.id, api),
  );
}