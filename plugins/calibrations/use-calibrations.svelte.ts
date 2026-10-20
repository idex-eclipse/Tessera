import { onDestroy } from 'svelte';
import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';
import { setGuardPrintState, setGuardHomedAxes } from './guards.ts';
import { detectKinematics, type Kinematics } from './kinematics.ts';
import { initialHeatersState, type HeatersState } from './heaters-state.svelte.ts';
import {
  initialShaperState, resetShaperState, refreshGallery,
  listPngs, type ShaperState,
} from './shaper-state.svelte.ts';
import { initialLiveZState, type LiveZState } from './live-z-state.svelte.ts';
import { initialBedMeshUiState, type BedMeshUiState } from './bed-mesh-ui-state.svelte.ts';
import { scanEntries, type GcodeStoreEntry } from './gcode-scanner.ts';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../shared/core-keeper/core-keeper';

export type ProbeMode = 'eddy' | 'probe' | 'bltouch' | 'endstop' | 'none';

export interface CalibrationsState {
  kinematics: Kinematics;
  hasInputShaper: boolean;
  hasProbe: boolean;
  hasPid: boolean;
  hasBedMesh: boolean;
  probeMode: ProbeMode;
  probeSectionName: string | null;
  hasBltouch: boolean;
  hasEddy: boolean;
  eddyChips: string[];
  heaters: string[];
  heaterMaxTemps: Record<string, number>;
  heaterTemps: Record<string, { actual: number; target: number }>;
  shellCommands: string[];
  printState: 'printing' | 'paused' | 'idle' | 'standby';
  homedAxes: string;
  meshProfileName: string;
  zOffsetLive: number | null;
  zOffsets: { probe: number | null; bltouch: number | null; endstop: number | null };
  manualProbe: { isActive: boolean; z: number | null };
  loaded: boolean;
}

const INITIAL: CalibrationsState = {
  kinematics: 'unknown',
  hasInputShaper: false,
  hasProbe: false,
  hasPid: false,
  hasBedMesh: false,
  probeMode: 'none',
  probeSectionName: null,
  hasBltouch: false,
  hasEddy: false,
  eddyChips: [],
  heaters: [],
  heaterMaxTemps: {},
  heaterTemps: {},
  shellCommands: [],
  printState: 'idle',
  homedAxes: '',
  meshProfileName: '',
  zOffsetLive: null,
  zOffsets: { probe: null, bltouch: null, endstop: null },
  manualProbe: { isActive: false, z: null },
  loaded: false,
};

const GCODE_STORE_COUNT = 200;
const GCODE_STORE_POLL_MS = 5000;

function createCalibrationsCore(api: PluginApi, printerId: string) {
  const handle: MoonrakerProxyHandle = api.moonrakerFor(printerId);

  let state = $state<CalibrationsState>({ ...INITIAL });
  let heatersState = $state<HeatersState>(initialHeatersState());
  let shaperState = $state<ShaperState>(initialShaperState());
  let livezState = $state<LiveZState>(initialLiveZState());
  let bedMeshUi = $state<BedMeshUiState>(initialBedMeshUiState());

  let generation = 0;
  const unsubs: Array<() => void> = [];
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // ------------------------------------------------------------------
  // Feature-detect
  // ------------------------------------------------------------------

  async function refreshHelp(): Promise<void> {
    try {
      const help = await handle.request<Record<string, string>>('printer.gcode.help');
      const cmds = new Set(Object.keys(help).map((c) => c.toUpperCase()));
      state.hasInputShaper = cmds.has('TEST_RESONANCES');
      state.hasProbe = cmds.has('PROBE_CALIBRATE');
      state.hasPid = cmds.has('PID_CALIBRATE');
      state.hasBedMesh = cmds.has('BED_MESH_CALIBRATE');
    } catch (e) {
      console.error('[calibrations] gcode.help failed:', e);
    }
  }

  async function refreshConfig(): Promise<void> {
    try {
      const resp = await handle.request<any>('printer.objects.query', {
        objects: { configfile: ['settings'] },
      });
      const settings: Record<string, Record<string, any>> =
        resp?.status?.configfile?.settings ?? resp?.configfile?.settings ?? resp?.config ?? {};

      state.kinematics = detectKinematics(settings);

      const heaters: string[] = [];
      const maxTemps: Record<string, number> = {};
      const eddyChips: string[] = [];
      const shellCommands: string[] = [];
      let probeSection: string | null = null;
      let bltouchSection: string | null = null;

      const num = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

      for (const key of Object.keys(settings)) {
        const lower = key.toLowerCase();
        const section = settings[key] ?? {};

        if (lower === 'extruder' || /^extruder\d+$/.test(lower)) {
          heaters.push(key);
          maxTemps[key] = Number(section.max_temp ?? 300);
        } else if (lower === 'heater_bed') {
          heaters.push(key);
          maxTemps[key] = Number(section.max_temp ?? 130);
        } else if (lower.startsWith('heater_generic ')) {
          const name = key.substring('heater_generic '.length).trim();
          heaters.push(name);
          maxTemps[name] = Number(section.max_temp ?? 300);
        } else if (lower.startsWith('probe_eddy_current ')) {
          eddyChips.push(key.substring('probe_eddy_current '.length).trim());
        } else if (lower === 'bltouch') {
          bltouchSection = key;
        } else if (lower === 'probe' || lower.endsWith('_probe')) {
          probeSection = key;
        } else if (lower.startsWith('gcode_shell_command ')) {
          shellCommands.push(key.substring('gcode_shell_command '.length).trim());
        }
      }

      state.heaters = heaters;
      state.heaterMaxTemps = maxTemps;
      state.eddyChips = eddyChips;
      state.shellCommands = shellCommands;
      state.hasEddy = eddyChips.length > 0;
      state.hasBltouch = bltouchSection !== null;
      state.probeSectionName = probeSection ?? bltouchSection ?? null;

      if (state.hasEddy) state.probeMode = 'eddy';
      else if (probeSection) state.probeMode = 'probe';
      else if (bltouchSection) state.probeMode = 'bltouch';
      else state.probeMode = 'endstop';

      state.zOffsets = {
        probe: num(settings[probeSection ?? '']?.z_offset),
        bltouch: num(settings[bltouchSection ?? '']?.z_offset),
        endstop: num(settings['stepper_z']?.position_endstop),
      };
    } catch (e) {
      console.error('[calibrations] config query failed:', e);
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshHelp(), refreshConfig()]);
    state.loaded = true;
  }

  function resetHeatersState(): void {
    heatersState.heater = '';
    heatersState.target = 200;
    heatersState.tuning = false;
    heatersState.result = null;
  }

  // ------------------------------------------------------------------
  // Gcode-store scanner (встроен в ядро — обновляет heaters/shaper state)
  // ------------------------------------------------------------------

  async function refreshGcodeStore(gen: number): Promise<void> {
    if (handle.readyState !== 'open') return;

    let entries: GcodeStoreEntry[] = [];
    try {
      const res = await handle.request<any>('server.gcode_store', { count: GCODE_STORE_COUNT });
      entries = Array.isArray(res) ? res : (res?.gcode_store ?? []);
    } catch {
      return;
    }
    if (gen !== generation) return;

    scanEntries(entries, { heaters: heatersState, shaper: shaperState });
  }

  // ------------------------------------------------------------------
  // Subscriptions
  // ------------------------------------------------------------------

  function setupSubscriptions(gen: number): () => void {
    const subs: Array<() => void> = [];

    subs.push(
      handle.subscribe(
        {
          print_stats: ['state'],
          toolhead: ['homed_axes'],
          bed_mesh: ['profile_name'],
          manual_probe: ['is_active', 'z_position'],
          gcode_move: ['homing_origin'],
        },
        (delta: any) => {
          if (gen !== generation) return;
          if (delta.print_stats?.state) {
            state.printState = delta.print_stats.state;
            setGuardPrintState(printerId, delta.print_stats.state);
          }
          if (delta.toolhead?.homed_axes !== undefined) {
            state.homedAxes = String(delta.toolhead.homed_axes ?? '');
            setGuardHomedAxes(printerId, state.homedAxes);
          }
          if (delta.bed_mesh?.profile_name !== undefined) {
            state.meshProfileName = String(delta.bed_mesh.profile_name ?? '');
          }
          const mp = delta.manual_probe;
          if (mp && typeof mp === 'object') {
            state.manualProbe = {
              isActive: Boolean(mp.is_active),
              z: typeof mp.z_position === 'number' ? mp.z_position : state.manualProbe.z,
            };
          }
          const gm = delta.gcode_move;
          if (gm && Array.isArray(gm.homing_origin)) {
            const z = Number(gm.homing_origin[2]);
            state.zOffsetLive = Number.isFinite(z) ? z : null;
          }
        },
        { immediate: true },
      ),
    );

    // Live temps heaters
    subs.push(
      handle.onNotify('notify_klippy_ready', () => {
        if (gen !== generation) return;
        resetShaperState(shaperState);
        heatersState.tuning = false;
        heatersState.result = null;
        livezState.baseline = null;
        livezState.staged = null;
        void refresh();
        void refreshGcodeStore(gen);
      }),
    );

    subs.push(
      handle.onNotify('notify_klippy_shutdown', () => {
        if (gen !== generation) return;
        heatersState.tuning = false;
        if (shaperState.external) {
          shaperState.busy = '';
          shaperState.external = false;
        }
      }),
    );

    subs.push(
      handle.onNotify('notify_gcode_response', () => {
        if (gen !== generation) return;
        void refreshGcodeStore(gen);
      }),
    );

    subs.push(
      handle.onNotify('notify_config_changed', () => {
        if (gen !== generation) return;
        void refresh();
      }),
    );

    return () => subs.forEach((u) => u());
  }

  // Live temps subscription (пересоздаётся при смене списка heaters)
  let heatersSubUnsub: (() => void) | null = null;

  $effect(() => {
    const heaters = state.heaters;
    if (heatersSubUnsub) {
      heatersSubUnsub();
      heatersSubUnsub = null;
    }
    if (heaters.length === 0) return;

    const objects: Record<string, string[]> = {};
    for (const name of heaters) objects[name] = ['temperature', 'target'];

    heatersSubUnsub = handle.subscribe(
      objects,
      (delta: any) => {
        for (const name of Object.keys(delta)) {
          const d = delta[name];
          if (!d) continue;
          const prev = state.heaterTemps[name] ?? { actual: 0, target: 0 };
          state.heaterTemps = {
            ...state.heaterTemps,
            [name]: {
              actual: typeof d.temperature === 'number' ? d.temperature : prev.actual,
              target: typeof d.target === 'number' ? d.target : prev.target,
            },
          };
        }
      },
      { immediate: true },
    );
  });

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  function toggleScrewsOverlay(): void {
    bedMeshUi.screwsOverlayOpen = !bedMeshUi.screwsOverlayOpen;
  }

  async function setLivezBaselineFromRef(ref: number | null): Promise<void> {
    if (livezState.baseline === null && ref != null) {
      livezState.baseline = ref;
    }
  }

  function applyLivezOffset(delta: number): void {
    livezState.staged = (livezState.staged ?? livezState.baseline ?? 0) + delta;
    livezState.hasUnsavedApply = true;
  }

  function resetLivezApply(): void {
    livezState.hasUnsavedApply = false;
  }

  function resetLivezState(): void {
    livezState.baseline = null;
    livezState.staged = null;
    livezState.hasUnsavedApply = false;
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  let cleanup: (() => void) | null = null;

  async function init(): Promise<() => void> {
    const gen = ++generation;

    if (handle.readyState === 'open') {
      void refresh();
      void refreshGcodeStore(gen);
    }

    const offReady = handle.onReady(() => {
      if (gen === generation) {
        void refresh();
        void refreshGcodeStore(gen);
      }
    });

    cleanup = setupSubscriptions(gen);

    pollTimer = setInterval(() => {
      if (gen === generation) void refreshGcodeStore(gen);
    }, GCODE_STORE_POLL_MS);

    return () => {
      offReady();
      cleanup?.();
      cleanup = null;
      if (heatersSubUnsub) {
        heatersSubUnsub();
        heatersSubUnsub = null;
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }

  let cleanupInit: (() => void) | null = null;

  $effect(() => {
    let active = true;
    init().then((fn) => {
      if (active) cleanupInit = fn;
      else fn();
    });
    return () => {
      active = false;
      if (cleanupInit) {
        cleanupInit();
        cleanupInit = null;
      }
    };
  });

  function destroy(): void {
    generation++;
    if (cleanupInit) {
      cleanupInit();
      cleanupInit = null;
    }
  }

  return {
    get state() { return state; },
    get heatersState() { return heatersState; },
    get shaperState() { return shaperState; },
    get livezState() { return livezState; },
    get bedMeshUi() { return bedMeshUi; },
    refresh,
    resetHeatersState,
    toggleScrewsOverlay,
    setLivezBaselineFromRef,
    applyLivezOffset,
    resetLivezApply,
    resetLivezState,
    refreshGcodeStore: () => refreshGcodeStore(generation),
    refreshShaperGallery: () => refreshGallery(shaperState, handle),
    loadShaperPreview: (path: string) => {
      const { loadPreview } = require('./shaper-state.svelte.ts');
      return loadPreview(shaperState, handle, path);
    },
    destroy,
  };
}

export type CalibrationsStore = ReturnType<typeof createCalibrationsCore>;

const keeper = createCoreKeeper<CalibrationsStore>({
  create: (pid, api) => createCalibrationsCore(api, pid),
  cap: 4,
});

/**
 * Хук данных calibrations.
 * Без printerId — legacy делегат на активного принтера; с printerId — прямое
 * ядро с удержанием (fleet/явная привязка).
 */
export function useCalibrations(api: PluginApi, printerId?: string): CalibrationsStore {
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

  return createDelegateStore<CalibrationsStore>(() => keeper.get(api.printer.id, api));
}