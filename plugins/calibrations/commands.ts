import type { MoonrakerProxyHandle, PluginApi } from '../../plugin-sdk/src/types';

/** G-code builders — vanilla Klipper, без обёрток. */
export const gcode = {
  testResonances(
    axis: string,
    opts?: { freqStart?: number; freqEnd?: number; hzPerSec?: number; name?: string; output?: string },
  ): string {
    let cmd = `TEST_RESONANCES AXIS=${axis}`;
    if (opts?.freqStart !== undefined) cmd += ` FREQ_START=${opts.freqStart}`;
    if (opts?.freqEnd !== undefined) cmd += ` FREQ_END=${opts.freqEnd}`;
    if (opts?.hzPerSec !== undefined) cmd += ` HZ_PER_SEC=${opts.hzPerSec}`;
    if (opts?.name) cmd += ` NAME=${opts.name}`;
    if (opts?.output) cmd += ` OUTPUT=${opts.output}`;
    return cmd;
  },
  waitComplete: 'M400',
  pauseForData: 'G4 P10000',
  shaperCalibrate(axis?: string): string {
    return axis ? `SHAPER_CALIBRATE AXIS=${axis}` : 'SHAPER_CALIBRATE';
  },
  setInputShaper(params: Record<string, string | number>): string {
    return `SET_INPUT_SHAPER ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ')}`;
  },
  runShellCommand(name: string): string {
    return `RUN_SHELL_COMMAND CMD=${name}`;
  },
  pidCalibrate(heater: string, target: number): string {
    return `PID_CALIBRATE HEATER=${heater} TARGET=${target}`;
  },
  probeCalibrate(): string { return 'PROBE_CALIBRATE'; },
  zEndstopCalibrate(): string { return 'Z_ENDSTOP_CALIBRATE'; },
  eddyCalibrate(chip: string): string { return `PROBE_EDDY_CURRENT_CALIBRATE CHIP=${chip}`; },
  probeAccuracy(count?: number): string {
    return count ? `PROBE_ACCURACY PROBE_COUNT=${count}` : 'PROBE_ACCURACY';
  },
  /** Baby-step: MOVE=1 только при припаркованной Z, иначе MOVE=0. */
  setZAdjust(delta: number, move: boolean): string {
    return `SET_GCODE_OFFSET Z_ADJUST=${delta} MOVE=${move ? 1 : 0}`;
  },
  setZAbsolute(z: number, move: boolean): string {
    return `SET_GCODE_OFFSET Z=${z} MOVE=${move ? 1 : 0}`;
  },
  zOffsetApplyProbe(): string { return 'Z_OFFSET_APPLY_PROBE'; },

  bedMeshCalibrate: 'BED_MESH_CALIBRATE',
  bedMeshClear: 'BED_MESH_CLEAR',

  bedMeshProfileLoad: (name: string) =>
    `BED_MESH_PROFILE LOAD=${quoteName(name)}`,
  bedMeshProfileSave: (name: string) =>
    `BED_MESH_PROFILE SAVE=${quoteName(name)}`,
  bedMeshProfileDelete: (name: string) =>
    `BED_MESH_PROFILE REMOVE=${quoteName(name)}`,

  zTiltAdjust: 'Z_TILT_ADJUST',
  quadGantryLevel: 'QUAD_GANTRY_LEVEL',
  screwsTiltCalculate: 'SCREWS_TILT_CALCULATE',
  manualProbe: 'MANUAL_PROBE',

  testz: (z: number | string) => `TESTZ Z=${z}`,
  accept: 'ACCEPT',
  abort: 'ABORT',

  saveConfig(): string { return 'SAVE_CONFIG'; },
};

/** Запрос идёт через GuardAgent (матчер printer.gcode.script = calib-safety). */
export async function runGcode(moonraker: MoonrakerProxyHandle, script: string): Promise<void> {
  await moonraker.request('printer.gcode.script', { script });
}

const CALIBRATIONS_PLUGIN_ID = '@core/calibrations';

/** mesh теперь таб собственной страницы, не отдельный плагин */
export function openMeshTab(api: PluginApi): void {
  window.location.hash = `#/p/${api.printer.id}/${CALIBRATIONS_PLUGIN_ID}?section=mesh`;
}

/** Имя профиля может содержать пробелы — всегда квотируем. */
function quoteName(name: string): string {
  return `"${name.replace(/"/g, '')}"`;
}