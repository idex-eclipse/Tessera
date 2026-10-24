import type { GuardContext, GuardDecision } from '../../plugin-sdk/src/types';

import { getTracked, resolvePrinterState } from './printer-tracker.ts';

interface GuardRequest {
  method: string;
  params: unknown;
  targetPrinterId: string;
}

/**
 * Команды, запуск которых во время печати запрещён (калибровки двигают голову
 * и греют, RUN_SHELL_COMMAND запускает внешние процессы).
 */
const START_TOKENS = new Set([
  'SHAPER_CALIBRATE', 'TEST_RESONANCES', 'PID_CALIBRATE',
  'PROBE_CALIBRATE', 'Z_ENDSTOP_CALIBRATE',
  'PROBE_EDDY_CURRENT_CALIBRATE', 'MANUAL_PROBE', 'RUN_SHELL_COMMAND',
  'BED_MESH_CALIBRATE', 'Z_TILT_ADJUST', 'QUAD_GANTRY_LEVEL', 'SCREWS_TILT_CALCULATE',
]);

/** Команды, требующие исходных (xyz) осей. */
const HOMED_TOKENS = new Set([
  'TEST_RESONANCES', 'SHAPER_CALIBRATE',
  'BED_MESH_CALIBRATE', 'Z_TILT_ADJUST', 'QUAD_GANTRY_LEVEL', 'SCREWS_TILT_CALCULATE',
]);

/** Сохранение/перезапуск Klipper во время печати обрывает печать. */
const SAVE_TOKENS = new Set(['SAVE_CONFIG', 'RESTART', 'FIRMWARE_RESTART']);

const WATCHED = new Set([...START_TOKENS, ...HOMED_TOKENS, ...SAVE_TOKENS]);

/**
 * Первые слова всех G-code строк скрипта (верхний регистр).
 * Скрипт может быть многострочным ("G28\nBED_MESH_CALIBRATE"): проверять только
 * первую строку недостаточно. Пустые строки и комментарии (; и #) пропускаются.
 */
export function scriptCommands(script: string): string[] {
  const out: string[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    out.push(line.split(/\s+/)[0]!.toUpperCase());
  }
  return out;
}

/**
 * Guard `calib-safety` (printer.gcode.script). Запросы НЕ мутируются; freeze не
 * используется. Решение принимается по состоянию ЦЕЛЕВОГО принтера
 * (ctx.targetPrinterId): его даёт трекер, а при отсутствии данных — разовый
 * запрос к Moonraker. Если состояние узнать нельзя (оффлайн), запрос
 * пропускается: Klipper всё равно отклонит команду сам.
 */
export const guardCalibScript = async (
  request: GuardRequest,
  _token: string,
  ctx: GuardContext,
): Promise<GuardDecision> => {
  if (request.method !== 'printer.gcode.script') return { action: 'allow' };

  const params = request.params as { script?: string } | undefined;
  const commands = scriptCommands(String(params?.script ?? '')).filter((c) => WATCHED.has(c));
  if (commands.length === 0) return { action: 'allow' };

  const state = await resolvePrinterState(ctx.targetPrinterId);
  if (!state) return { action: 'allow' };

  const isPrinting = state.printState === 'printing' || state.printState === 'paused';

  if (isPrinting && commands.some((c) => SAVE_TOKENS.has(c))) {
    return { action: 'deny', reasonKey: 'calibrations.guard.save_during_print' };
  }
  if (isPrinting && commands.some((c) => START_TOKENS.has(c))) {
    return { action: 'deny', reasonKey: 'calibrations.guard.start_during_print' };
  }
  if (commands.some((c) => HOMED_TOKENS.has(c)) && state.homedAxes !== 'xyz') {
    return { action: 'deny', reasonKey: 'calibrations.guard.needs_homing' };
  }
  return { action: 'allow' };
};

/**
 * Guard `calib-print-start` (printer.print.start): нельзя стартовать печать,
 * пока идёт ручное зондирование (manual_probe активен) — оно занимает
 * движение и ждёт ACCEPT/ABORT.
 */
export const guardCalibPrintStart = (
  request: GuardRequest,
  _token: string,
  ctx: GuardContext,
): GuardDecision => {
  if (request.method !== 'printer.print.start') return { action: 'allow' };
  if (getTracked(ctx.targetPrinterId)?.manualProbeActive) {
    return { action: 'deny', reasonKey: 'calibrations.guard.probe_active' };
  }
  return { action: 'allow' };
};
