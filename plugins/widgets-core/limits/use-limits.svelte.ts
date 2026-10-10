import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

export interface LimitsState {
  velocity: number;
  accel: number;
  scv: number;
  mcr: number; // 0..1
}

let meta = $state<{ ready: boolean; defaults: LimitsState }>({
  ready: false,
  defaults: { velocity: 500, accel: 5000, scv: 5, mcr: 0 },
});

let limits = $state<LimitsState>({ velocity: 0, accel: 0, scv: 0, mcr: 0 });

export function useLimits(api: PluginApi) {
  let generation = 0;
  let unsubMeta: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonraker();
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

    // дефолты для reset — из [printer] конфига
    const cfgRes = await h
      .request<any>('printer.objects.query', { objects: { configfile: ['settings'] } })
      .catch(() => null);
    if (gen !== generation) return;

    const settings = (cfgRes?.status?.configfile?.settings ?? {}) as Record<string, any>;
    const p = settings.printer ?? {};
    meta = {
      ready: true,
      defaults: {
        velocity: Number(p.max_velocity ?? 500),
        accel: Number(p.max_accel ?? 5000),
        scv: Number(p.square_corner_velocity ?? 5),
        mcr: Number(p.minimum_cruise_ratio ?? 0),
      },
    };

    // переподписка без утечки (mount + onReady)
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

    // SEED после F5: дельты несут только изменившиеся поля,
    // null = «все поля объекта»
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
    if (!h || !api.printer.url) return;
    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void loadMeta(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (gen === generation) void loadMeta(gen);
      }),
    );
    await loadMeta(gen);
  }

  init();

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    meta = { ready: false, defaults: { velocity: 500, accel: 5000, scv: 5, mcr: 0 } };
    limits = { velocity: 0, accel: 0, scv: 0, mcr: 0 };
    void init();
  });

  onDestroy(() => {
    teardown();
    offPrinter();
  });

  return {
    get meta() {
      return meta;
    },
    get limits() {
      return limits;
    },
    setLimit,
  };
}