import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

export type FilamentKind = 'switch' | 'motion' | 'hall';

export interface FilamentSensor {
  id: string; // 'filament_switch_sensor runout' / 'hall_filament_width_sensor'
  kind: FilamentKind;
  name: string;
}

export interface FilamentState {
  enabled: boolean;
  detected: boolean;
  isActive: boolean;
  flowComp: boolean;
  diameter: number | null;
  raw: number | null;
}

const EMPTY_STATE: FilamentState = {
  enabled: false,
  detected: false,
  isActive: false,
  flowComp: false,
  diameter: null,
  raw: null,
};

let sensors = $state<FilamentSensor[]>([]);
let states = $state<Record<string, FilamentState>>({});

export function useFilament(api: PluginApi) {
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

  function script(cmd: string): void {
    safeHandle()
      ?.request('printer.gcode.script', { script: cmd })
      .catch((e) => console.error('[filament] gcode failed:', cmd, e));
  }

  function applyDelta(d: any): void {
    if (!d) return;
    let changed = false;
    const next = { ...states };

    for (const s of sensors) {
      const obj = d[s.id];
      if (!obj) continue;

      const st = { ...(next[s.id] ?? EMPTY_STATE) };
      if (typeof obj.enabled === 'boolean') st.enabled = obj.enabled;
      if (typeof obj.filament_detected === 'boolean') st.detected = obj.filament_detected;
      if (s.kind === 'hall') {
        if (typeof obj.is_active === 'boolean') st.isActive = obj.is_active;
        if (typeof obj.flow_compensation_enabled === 'boolean') st.flowComp = obj.flow_compensation_enabled;
        if (typeof obj.Diameter === 'number') st.diameter = obj.Diameter;
        if (typeof obj.Raw === 'number') st.raw = obj.Raw;
      }

      next[s.id] = st;
      changed = true;
    }

    if (changed) states = next;
  }

  async function loadMeta(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    const [list, cfgRes] = await Promise.all([
      h.request<any>('printer.objects.list').catch(() => null),
      h.request<any>('printer.objects.query', { objects: { configfile: ['settings'] } }).catch(() => null),
    ]);
    if (gen !== generation || !list) return;

    const objects: string[] = list.objects ?? [];
    const settings = (cfgRes?.status?.configfile?.settings ?? {}) as Record<string, any>;

    const next: FilamentSensor[] = [];
    for (const key of Object.keys(settings)) {
      if (!objects.includes(key)) continue;
      if (key.startsWith('filament_switch_sensor ')) {
        next.push({ id: key, kind: 'switch', name: key.slice('filament_switch_sensor '.length) });
      } else if (key.startsWith('filament_motion_sensor ')) {
        next.push({ id: key, kind: 'motion', name: key.slice('filament_motion_sensor '.length) });
      } else if (key === 'hall_filament_width_sensor') {
        next.push({ id: key, kind: 'hall', name: key });
      }
    }

    sensors = next;

    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }

    if (sensors.length === 0) return;

    const subObjects: Record<string, string[]> = {};
    for (const s of sensors) {
      subObjects[s.id] =
        s.kind === 'hall'
          ? ['enabled', 'filament_detected', 'is_active', 'flow_compensation_enabled', 'Diameter', 'Raw']
          : ['enabled', 'filament_detected'];
    }

    unsubMeta = h.subscribe(
      subObjects,
      (d: any) => {
        if (gen === generation) applyDelta(d);
      },
      { immediate: true },
    );

    const seeded = await h
      .request<any>('printer.objects.query', {
        objects: Object.fromEntries(sensors.map((s) => [s.id, null])),
      })
      .catch(() => null);
    if (gen === generation && seeded?.status) applyDelta(seeded.status);
  }

  // Actions

  function setEnabled(s: FilamentSensor, v: boolean): void {
    if (s.kind === 'hall') {
      script(v ? 'ENABLE_FILAMENT_WIDTH_SENSOR' : 'DISABLE_FILAMENT_WIDTH_SENSOR');
    } else {
      script(`SET_FILAMENT_SENSOR SENSOR=${s.name} ENABLE=${v ? 1 : 0}`);
    }
  }

  function setFlowComp(v: boolean): void {
    script(`ENABLE_FILAMENT_WIDTH_SENSOR FLOW_COMPENSATION=${v ? 1 : 0}`);
  }

  function resetWidth(): void {
    script('RESET_FILAMENT_WIDTH_SENSOR');
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
    sensors = [];
    states = {};
    void init();
  });

  onDestroy(() => {
    teardown();
    offPrinter();
  });

  return {
    get sensors() {
      return sensors;
    },
    get states() {
      return states;
    },
    setEnabled,
    setFlowComp,
    resetWidth,
  };
}

export type FilamentStore = ReturnType<typeof useFilament>;