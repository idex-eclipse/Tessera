import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../../shared/core-keeper/core-keeper';

export interface LimitsState {
  velocity: number;
  accel: number;
  scv: number;
  mcr: number; // 0..1
}

const INITIAL_DEFAULTS: LimitsState = { velocity: 500, accel: 5000, scv: 5, mcr: 0 };
const INITIAL_LIMITS: LimitsState = { velocity: 0, accel: 0, scv: 0, mcr: 0 };

// ------------------------------------------------------------------
// Module-level кэш defaults (из configfile.settings.printer.*) per-printer.
// Инвалидация по klippy_ready/config_changed (конфиг мог измениться).
// Долгоживущий — без TTL; перечитывание только при инвалидации.
// ------------------------------------------------------------------
interface DefaultsCacheEntry {
  defaults: LimitsState;
  ts: number;
}
const defaultsCache = new Map<string, DefaultsCacheEntry>();

function invalidateDefaults(printerId: string): void {
  defaultsCache.delete(printerId);
}

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// Legacy-режим (без printerId) = делегат, следующий за активным принтером.
// Fleet-режим (с printerId) = прямое ядро с удержанием.
// ------------------------------------------------------------------
function createLimitsCore(api: PluginApi, printerId: string) {
  let meta = $state<{ ready: boolean; defaults: LimitsState }>({
    ready: false,
    defaults: { ...INITIAL_DEFAULTS },
  });
  let limits = $state<LimitsState>({ ...INITIAL_LIMITS });

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
      .catch((e) => console.error('[limits] gcode failed:', cmd, e));
  }

  function applyDelta(d: any): void {
    const t = d?.toolhead;
    if (!t) return;
    const vel = num(t.max_velocity);
    const acc = num(t.max_accel);
    const scv = num(t.square_corner_velocity);
    const mcr = num(t.minimum_cruise_ratio);
    if (vel == null && acc == null && scv == null && mcr == null) return;
    limits = {
      velocity: vel ?? limits.velocity,
      accel: acc ?? limits.accel,
      scv: scv ?? limits.scv,
      mcr: mcr ?? limits.mcr,
    };
  }

  async function loadMeta(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    // defaults: кэш per-printer; при cache-miss — запрос configfile
    let defaults: LimitsState;
    const cached = defaultsCache.get(printerId);
    if (cached) {
      defaults = cached.defaults;
    } else {
      const cfgRes = await h
        .request<any>('printer.objects.query', { objects: { configfile: ['settings'] } })
        .catch(() => null);
      if (gen !== generation) return;

      const settings = (cfgRes?.status?.configfile?.settings ?? {}) as Record<string, any>;
      const p = settings.printer ?? {};
      defaults = {
        velocity: Number(p.max_velocity ?? INITIAL_DEFAULTS.velocity),
        accel: Number(p.max_accel ?? INITIAL_DEFAULTS.accel),
        scv: Number(p.square_corner_velocity ?? INITIAL_DEFAULTS.scv),
        mcr: Number(p.minimum_cruise_ratio ?? INITIAL_DEFAULTS.mcr),
      };
      defaultsCache.set(printerId, { defaults, ts: Date.now() });
    }

    meta = { ready: true, defaults };

    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }

    unsubMeta = h.subscribe(
      {
        toolhead: [
          'max_velocity',
          'max_accel',
          'square_corner_velocity',
          'minimum_cruise_ratio',
        ],
      },
      (d: any) => {
        if (gen === generation) applyDelta(d);
      },
      { immediate: true },
    );

    // SEED: текущее состояние toolhead
    const seeded = await h
      .request<any>('printer.objects.query', { objects: { toolhead: null } })
      .catch(() => null);
    if (gen === generation && seeded?.status) applyDelta(seeded.status);
  }

  function setLimit(patch: Partial<LimitsState>): void {
    const parts: string[] = [];
    if (patch.velocity != null) parts.push(`VELOCITY=${patch.velocity}`);
    if (patch.accel != null) parts.push(`ACCEL=${patch.accel}`);
    if (patch.scv != null) parts.push(`SQUARE_CORNER_VELOCITY=${patch.scv}`);
    if (patch.mcr != null) parts.push(`MINIMUM_CRUISE_RATIO=${patch.mcr}`);
    if (parts.length > 0) script(`SET_VELOCITY_LIMIT ${parts.join(' ')}`);
  }

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
        invalidateDefaults(printerId);
        void loadMeta(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_config_changed', () => {
        if (gen !== generation) return;
        invalidateDefaults(printerId);
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
    get meta() {
      return meta;
    },
    get limits() {
      return limits;
    },
    setLimit,
    destroy,
  };
}

export type LimitsStore = ReturnType<typeof createLimitsCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<LimitsStore>({
  create: (pid, api) => createLimitsCore(api, pid),
  cap: 4,
});

/**
 * Хук лимитов скорости/ускорения.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * refcount на текущего принтера, ядра других принтеров живут в keeper по
 * политике keep-alive. С printerId — fleet: прямое ядро с удержанием.
 *
 * Defaults (из configfile.settings.printer.*) кэшируются per-printer;
 * инвалидация по notify_klippy_ready / notify_config_changed (SAVE_CONFIG).
 */
export function useLimits(api: PluginApi, printerId?: string): LimitsStore {
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
  return createDelegateStore<LimitsStore>(() => keeper.get(api.printer.id, api));
}