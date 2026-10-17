import type { PluginApi } from '../../plugin-sdk/src/types';
import { setGuardPrintState, setGuardHomedAxes } from './guards.ts';
import { detectKinematics, type Kinematics } from './kinematics.ts';
import { resetLivezState } from './live-z-state.svelte.ts';
import { onDestroy } from 'svelte';

export type ProbeMode = 'eddy' | 'probe' | 'bltouch' | 'endstop' | 'none';

export interface CalibrationsState {
  kinematics: Kinematics;
  hasInputShaper: boolean;
  hasProbe: boolean;      // PROBE_CALIBRATE в gcode.help
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
  zOffsetLive: number | null;              // gcode_move.homing_origin[2]
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

export function useCalibrations(api: PluginApi) {
  const moonraker = api.moonraker();

  let state = $state<CalibrationsState>({ ...INITIAL });

  // ------------------------------------------------------------------
  // feature-detect
  // ------------------------------------------------------------------

  async function refreshHelp(): Promise<void> {
    try {
      const help = await moonraker.request<Record<string, string>>('printer.gcode.help');
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
      const resp = await moonraker.request<any>('printer.objects.query', {
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
          probeSection = key;   // probe | load_cell_probe | dockable_probe | …
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

  // ------------------------------------------------------------------
  // подписки
  // ------------------------------------------------------------------

  function setupSubscriptions(): () => void {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      moonraker.subscribe(
        {
          print_stats: ['state'],
          toolhead: ['homed_axes'],
          bed_mesh: ['profile_name'],
          manual_probe: ['is_active', 'z_position'],
          gcode_move: ['homing_origin'],
        },
        (delta: any) => {
          if (delta.print_stats?.state) {
            state.printState = delta.print_stats.state;
            setGuardPrintState(delta.print_stats.state);
          }
          if (delta.toolhead?.homed_axes !== undefined) {
            state.homedAxes = String(delta.toolhead.homed_axes ?? '');
            setGuardHomedAxes(state.homedAxes);
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

    return () => unsubs.forEach((fn) => fn());
  }

  // live-температуры нагревателей (пересоздаём подписку при смене списка)
  $effect(() => {
    const heaters = state.heaters;
    if (heaters.length === 0) return;
    const objects: Record<string, string[]> = {};
    for (const name of heaters) objects[name] = ['temperature', 'target'];

    return moonraker.subscribe(
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

  // SAVE_CONFIG перезапускает Klipper: configfile.settings становятся актуальными
  // только после notify_klippy_ready — перечитываем help+config (база LiveZ и т.д.)
  $effect(() => {
    return moonraker.onNotify('notify_klippy_ready', () => {
      resetLivezState(); 
      void refresh();
    });
  });

  let cleanup: (() => void) | null = null;
  $effect(() => {
    // Холодный старт (F5): WS ещё не open → request() реджектится.
    // immediate-refresh только если соединение уже открыто; иначе ждём
    // onReady — он же покроет реконнекты и догонку после смены принтера.
    if (moonraker.readyState === 'open') {
      void refresh();
    }
    const offReady = moonraker.onReady(() => {
      void refresh();
    });

    cleanup = setupSubscriptions();
    return () => {
      offReady();
      cleanup?.();
      cleanup = null;
    };
  });

  const offPrinter = api.onPrinterChange(() => {
    state = { ...INITIAL };
    void refresh();
  });
  onDestroy(offPrinter);

  return {
    get state() { return state; },
    refresh,
  };
}