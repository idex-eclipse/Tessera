import type { GuardDecision } from '../../plugin-sdk/src/types';

interface GuardRequest {
  method: string;
  params: unknown;
}

/** Module-state зеркало print_stats.state / toolhead.homed_axes.
 *  Кормится из use-calibrations.svelte.ts; гард читает синхронно. */
let printState: 'printing' | 'paused' | 'idle' | 'standby' = 'idle';
let homedAxes = '';

export function setGuardPrintState(s: typeof printState): void { printState = s; }
export function setGuardHomedAxes(a: string): void { homedAxes = a; }

const START_TOKENS = [
  'SHAPER_CALIBRATE', 'TEST_RESONANCES', 'PID_CALIBRATE',
  'PROBE_CALIBRATE', 'Z_ENDSTOP_CALIBRATE',
  'PROBE_EDDY_CURRENT_CALIBRATE', 'MANUAL_PROBE', 'RUN_SHELL_COMMAND',
  'BED_MESH_CALIBRATE', 'Z_TILT_ADJUST', 'QUAD_GANTRY_LEVEL', 'SCREWS_TILT_CALCULATE', // ← добавлено
];
const HOMED_TOKENS = [
  'TEST_RESONANCES', 'SHAPER_CALIBRATE',
  'BED_MESH_CALIBRATE', 'Z_TILT_ADJUST', 'QUAD_GANTRY_LEVEL', 'SCREWS_TILT_CALCULATE', // ← вынесено в список
];
const SAVE_TOKENS = ['SAVE_CONFIG', 'RESTART', 'FIRMWARE_RESTART'];

/** Manifest handler: запросы НЕ мутируются; freeze в v1 не используется. */
export const guardCalibScript = (request: GuardRequest): GuardDecision => {
  if (request.method !== 'printer.gcode.script') return { action: 'allow' };

  const params = request.params as { script?: string } | undefined;
  const script = (params?.script ?? '').trim();
  if (!script) return { action: 'allow' };

  const firstToken = script.split(/\s+/)[0]!.toUpperCase();
  const isPrinting = printState === 'printing' || printState === 'paused';

  if (SAVE_TOKENS.includes(firstToken) && isPrinting) {
    return { action: 'deny', reasonKey: 'calibrations.guard.save_during_print' };
  }
  if (START_TOKENS.includes(firstToken) && isPrinting) {
    return { action: 'deny', reasonKey: 'calibrations.guard.start_during_print' };
  }
  if (HOMED_TOKENS.includes(firstToken) && homedAxes !== 'xyz') {
    return { action: 'deny', reasonKey: 'calibrations.guard.needs_homing' };
  }
  return { action: 'allow' };
};