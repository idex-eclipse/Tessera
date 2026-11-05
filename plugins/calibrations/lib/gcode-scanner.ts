/**
 * Чистый парсер gcode_store записей в run-состояние heaters/shaper.
 * Вызывается из createCalibrationsCore (per-printer scanner с поллингом).
 *
 * Прямой хронологический проход: обратный обход перезаписывал активный
 * прогон финишем предыдущего (баг "результат находит, старт нет").
 */

export interface GcodeStoreEntry {
  message: string;
  time?: number;
  type?: string;
}

interface HeatersStateRef {
  heater: string;
  target: number;
  tuning: boolean;
  result: { kp: number; ki: number; kd: number } | null;
}

interface ShaperStateRef {
  busy: string;
  external: boolean;
  axis: 'X' | 'Y';
  fitted: Array<{ name: string; freq: number; vib: number; smooth: number }>;
  recommended: { name: string; freq: number } | null;
}

export interface ScanContext {
  heaters: HeatersStateRef;
  shaper: ShaperStateRef;
}

const START_CMD_RE =
  /^(PID_CALIBRATE|TEST_RESONANCES|SHAPER_CALIBRATE|PROBE_CALIBRATE|Z_ENDSTOP_CALIBRATE|PROBE_EDDY_CURRENT_CALIBRATE|RUN_SHELL_COMMAND|SET_INPUT_SHAPER)\b/i;
const RE_PID_CMD = /^PID_CALIBRATE\b/i;
const RE_HEATER_PARAM = /HEATER=(\S+)/i;
const RE_TARGET_PARAM = /TARGET=(\d+(?:\.\d+)?)/i;
const RE_TEST_CMD = /^TEST_RESONANCES\b/i;
const RE_SHAPER_CMD = /^SHAPER_CALIBRATE\b/i;
const RE_AXIS_PARAM = /AXIS=([^\s]+)/i;
const RE_OUTPUT_RAW = /OUTPUT\s*=\s*raw_data/i;
const RE_ABORT = /^!!/;

const RE_PID = /Kp:([\d.]+)\s+Ki:([\d.]+)\s+Kd:([\d.]+)/;
const RE_FITTED = /(\w+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/;
const RE_RECOMMENDED = /Recommended shaper_config: (\w+)\s+([\d.]+)/;

function isCommand(e: GcodeStoreEntry, msg: string): boolean {
  if (e.type === 'command') return true;
  if (e.type === 'response') return false;
  return START_CMD_RE.test(msg);
}

interface PidScan {
  state: 'idle' | 'tuning' | 'finished';
  heater: string;
  target: number;
  result: { kp: number; ki: number; kd: number } | null;
}

interface ShaperScan {
  state: 'idle' | 'busy' | 'finished';
  axis: string;
  isBelt: boolean;
  fitted: Array<{ name: string; freq: number; vib: number; smooth: number }>;
  recommended: { name: string; freq: number } | null;
}

export function scanEntries(entries: GcodeStoreEntry[], ctx: ScanContext): void {
  const pid: PidScan = { state: 'idle', heater: '', target: 0, result: null };
  const shp: ShaperScan = { state: 'idle', axis: '', isBelt: false, fitted: [], recommended: null };

  for (const e of entries) {
    const msg = e.message.trim();
    if (!msg) continue;

    if (isCommand(e, msg)) {
      if (RE_PID_CMD.test(msg)) {
        pid.state = 'tuning';
        pid.heater = RE_HEATER_PARAM.exec(msg)?.[1] ?? '';
        pid.target = parseFloat(RE_TARGET_PARAM.exec(msg)?.[1] ?? '0') || 0;
        pid.result = null;
        continue;
      }
      if (RE_TEST_CMD.test(msg) || RE_SHAPER_CMD.test(msg)) {
        const ax = (RE_AXIS_PARAM.exec(msg)?.[1] ?? '').trim();
        shp.state = 'busy';
        shp.axis = ax;
        shp.isBelt = ax.includes(',') || RE_OUTPUT_RAW.test(msg);
        shp.fitted = [];
        shp.recommended = null;
        continue;
      }
      continue;
    }

    const fm = RE_PID.exec(msg);
    if (fm) {
      pid.state = 'finished';
      pid.result = { kp: +fm[1]!, ki: +fm[2]!, kd: +fm[3]! };
      continue;
    }
    if (RE_ABORT.test(msg)) {
      if (pid.state === 'tuning') {
        pid.state = 'finished';
        pid.result = null;
      }
      if (shp.state === 'busy') shp.state = 'finished';
      continue;
    }
    const fit = RE_FITTED.exec(msg);
    if (fit && shp.state === 'busy') {
      shp.fitted.push({ name: fit[1]!, freq: +fit[2]!, vib: +fit[3]!, smooth: +fit[4]! });
      continue;
    }
    const rec = RE_RECOMMENDED.exec(msg);
    if (rec && shp.state === 'busy') {
      shp.recommended = { name: rec[1]!, freq: +rec[2]! };
      shp.state = 'finished';
      continue;
    }
  }

  // Применение к state
  const { heaters, shaper } = ctx;

  if (pid.state === 'tuning') {
    if (pid.heater) heaters.heater = pid.heater;
    if (pid.target > 0) heaters.target = pid.target;
    heaters.tuning = true;
    heaters.result = null;
  } else if (pid.state === 'finished') {
    heaters.tuning = false;
    if (pid.result) heaters.result = pid.result;
  }

  const uiRun = shaper.busy !== '' && !shaper.external;
  if (shp.state === 'busy') {
    if (!uiRun) {
      shaper.external = true;
      shaper.busy = shp.isBelt ? 'belts' : 'test';
      shaper.fitted = shp.fitted;
      shaper.recommended = shp.recommended;
    }
    const ax = shp.axis.toUpperCase();
    if (ax === 'X' || ax === 'Y') shaper.axis = ax as 'X' | 'Y';
  } else if (shp.state === 'finished') {
    if (shaper.external) {
      shaper.busy = '';
      shaper.external = false;
    }
    if (!uiRun) {
      if (shp.fitted.length) shaper.fitted = shp.fitted;
      if (shp.recommended) shaper.recommended = shp.recommended;
    }
  }
}