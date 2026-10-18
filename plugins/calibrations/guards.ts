import type { GuardDecision, GuardContext } from '../../plugin-sdk/src/types';

interface GuardRequest {
  method: string;
  params: unknown;
  targetPrinterId: string;
}

/** Per-printer зеркало print_stats.state / toolhead.homed_axes.
 *  Кормится из use-calibrations.svelte.ts; гард читает синхронно по targetPrinterId. */
interface PrinterGuardState {
  printState: 'printing' | 'paused' | 'idle' | 'standby';
  homedAxes: string;
}

const guardStates = new Map<string, PrinterGuardState>();

function getState(printerId: string): PrinterGuardState {
  let state = guardStates.get(printerId);
  if (!state) {
    state = { printState: 'idle', homedAxes: '' };
    guardStates.set(printerId, state);
  }
  return state;
}

export function setGuardPrintState(printerId: string, s: PrinterGuardState['printState']): void {
  getState(printerId).printState = s;
}

export function setGuardHomedAxes(printerId: string, a: string): void {
  getState(printerId).homedAxes = a;
}

const START_TOKENS = [
  'SHAPER_CALIBRATE', 'TEST_RESONANCES', 'PID_CALIBRATE',
  'PROBE_CALIBRATE', 'Z_ENDSTOP_CALIBRATE',
  'PROBE_EDDY_CURRENT_CALIBRATE', 'MANUAL_PROBE', 'RUN_SHELL_COMMAND',
  'BED_MESH_CALIBRATE', 'Z_TILT_ADJUST', 'QUAD_GANTRY_LEVEL', 'SCREWS_TILT_CALCULATE',
];
const HOMED_TOKENS = [
  'TEST_RESONANCES', 'SHAPER_CALIBRATE',
  'BED_MESH_CALIBRATE', 'Z_TILT_ADJUST', 'QUAD_GANTRY_LEVEL', 'SCREWS_TILT_CALCULATE',
];
const SAVE_TOKENS = ['SAVE_CONFIG', 'RESTART', 'FIRMWARE_RESTART'];

/**
 * Manifest handler: запросы НЕ мутируются; freeze в v1 не используется.
 * Читает состояние ЦЕЛЕВОГО принтера из ctx.targetPrinterId (фаза 2 мультипринтерных гардов).
 * Если printerId пуст (legacy-вызов без ctx), fallback на 'idle'/'' — safe default.
 */
export const guardCalibScript = (
  request: GuardRequest,
  _token: string,
  ctx: GuardContext,
): GuardDecision => {
  if (request.method !== 'printer.gcode.script') return { action: 'allow' };

  const params = request.params as { script?: string } | undefined;
  const script = (params?.script ?? '').trim();
  if (!script) return { action: 'allow' };

  const firstToken = script.split(/\s+/)[0]!.toUpperCase();
  
  // Target-scoped: читаем состояние ЦЕЛЕВОГО принтера
  const state = getState(ctx.targetPrinterId);
  const isPrinting = state.printState === 'printing' || state.printState === 'paused';

  if (SAVE_TOKENS.includes(firstToken) && isPrinting) {
    return { action: 'deny', reasonKey: 'calibrations.guard.save_during_print' };
  }
  if (START_TOKENS.includes(firstToken) && isPrinting) {
    return { action: 'deny', reasonKey: 'calibrations.guard.start_during_print' };
  }
  if (HOMED_TOKENS.includes(firstToken) && state.homedAxes !== 'xyz') {
    return { action: 'deny', reasonKey: 'calibrations.guard.needs_homing' };
  }
  return { action: 'allow' };
};