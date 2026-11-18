import type { MoonrakerProxyHandle, PluginApi } from '../../../plugin-sdk/src/types';

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
  // Klipper needs time to flush resonance CSVs before another test or graph command.
  pauseForData: 'G4 P5000',
  /** Build SHAPER_CALIBRATE with documented frequency limits.
   * @param axis Axis to calibrate, or undefined for Klipper's combined mode.
   * @param opts Optional frequency limits and sweep rate.
   * @returns One Klipper G-code command.
   */
  shaperCalibrate(axis?: string, opts?: { freqStart?: number; freqEnd?: number; hzPerSec?: number }): string {
    let cmd = axis ? `SHAPER_CALIBRATE AXIS=${axis}` : 'SHAPER_CALIBRATE';
    if (opts?.freqStart !== undefined) cmd += ` FREQ_START=${opts.freqStart}`;
    if (opts?.freqEnd !== undefined) cmd += ` FREQ_END=${opts.freqEnd}`;
    if (opts?.hzPerSec !== undefined) cmd += ` HZ_PER_SEC=${opts.hzPerSec}`;
    return cmd;
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

/** Build the exact sequence shown in the panel and sent to Klipper.
 * @param action Selected test, calibration, or calibration with graphs.
 * @param axes Ordered axes to measure.
 * @param test Builder for a resonance test on one axis.
 * @param calibrate Builder for calibration on one axis.
 * @param graphCommands Configured shell command per axis.
 * @returns Commands with waits before dependent measurements and graph jobs.
 */
export function shaperRunLines(
  action: 'test' | 'calib' | 'pipe',
  axes: readonly ('X' | 'Y')[],
  test: (axis: 'X' | 'Y') => string,
  calibrate: (axis: 'X' | 'Y') => string,
  graphCommands: Record<'X' | 'Y', string>,
): string[] {
  const lines: string[] = [];
  for (const [index, axis] of axes.entries()) {
    if (index > 0) lines.push(...waitForData());
    // Graph commands consume calibration_data CSVs emitted by SHAPER_CALIBRATE.
    lines.push(action === 'test' ? test(axis) : calibrate(axis));
  }
  if (action === 'pipe') {
    for (const axis of axes) {
      // Wait after the last measurement and between graph jobs for CSV and PNG writes.
      lines.push(...waitForData(), gcode.runShellCommand(graphCommands[axis]));
    }
  }
  return lines;
}

/** Build sequential raw-data captures for belt axes and an optional graph.
 * @param axes Ordered movement directions from the selected kinematics preset.
 * @param graphCommand Shell command for one comparison graph, or null for tests only.
 * @returns Commands with a motion barrier and CSV flush between captures.
 */
export function beltRunLines(axes: readonly string[], graphCommand: string | null): string[] {
  const lines: string[] = [];
  for (const [index, axis] of axes.entries()) {
    if (index > 0) lines.push(...waitForData());
    lines.push(gcode.testResonances(axis, { output: 'raw_data' }));
  }
  if (graphCommand) lines.push(...waitForData(), gcode.runShellCommand(graphCommand));
  return lines;
}

/** Wait until Klipper's queued dwell has elapsed before sending another measurement. */
function waitForData(): string[] {
  // G4 advances Klipper's move timeline; the trailing M400 waits for that dwell in real time.
  return [gcode.waitComplete, gcode.pauseForData, gcode.waitComplete];
}

/** Запрос идёт через GuardAgent (матчер printer.gcode.script = calib-safety). */
export async function runGcode(moonraker: MoonrakerProxyHandle, script: string): Promise<void> {
  await moonraker.request('printer.gcode.script', { script });
}

/** Send steps separately so a failed measurement prevents later graph generation.
 * @param moonraker Handle pinned to the starting printer.
 * @param lines Ordered G-code commands.
 * @returns A promise that resolves after the last command or rejects on the first failure.
 */
export async function runGcodeLines(moonraker: MoonrakerProxyHandle, lines: readonly string[]): Promise<void> {
  for (const line of lines) await runGcode(moonraker, line);
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
