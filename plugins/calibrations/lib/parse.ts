/** Regex-справочник парсинга console-строк (notify_gcode_response). */
export const RE_PID = /pid_Kp=([0-9.]+)[\s,]+pid_Ki=([0-9.]+)[\s,]+pid_Kd=([0-9.]+)/i;
export const RE_FITTED =
  /Fitted shaper '([a-z0-9_]+)' frequency = ([0-9.]+) Hz \(vibrations = ([0-9.]+)%, smoothing ~= ([0-9.]+)\)/i;
export const RE_RECOMMENDED = /Recommended shaper is ([a-z0-9_]+) @ ([0-9.]+) Hz/i;
export const RE_PROBE_ACC =
  /probe accuracy results: maximum ([0-9.-]+), minimum ([0-9.-]+), range ([0-9.-]+), average ([0-9.-]+), median ([0-9.-]+), standard deviation ([0-9.-]+)/i;

export const RE_PID_START = /PID_CALIBRATE\b/i;
export const RE_HEATER_PARAM = /HEATER=(\S+)/i;
export const RE_TARGET_PARAM = /TARGET=(\d+)/i;
  
export const RE_TEST_RESONANCES_START = /TEST_RESONANCES\b/i;
export const RE_AXIS_PARAM = /AXIS=([^\s]+)/i;
export const RE_OUTPUT_RAW = /OUTPUT\s*=\s*raw_data/i;
export const RE_SHAPER_CALIBRATE_START = /SHAPER_CALIBRATE\b/i;

/** Moonraker шлёт notify_gcode_response МАССИВОМ строк — нормализуем, разбивая по \n. */
export function normalizeConsoleLines(params: unknown): string[] {
  if (Array.isArray(params)) {
    return (params as unknown[])
      .map((p) => String(p ?? ''))
      .flatMap((s) => s.split(/\r?\n/))
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  return String(params ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}