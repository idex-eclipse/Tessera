import { onDestroy, untrack } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../shared/core-keeper/core-keeper';
import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte';
import {
  CANBUS_FIELDS,
  createHealthModel,
  MCU_FIELDS,
  numOrNull,
  RESTART_QUIET_SEC,
  STEPPER_ENABLE_FIELDS,
  TMC_FIELDS,
  type McuHealth,
  type TmcDriver,
} from './health-model';
import {
  hostSeverity,
  matchCanbus,
  matchMcu,
  matchTmc,
  parseThrottled,
  summarize,
  THROTTLE_UNSUPPORTED,
  type HealthSummary,
  type ThrottleState,
} from './health-utils';

export type { McuHealth, McuPoint, TmcDriver } from './health-model';
export { HEALTH_CAP } from './health-model';

// ------------------------------------------------------------------
// Core: ядро привязано к принтеру (как createSystemCore).
// ------------------------------------------------------------------
function createHealthCore(api: PluginApi, printerId: string) {
  const model = createHealthModel();

  let mcus = $state<McuHealth[]>([]);
  let tmc = $state<TmcDriver[]>([]);
  let throttle = $state<ThrottleState>(THROTTLE_UNSUPPORTED);
  let cpuTemp = $state<number | null>(null);
  let uptime = $state<number | null>(null);
  let netIssues = $state<number | null>(null);
  let stalls = $state<number | null>(null);
  let failedComponents = $state<string[]>([]);
  let warnings = $state<string[]>([]);

  let generation = 0;
  let objectsGen = 0;
  let unsubObjects: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  const klippy = useKlippyState(api, printerId);

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  // ---------------- MCU / CAN / TMC ----------------

  function applyDelta(delta: unknown): void {
    if (!klippy.ready) return;
    const res = model.apply(delta, Date.now() / 1000);
    if (res.mcus) mcus = res.mcus;
    if (res.tmc) tmc = res.tmc;
    if (res.stalls !== undefined) stalls = res.stalls;
  }

  function unsubscribeObjects(): void {
    objectsGen++;
    if (unsubObjects) {
      unsubObjects();
      unsubObjects = null;
    }
  }

  /** Список объектов зависит от конфига Klipper — перечитываем при каждом переходе в ready. */
  async function subscribeObjects(): Promise<void> {
    unsubscribeObjects();
    const gen = objectsGen;
    const h = safeHandle();
    if (!h) return;

    const list = await h.request<{ objects?: string[] }>('printer.objects.list').catch(() => null);
    if (gen !== objectsGen || !list) return;

    const objects: Record<string, string[]> = { toolhead: ['stalls'] };
    const known = new Set<string>();
    for (const n of list.objects ?? []) {
      if (typeof n !== 'string') continue;
      if (matchMcu(n)) objects[n] = MCU_FIELDS;
      else if (matchCanbus(n)) objects[n] = CANBUS_FIELDS;
      else if (matchTmc(n)) objects[n] = TMC_FIELDS;
      else if (n === 'stepper_enable') objects[n] = STEPPER_ENABLE_FIELDS;
      else continue;
      known.add(n);
    }

    const kept = model.retain(known);
    mcus = kept.mcus;
    tmc = kept.tmc;

    unsubObjects = h.subscribe(
      objects,
      (delta: unknown) => {
        if (gen === objectsGen) applyDelta(delta);
      },
      { immediate: true },
    );
  }

  // ---------------- Хост ----------------

  function applyThrottled(raw: unknown): void {
    throttle = parseThrottled(raw);
  }

  function applyProcStat(params: unknown): void {
    const p = (Array.isArray(params) ? params[0] : params) as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return;

    if ('cpu_temp' in p) cpuTemp = numOrNull(p.cpu_temp);
    if ('system_uptime' in p) uptime = numOrNull(p.system_uptime);
    if ('throttled_state' in p) applyThrottled(p.throttled_state);

    if (p.network && typeof p.network === 'object') {
      let total = 0;
      let seen = false;
      for (const iface of Object.values(p.network as Record<string, unknown>)) {
        if (!iface || typeof iface !== 'object') continue;
        for (const k of ['rx_errs', 'tx_errs', 'rx_drop', 'tx_drop']) {
          const v = numOrNull((iface as Record<string, unknown>)[k]);
          if (v !== null) {
            total += v;
            seen = true;
          }
        }
      }
      netIssues = seen ? total : null;
    }
  }

  async function loadHost(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const res = await h.request<unknown>('machine.proc_stats').catch(() => null);
    if (gen !== generation || !res) return;
    applyProcStat(res);
  }

  async function loadServerInfo(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const res = await h.request<Record<string, unknown>>('server.info').catch(() => null);
    if (gen !== generation || !res) return;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    failedComponents = strings(res.failed_components);
    warnings = strings(res.warnings);
  }

  async function refresh(): Promise<void> {
    const gen = generation;
    await Promise.all([loadHost(gen), loadServerInfo(gen)]);
  }

  // ---------------- Жизненный цикл ----------------

  // Подписка привязана к реактивному klippy.ready: так не теряется случай,
  // когда Klipper уже готов к моменту создания ядра (notify_klippy_ready не придёт).
  let wasReady: boolean | null = null;
  const stopEffects = $effect.root(() => {
    $effect(() => {
      const ready = klippy.ready;
      untrack(() => {
        // Рестарт Klipper: пока он не готов и ещё RESTART_QUIET_SEC после — связь с MCU
        // не оценивается (ретрансмиты при переподключении штатны). Первое же ready
        // при открытии страницы окно не включает.
        if (!ready) model.holdOff(Infinity);
        else if (wasReady === false) model.holdOff(Date.now() / 1000 + RESTART_QUIET_SEC);
        wasReady = ready;

        if (ready) void subscribeObjects();
        else unsubscribeObjects();
      });
    });
  });

  function init(): void {
    const gen = ++generation;
    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.onNotify('notify_proc_stat_update', (params) => {
        if (gen === generation) applyProcStat(params);
      }),
    );
    // Moonraker шлёт его при смене состояния; форма {bits, flags} та же, что у proc_stats
    unsubs.push(
      h.onNotify('notify_cpu_throttled', (params) => {
        if (gen === generation) applyThrottled(Array.isArray(params) ? params[0] : params);
      }),
    );
    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void refresh();
      }),
    );
  }

  init();

  function destroy(): void {
    generation++;
    unsubscribeObjects();
    for (const u of unsubs.splice(0)) u();
    stopEffects();
  }

  return {
    get mcus() {
      return mcus;
    },
    get tmc() {
      return tmc;
    },
    get throttle() {
      return throttle;
    },
    get cpuTemp() {
      return cpuTemp;
    },
    get uptime() {
      return uptime;
    },
    get netIssues() {
      return netIssues;
    },
    get stalls() {
      return stalls;
    },
    get failedComponents() {
      return failedComponents;
    },
    get warnings() {
      return warnings;
    },
    get klippyReady() {
      return klippy.ready;
    },
    get summary(): HealthSummary {
      return summarize({
        klippyReady: klippy.ready,
        host: hostSeverity(throttle, cpuTemp),
        mcus: mcus.map((m) => m.link.severity),
        drivers: tmc.map((d) => d.severity),
        driversIdle: tmc.filter((d) => d.idle).length,
      });
    },
    refresh,
    destroy,
  };
}

export type HealthStore = ReturnType<typeof createHealthCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<HealthStore>({
  create: (pid, api) => createHealthCore(api, pid),
  cap: 4,
});

/**
 * Хук мониторинга состояния принтера (хост / MCU / шины / драйверы TMC).
 * Без printerId — делегат, следующий за активным принтером; с printerId — прямое ядро.
 */
export function useHealth(api: PluginApi, printerId?: string): HealthStore {
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

  return createDelegateStore<HealthStore>(() => keeper.get(api.printer.id, api));
}
